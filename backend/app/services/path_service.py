"""Learning path (lộ trình) service.

Lộ trình is grouped PER DOCUMENT: each READY document of the subject that has
topics of its own (Document.topics_json, AI-detected + AI-ordered just for
that document - see QuizService.ensure_document_topics) gets its own
independent ordered topic list and its own independent done/current/locked
gating. Documents never block each other - finishing every topic in document
A is not required to start document B's topics. A topic is "done" once the
user has scored >= COMPLETION_THRESHOLD on a quiz scoped to that exact
(document, topic) pair (Quiz.document_id + Quiz.topic). Topic order is
load-bearing within each document's own group: topics after the first
not-yet-done one in that SAME group are REALLY locked (no Học/Luyện tập entry
point at all - see start_practice and the frontend's path-tab.tsx).

This supersedes the previous subject-wide merged list that used to live on
Subject (suggested_topics_json/topics_order_ready - removed, owner-confirmed
cleanup).
"""
import asyncio
import json
from typing import List, Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, OperationalError
from fastapi import HTTPException

from app.models import Subject, Quiz, QuizQuestion, QuizResult, Document, DocumentStatus, TopicLesson, Conversation, Message
from app.ai.llm import llm_manager
from app.ai.rag import RAGPipeline
from app.services.quiz_service import QuizService, backfill_document_topics_in_background

# A topic is "done" once the best score on a quiz scoped to it reaches this.
COMPLETION_THRESHOLD = 0.70


class PathService:
    def __init__(self, db: Session):
        self.db = db

    def _verify_subject(self, subject_id: UUID, user_id: UUID) -> Subject:
        subject = (
            self.db.query(Subject)
            .filter(Subject.id == subject_id, Subject.user_id == user_id)
            .first()
        )
        if not subject:
            raise HTTPException(status_code=404, detail="Không tìm thấy môn học")
        return subject

    def _verify_document(self, subject_id: UUID, user_id: UUID, document_id: UUID) -> Document:
        document = (
            self.db.query(Document)
            .filter(Document.id == document_id, Document.subject_id == subject_id, Document.user_id == user_id)
            .first()
        )
        if not document:
            raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
        return document

    async def document_topic_groups(self, subject_id: UUID, user_id: UUID) -> List[dict]:
        """One group per READY document that has topics, in upload order.
        Each group's done/current/locked state is computed only from quizzes
        scoped to THAT document (Quiz.document_id) - independent of every
        other document's group."""
        self._verify_subject(subject_id, user_id)
        documents = (
            self.db.query(Document)
            .filter(
                Document.user_id == user_id,
                Document.subject_id == subject_id,
                Document.status == DocumentStatus.READY,
            )
            .order_by(Document.created_at.asc())
            .all()
        )

        groups: List[dict] = []
        for doc in documents:
            # Fast path only - never await the RAG+LLM round trip here (this
            # is on the hot path, loaded every time the Lộ trình tab opens).
            # A document whose topics aren't cached yet (new, or predates
            # this feature) is skipped THIS load and backfilled in the
            # background; it appears on the next load once that finishes.
            if doc.topics_json:
                topics = json.loads(doc.topics_json)
            else:
                asyncio.create_task(backfill_document_topics_in_background(doc.id, user_id))
                continue
            if not topics:
                continue

            # Full attempts only: a due-review / retry-wrong session submits
            # just a few of the quiz's questions (see QuizSubmit.question_ids),
            # and e.g. 1/1 right must not count as "100%, topic done".
            question_counts = (
                self.db.query(QuizQuestion.quiz_id, func.count(QuizQuestion.id).label("n"))
                .group_by(QuizQuestion.quiz_id)
                .subquery()
            )
            rows = (
                self.db.query(Quiz.topic, QuizResult.correct_count, QuizResult.total_questions, QuizResult.created_at)
                .join(QuizResult, QuizResult.quiz_id == Quiz.id)
                .join(question_counts, question_counts.c.quiz_id == Quiz.id)
                .filter(
                    Quiz.document_id == doc.id,
                    QuizResult.user_id == user_id,
                    Quiz.topic.isnot(None),
                    QuizResult.total_questions >= question_counts.c.n,
                )
                .all()
            )
            best: dict = {}
            latest: dict = {}  # topic -> (created_at, pct)
            for topic, correct, total, created_at in rows:
                if not total:
                    continue
                pct = correct / total
                if topic not in best or pct > best[topic]:
                    best[topic] = pct
                if topic not in latest or (created_at and created_at > latest[topic][0]):
                    latest[topic] = (created_at, pct)

            out = []
            marked_current = False
            for t in topics:
                pct = best.get(t)
                recent_pct = latest[t][1] if t in latest else None
                done = pct is not None and pct >= COMPLETION_THRESHOLD
                if done:
                    state = "done"
                elif not marked_current:
                    state = "current"
                    marked_current = True
                else:
                    state = "locked"
                out.append({
                    "topic": t,
                    "state": state,
                    "best_percent": round(pct * 100) if pct is not None else None,
                    "recent_percent": round(recent_pct * 100) if recent_pct is not None else None,
                })
            groups.append({"document_id": doc.id, "document_name": doc.filename, "topics": out})
        return groups

    async def _topic_row(self, subject_id: UUID, user_id: UUID, document_id: UUID, topic: str) -> Optional[dict]:
        for group in await self.document_topic_groups(subject_id, user_id):
            if group["document_id"] == document_id:
                return next((t for t in group["topics"] if t["topic"] == topic), None)
        return None

    async def start_practice(self, subject_id: UUID, user_id: UUID, document_id: UUID, topic: str, quiz_service: QuizService) -> Quiz:
        """Create the "Luyện tập" quiz for one (document, topic) Lộ trình
        entry - real server-side gating so a locked topic can't be
        practiced via a direct API call either, not just hidden in the UI.
        Free-scope practice (any topic, any time, no document tie) still
        goes through the ordinary "Tạo Quiz" dialog -> create_next_quiz
        directly, untouched by this check."""
        row = await self._topic_row(subject_id, user_id, document_id, topic)
        if not row or row["state"] == "locked":
            raise HTTPException(
                status_code=403,
                detail="Chủ đề này đang bị khóa — hãy hoàn thành chủ đề trước trong cùng tài liệu, hoặc dùng \"Tạo Quiz\" để ôn tự do.",
            )
        return await quiz_service.create_next_quiz(
            user_id, subject_id, topic=topic, document_id=document_id, all_knowledge=False,
            num_questions=8, difficulty="medium",
        )

    async def get_or_create_lesson(self, subject_id: UUID, user_id: UUID, document_id: UUID, topic: str) -> TopicLesson:
        """Cached "Học" content for one (document, topic) pair: an AI summary
        grounded ONLY in that document's own content, plus the source
        excerpts it used. Generated once and reused - see TopicLesson."""
        document = self._verify_document(subject_id, user_id, document_id)
        existing = (
            self.db.query(TopicLesson)
            .filter(TopicLesson.document_id == document_id, TopicLesson.topic == topic)
            .first()
        )
        if existing:
            return existing

        subject = self._verify_subject(subject_id, user_id)
        excerpts: List[dict] = []
        context = ""
        rag = RAGPipeline()
        # No fixed top-N: cosine score has no natural "this many exist" cutoff
        # of its own, so a fixed limit either pads with barely-related chunks
        # (a narrow topic) or hides genuinely relevant ones (a broad topic).
        # score_threshold is the real cutoff; `limit=30` is just a sanity cap.
        # 0.5 is a starting point from one real sample (see commit message /
        # PROJECT-OVERVIEW.md) - may need retuning once used across more
        # documents and topics.
        results = await rag.search_documents(
            query=topic, user_id=user_id, document_ids=[document.id], limit=30, score_threshold=0.5,
        )
        context = rag.build_context(topic, results)
        for r in results:
            page = rag._page_of(r)
            # Skip chunks with no resolvable page for DISPLAY only - no page
            # means no slide image can be shown (see ExcerptPage), so keeping
            # them just repeated the filename with nothing useful under it.
            # `context` above (what the AI summary is grounded in) still uses
            # every thresholded result, page or not.
            if not page:
                continue
            excerpts.append({
                "document_name": r.get("document_name") or document.filename,
                "page": page,
                "content": r.get("content") or "",
            })

        summary = await llm_manager.summarize_topic(subject.name, topic, context or None)

        def _new_lesson() -> TopicLesson:
            return TopicLesson(
                document_id=document_id,
                topic=topic,
                summary=summary,
                excerpts_json=json.dumps(excerpts, ensure_ascii=False),
            )

        lesson = _new_lesson()
        try:
            self.db.add(lesson)
            self.db.commit()
        except OperationalError:
            # Neon's pooler can silently drop an idle DB connection while the
            # slow RAG search + LLM summary call above were running (this
            # session held it open the whole time) - pool_pre_ping only
            # re-validates a connection at CHECKOUT, not mid-request, so a
            # connection that died in between isn't caught until this write.
            # One retry, with a fresh object, gets a new pre_ping-validated
            # connection and almost always succeeds.
            self.db.rollback()
            lesson = _new_lesson()
            self.db.add(lesson)
            self.db.commit()
        except IntegrityError:
            # A concurrent request (e.g. the same topic open in two tabs)
            # generated and saved this lesson first - use that one.
            self.db.rollback()
            return (
                self.db.query(TopicLesson)
                .filter(TopicLesson.document_id == document_id, TopicLesson.topic == topic)
                .one()
            )
        self.db.refresh(lesson)
        return lesson

    def get_or_create_topic_conversation(
        self, subject_id: UUID, user_id: UUID, document_id: UUID, topic: str
    ) -> Conversation:
        """The ONE conversation for this user's (document, topic) Q&A in the
        "Học" screen - found by those exact tags, or created the first time.
        Reusing the same row (not a new one per visit) is what lets "Hỏi
        thêm AI" continue the same conversation across every reopen, on any
        device (this is a real DB row, not browser-local state)."""
        self._verify_document(subject_id, user_id, document_id)
        existing = (
            self.db.query(Conversation)
            .filter(
                Conversation.user_id == user_id,
                Conversation.document_id == document_id,
                Conversation.topic == topic,
            )
            .first()
        )
        if existing:
            return existing
        conversation = Conversation(
            user_id=user_id,
            subject_id=subject_id,
            document_id=document_id,
            topic=topic,
            title=f"Học: {topic}",
        )
        self.db.add(conversation)
        self.db.commit()
        self.db.refresh(conversation)
        return conversation

    def get_topic_chat_history(
        self, subject_id: UUID, user_id: UUID, document_id: UUID, topic: str
    ) -> List[Message]:
        """Past Q&A for this (document, topic), oldest first - empty when
        nothing has been asked about it yet (no conversation created so far)."""
        self._verify_document(subject_id, user_id, document_id)
        conversation = (
            self.db.query(Conversation)
            .filter(
                Conversation.user_id == user_id,
                Conversation.document_id == document_id,
                Conversation.topic == topic,
            )
            .first()
        )
        return conversation.messages if conversation else []
