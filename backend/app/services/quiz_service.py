import json
from typing import List, Optional, Tuple
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models import Quiz, QuizQuestion, QuizResult, QuizAnswer, Subject, Document, DocumentStatus, SharedQuizQuestion, Review, QuizDifficulty
from app.schemas.quiz import QuizCreate, QuizSubmit
from app.ai.llm import llm_manager
from app.ai.rag import RAGPipeline
from app.utils.subject_key import subject_key_for
from app.utils.dates import today_hcm
from fastapi import HTTPException, status
import random


class QuizService:
    def __init__(self, db: Session):
        self.db = db

    def _verify_subject_ownership(self, subject_id: UUID, user_id: UUID) -> Subject:
        """Verify user owns the subject."""
        subject = (
            self.db.query(Subject)
            .filter(Subject.id == subject_id, Subject.user_id == user_id)
            .first()
        )
        if not subject:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subject not found"
            )
        return subject

    def get_quizzes_by_user(
        self, user_id: UUID, subject_id: Optional[UUID] = None,
        limit: int = 50, offset: int = 0
    ) -> Tuple[List[Quiz], int]:
        """Get all quizzes for a user."""
        query = self.db.query(Quiz).filter(Quiz.user_id == user_id)

        if subject_id:
            query = query.filter(Quiz.subject_id == subject_id)

        total = query.count()
        quizzes = query.order_by(desc(Quiz.created_at)).offset(offset).limit(limit).all()
        return quizzes, total

    def get_quiz_by_id(self, quiz_id: UUID, user_id: UUID) -> Optional[Quiz]:
        """Get a quiz by ID, ensuring user ownership."""
        return (
            self.db.query(Quiz)
            .filter(Quiz.id == quiz_id, Quiz.user_id == user_id)
            .first()
        )

    def delete_quiz(self, quiz_id: UUID, user_id: UUID) -> bool:
        """Delete a quiz (and its questions/results via cascade). Returns
        False if it doesn't exist or isn't owned by this user."""
        quiz = self.get_quiz_by_id(quiz_id, user_id)
        if not quiz:
            return False
        self.db.delete(quiz)
        self.db.commit()
        return True

    async def create_quiz(self, user_id: UUID, data: QuizCreate) -> Quiz:
        """Create a new quiz with AI-generated questions.

        BƯỚC 6 (QUIZ từ file, có RAG):
        - source 'document': questions are generated from RAG chunks of the
          selected documents (data.document_ids, or data.document_id).
        - source 'subject': questions are generated from all READY documents
          of the subject.
        - No document: fall back to topic/subject knowledge.
        """
        # Verify subject ownership
        self._verify_subject_ownership(data.subject_id, user_id)

        # Determine which documents to pull RAG context from
        document_ids: Optional[List[UUID]] = None
        if data.document_ids:
            document_ids = list(data.document_ids)
        elif data.document_id:
            document_ids = [data.document_id]

        source: str = "llm"
        context = ""
        if document_ids:
            context = await self._build_rag_context(user_id, document_ids, data.difficulty)
            source = "document"

        # Create quiz
        quiz = Quiz(
            user_id=user_id,
            subject_id=data.subject_id,
            document_id=data.document_id,
            title=f"Quiz - {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
            difficulty=data.difficulty,
            source=source,
        )
        self.db.add(quiz)
        self.db.commit()
        self.db.refresh(quiz)

        await self._generate_quiz_questions(
            quiz_id=quiz.id,
            user_id=user_id,
            subject_id=data.subject_id,
            num_questions=data.num_questions,
            difficulty=data.difficulty,
            context=context,
        )

        return quiz

    async def _build_rag_context(
        self,
        user_id: UUID,
        document_ids: List[UUID],
        difficulty,
    ) -> str:
        """Retrieve document chunks via the RAG pipeline for quiz generation.

        Returns a combined context string. Raises 404 when no content is found
        so the frontend can show a clear error instead of a silent quiz.
        """
        rag = RAGPipeline()
        # Broad query so retrieval pulls the most representative chunks of
        # each selected document.
        query = "kiến thức chính của tài liệu, khái niệm, định nghĩa, công thức, ví dụ"

        results = await rag.search_documents(
            query=query,
            user_id=user_id,
            document_ids=document_ids,
            limit=15,
        )
        if not results:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy nội dung trong tài liệu đã chọn. Hãy kiểm tra tài liệu đã được xử lý (Ready) chưa."
            )
        return rag.build_context(query, results)

    async def _generate_quiz_questions(
        self,
        quiz_id: UUID,
        user_id: UUID,
        subject_id: UUID,
        num_questions: int,
        difficulty,
        context: str = "",
    ):
        """Generate quiz questions with AI (BƯỚC 6).

        If RAG context is provided, questions are grounded in the document
        content. Otherwise the LLM uses its own knowledge about the subject.
        """
        # Get subject name for context
        subject = self.db.query(Subject).filter(Subject.id == subject_id).first()
        topic_name = subject.name if subject else "kiến thức"

        questions = await llm_manager.generate_quiz(
            topic=topic_name,
            num_questions=num_questions,
            difficulty=difficulty.value if difficulty else "medium",
            context=context,
        )

        # If AI returned nothing (LLM failure), fall back to placeholders so
        # the quiz is still usable, but flag it clearly.
        if not questions:
            await self._generate_placeholder_questions(quiz_id, num_questions)
            return

        letters = ["A", "B", "C", "D"]
        for q in questions:
            if not isinstance(q, dict):
                continue
            question_text = (q.get("question_text") or "").strip()
            options = q.get("options") or []
            if not question_text or len(options) < 2:
                continue
            # Normalize correct_answer: may be an index or a letter
            raw_correct = q.get("correct_answer", 0)
            if isinstance(raw_correct, str) and raw_correct.strip().upper() in letters:
                correct_index = letters.index(raw_correct.strip().upper())
            elif isinstance(raw_correct, int) and 0 <= raw_correct < len(options):
                correct_index = raw_correct
            else:
                correct_index = 0

            question = QuizQuestion(
                quiz_id=quiz_id,
                question_text=question_text,
                options=json.dumps(options[:4]),
                correct_answer=correct_index,
                explanation=(q.get("explanation") or "").strip() or None,
            )
            self.db.add(question)
        self.db.commit()

    async def _generate_placeholder_questions(
        self, quiz_id: UUID, num_questions: int
    ):
        """Generate placeholder questions. Replace with AI generation."""
        for i in range(num_questions):
            question = QuizQuestion(
                quiz_id=quiz_id,
                question_text=f"Câu hỏi mẫu {i + 1}: Đây là câu hỏi placeholder. Cần tích hợp AI để tạo câu hỏi thực sự.",
                options=json.dumps([
                    "Đáp án A",
                    "Đáp án B",
                    "Đáp án C",
                    "Đáp án D"
                ]),
                correct_answer=0,
                explanation="Đây là giải thích placeholder."
            )
            self.db.add(question)
        self.db.commit()

    def submit_quiz(
        self, quiz_id: UUID, user_id: UUID, data: QuizSubmit
    ) -> QuizResult:
        """Submit quiz answers and calculate results."""
        quiz = self.get_quiz_by_id(quiz_id, user_id)
        if not quiz:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Quiz not found"
            )

        # Get all questions
        questions = (
            self.db.query(QuizQuestion)
            .filter(QuizQuestion.quiz_id == quiz_id)
            .all()
        )

        by_id = {question.id: question for question in questions}
        answered_questions = {answer.question_id: answer for answer in data.answers}
        if len(answered_questions) != len(data.answers):
            raise HTTPException(status_code=400, detail="Duplicate question answers")
        for answer in data.answers:
            question = by_id.get(answer.question_id)
            if question is None:
                raise HTTPException(status_code=400, detail="Question does not belong to this quiz")
            options = json.loads(question.options) if isinstance(question.options, str) else question.options
            if not 0 <= answer.selected_answer < len(options):
                raise HTTPException(status_code=400, detail="Invalid answer option")

        # Create quiz result
        correct_count = 0
        result = QuizResult(
            user_id=user_id,
            quiz_id=quiz_id,
            total_questions=len(questions),
            correct_count=0,
            score=0
        )
        self.db.add(result)
        # Persist the result, answers and review dates in one transaction.
        self.db.flush()

        # Grade each answer
        for answer_data in data.answers:
            question = next((q for q in questions if q.id == answer_data.question_id), None)
            if not question:
                continue

            is_correct = answer_data.selected_answer == question.correct_answer
            if is_correct:
                correct_count += 1

            # Create answer record
            answer = QuizAnswer(
                quiz_result_id=result.id,
                question_id=question.id,
                selected_answer=answer_data.selected_answer,
                is_correct=is_correct,
                time_spent=data.time_spent // len(data.answers) if data.time_spent else None,
                used_hint=False
            )
            self.db.add(answer)

        # Handle unanswered questions (create records with is_correct=False)
        review_pairs = []
        for question in questions:
            if question.id not in answered_questions:
                answer = QuizAnswer(
                    quiz_result_id=result.id,
                    question_id=question.id,
                    selected_answer=None,
                    is_correct=False,
                    time_spent=None,
                    used_hint=False
                )
                self.db.add(answer)
                review_pairs.append((question, False))

        # Schedule spaced reviews for the questions that were answered:
        # correct -> +3 days, wrong -> +1 day (v2 1-3-7 day cycle).
        for answer_data in data.answers:
            question = next((q for q in questions if q.id == answer_data.question_id), None)
            if question:
                review_pairs.append((question, answer_data.selected_answer == question.correct_answer))
        self._schedule_reviews(user_id, review_pairs)

        # Update result
        result.correct_count = correct_count
        # Skipped questions count as incorrect, matching the frontend grade.
        result.score = (correct_count / len(questions) * 100) if questions else 0

        self.db.commit()
        self.db.refresh(result)

        return result

    def _schedule_reviews(self, user_id: UUID, pairs: List[Tuple[QuizQuestion, bool]]) -> None:
        """Spaced-repetition schedule (v2): correct -> +3 days, wrong -> +1 day.
        One row per (question, user), upserted so re-answering moves the due date.

        Dedup by question id first, then fetch every existing Review row for
        this user+question set in ONE query - a quiz can have up to 50
        questions now, and doing this per-question (1 SELECT each) was 50
        round-trips to Neon, a big chunk of the delay users felt on submit.
        """
        today = today_hcm()
        by_question: dict = {}
        for question, is_correct in pairs:
            by_question[question.id] = (question, is_correct)

        if not by_question:
            return

        existing = {
            row.question_id: row
            for row in self.db.query(Review).filter(
                Review.user_id == user_id,
                Review.question_id.in_(by_question.keys()),
            ).all()
        }

        for question_id, (question, is_correct) in by_question.items():
            interval = 3 if is_correct else 1
            next_review = today + timedelta(days=interval)
            row = existing.get(question_id)
            if row:
                row.next_review = next_review
                row.interval_days = interval
            else:
                self.db.add(Review(
                    question_id=question.id,
                    user_id=user_id,
                    next_review=next_review,
                    interval_days=interval,
                ))
        # The caller commits together with the completed result and answers.

    # ------------------------------------------------------------------
    # Due-review quiz: questions whose spaced-repetition date has come
    # ------------------------------------------------------------------

    def create_quiz_from_review(
        self,
        user_id: UUID,
        subject_id: Optional[UUID] = None,
        num_questions: int = 10,
        difficulty="medium",
    ) -> Quiz:
        """Build a review quiz from the questions due for spaced review
        (correct -> due in 3 days, wrong -> due in 1 day). 404 when
        nothing is due yet."""
        today = today_hcm()
        if subject_id:
            self._verify_subject_ownership(subject_id, user_id)
        query = (
            self.db.query(Review)
            .join(QuizQuestion, Review.question_id == QuizQuestion.id)
            .join(Quiz, QuizQuestion.quiz_id == Quiz.id)
            .filter(Review.user_id == user_id, Quiz.user_id == user_id, Review.next_review <= today)
        )
        if subject_id:
            query = query.filter(Quiz.subject_id == subject_id)
        q = query.order_by(Review.next_review.asc(), Review.id).limit(num_questions).all()
        if not q:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chưa có câu hỏi nào đến hạn ôn tập.",
            )
        diff = None
        try:
            diff = QuizDifficulty(difficulty) if not hasattr(difficulty, "value") else difficulty
        except ValueError:
            diff = None
        quiz = Quiz(
            user_id=user_id,
            subject_id=subject_id,
            title="Ôn tập đến hạn",
            difficulty=diff or "medium",
            source="review",
        )
        self.db.add(quiz)
        self.db.commit()
        self.db.refresh(quiz)
        for r in q:
            src = r.question
            self.db.add(QuizQuestion(
                quiz_id=quiz.id,
                question_text=src.question_text,
                options=src.options,
                correct_answer=src.correct_answer,
                explanation=src.explanation,
            ))
        self.db.commit()
        self.db.refresh(quiz)
        return quiz

    def get_quiz_result(
        self, quiz_id: UUID, result_id: UUID, user_id: UUID
    ) -> Optional[QuizResult]:
        """Get quiz result with answers."""
        result = (
            self.db.query(QuizResult)
            .filter(
                QuizResult.id == result_id,
                QuizResult.quiz_id == quiz_id,
                QuizResult.user_id == user_id
            )
            .first()
        )
        return result

    def get_quiz_results_by_user(
        self, user_id: UUID, quiz_id: Optional[UUID] = None,
        limit: int = 50, offset: int = 0
    ) -> Tuple[List[QuizResult], int]:
        """Get quiz history for a user."""
        query = self.db.query(QuizResult).filter(QuizResult.user_id == user_id)

        if quiz_id:
            query = query.filter(QuizResult.quiz_id == quiz_id)

        total = query.count()
        results = query.order_by(desc(QuizResult.created_at)).offset(offset).limit(limit).all()
        return results, total

    # ------------------------------------------------------------------
    # Review quizzes: retry-wrong
    # ------------------------------------------------------------------

    def create_quiz_from_wrong(self, user_id: UUID, result_id: UUID) -> Quiz:
        """Retry quiz: a new quiz made of the questions the user FAILED
        in a specific result. 404 when there is nothing to retry."""
        result = (
            self.db.query(QuizResult)
            .filter(QuizResult.id == result_id, QuizResult.user_id == user_id)
            .first()
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy kết quả làm bài.",
            )
        wrong_answers = [a for a in result.answers if not a.is_correct and a.question]
        if not wrong_answers:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Bài này không có câu sai để làm lại.",
            )
        original_quiz = result.quiz
        quiz = Quiz(
            user_id=user_id,
            subject_id=original_quiz.subject_id if original_quiz else None,
            document_id=original_quiz.document_id if original_quiz else None,
            title="Làm lại câu sai",
            difficulty=original_quiz.difficulty if original_quiz else "medium",
            source="wrong",
        )
        self.db.add(quiz)
        self.db.commit()
        self.db.refresh(quiz)
        for a in wrong_answers:
            q = a.question
            self.db.add(QuizQuestion(
                quiz_id=quiz.id,
                question_text=q.question_text,
                options=q.options,
                correct_answer=q.correct_answer,
                explanation=q.explanation,
            ))
        self.db.commit()
        self.db.refresh(quiz)
        return quiz

    # ------------------------------------------------------------------
    # Simple subject-scoped quiz: shared bank + verified AI + dedup
    # ------------------------------------------------------------------

    def _subject_key(self, subject: Subject) -> str:
        return subject_key_for(subject.name)

    def list_shared_bank(
        self,
        subject_key: str,
        topic: Optional[str] = None,
        exclude_texts: Optional[List[str]] = None,
        limit: int = 50,
    ) -> List[SharedQuizQuestion]:
        """Questions available in the shared bank for a subject key, filtered
        by topic and by the texts to exclude (recently-used questions)."""
        query = self.db.query(SharedQuizQuestion).filter(
            SharedQuizQuestion.subject_key == subject_key
        )
        if topic:
            query = query.filter(SharedQuizQuestion.topic == topic)
        if exclude_texts:
            query = query.filter(~SharedQuizQuestion.question_text.in_(exclude_texts))
        return query.limit(limit).all()

    async def suggest_topics_for_subject(
        self,
        user_id: UUID,
        subject_id: UUID,
        document_ids: Optional[List[UUID]] = None,
        existing_topics: Optional[List[str]] = None,
    ) -> List[str]:
        """Ask the AI to detect the main topics covered by `document_ids`
        (RAG context), or by every READY document of the subject when
        `document_ids` is omitted, so the user can pick one to quiz on.
        `existing_topics`, when given, is forwarded so the model skips
        anything already covered (see llm_manager.suggest_topics)."""
        subject = self._verify_subject_ownership(subject_id, user_id)
        if document_ids is None:
            ready_docs = (
                self.db.query(Document)
                .filter(
                    Document.user_id == user_id,
                    Document.subject_id == subject_id,
                    Document.status == DocumentStatus.READY,
                )
                .all()
            )
            document_ids = [d.id for d in ready_docs]
        if not document_ids:
            return []
        context = ""
        try:
            context = await self._build_rag_context(user_id, document_ids, "medium")
        except HTTPException:
            context = ""
        if not context:
            return []
        return await llm_manager.suggest_topics(
            subject.name, context, limit=8, existing_topics=existing_topics
        )

    async def ensure_document_topics(self, user_id: UUID, document: Document) -> List[str]:
        """Topics for exactly this one document, generated once and cached
        on Document.topics_json (not merged with any other document's -
        each document gets its own independent topic list and, via
        PathService, its own independently-gated Lộ trình). Backfills
        documents that predate this column (topics_json still NULL)."""
        if document.topics_json:
            return json.loads(document.topics_json)
        if document.status != DocumentStatus.READY or not document.subject_id:
            return []
        subject = self.db.query(Subject).filter(Subject.id == document.subject_id).first()
        if not subject:
            return []
        topics = await self.suggest_topics_for_subject(
            user_id, document.subject_id, document_ids=[document.id]
        )
        if not topics:
            # Cache the negative result too (a non-empty JSON string "[]",
            # still truthy) - otherwise the check above stays falsy forever
            # for a document the AI genuinely has nothing to say about, and
            # every future call (every "Tạo Quiz" open, every Lộ trình view)
            # retries the full RAG+LLM round trip for it again instead of
            # remembering "nothing here".
            document.topics_json = "[]"
            self.db.commit()
            return []
        ordered = await llm_manager.order_topics(subject.name, [], topics)
        document.topics_json = json.dumps(ordered, ensure_ascii=False)
        self.db.commit()
        return ordered

    async def create_next_quiz(
        self,
        user_id: UUID,
        subject_id: UUID,
        topic: Optional[str] = None,
        all_knowledge: bool = False,
        num_questions: int = 5,
        difficulty="medium",
        document_id: Optional[UUID] = None,
    ) -> Quiz:
        """Create the next quiz for a subject.

        Pool order (dedup, decision: a new quiz must not equal the last one):
          1. Shared bank for this subject key (filtered by topic unless the user
             asked for all knowledge), EXCLUDING questions the user has already
             seen in recent quizzes for this subject.
          2. Fresh AI questions for the topic (RAG context when the subject has
             READY docs), each verified by the AI as belonging to the subject,
             then upserted into the shared bank so it grows for everyone.
        A little overlap is allowed only when the available pool is shorter
        than the requested count.
        """
        subject = self._verify_subject_ownership(subject_id, user_id)
        skey = self._subject_key(subject)

        # 1) Recently-used question texts for this subject (dedup source).
        seen = {
            q.question_text
            for quiz in (
                self.db.query(Quiz)
                .filter(Quiz.user_id == user_id, Quiz.subject_id == subject_id)
                .order_by(desc(Quiz.created_at))
                .limit(5)
                .all()
            )
            for q in quiz.questions
        }

        pool = self.list_shared_bank(skey, topic=None if all_knowledge else topic,
                                     exclude_texts=[s for s in seen if s])
        used_ai = False

        # 2) Fill the gap with fresh, verified AI questions. A single round can
        # fall short of `remaining` - the model may return fewer raw proposals
        # than asked, or AI-verify can reject several of them - so retry a few
        # more rounds asking for just what's still missing (excluding anything
        # already kept, so the model doesn't re-propose the same question).
        # Stop early once a round yields nothing - the model has no more to
        # give for this scope, further attempts would just waste time.
        remaining = num_questions - len(pool)
        if remaining > 0:
            exclude = set(seen)
            for _ in range(3):
                if remaining <= 0:
                    break
                ai_questions = await self._generate_verified_ai_questions(
                    user_id, subject, topic, all_knowledge, remaining, difficulty, exclude,
                    document_id=document_id,
                )
                if not ai_questions:
                    break
                # "Tổng hợp" (all-knowledge) questions get no per-question
                # topic (topic=None here) - they have no document_id either,
                # so there is no per-document Lộ trình path for them to be
                # attributed to anyway (see PathService.document_topic_groups,
                # filtered by Quiz.document_id).
                pool = pool + [
                    self._upsert_shared(skey, q, None if all_knowledge else topic)
                    for q in ai_questions
                ]
                exclude |= {q["question_text"] for q in ai_questions}
                used_ai = True
                remaining = num_questions - len(pool)

        # Take the requested amount; allow slight overlap if the pool is short.
        chosen = random.sample(pool, num_questions) if len(pool) > num_questions else pool
        if not chosen:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chưa có câu hỏi cho phạm vi này. Hãy tải tài liệu cho môn hoặc mở rộng phạm vi 'Ôn tất cả kiến thức'.",
            )

        from app.models import QuizDifficulty as _QD
        try:
            diff = _QD(difficulty) if not hasattr(difficulty, "value") else difficulty
        except ValueError:
            diff = _QD.MEDIUM

        # Distinguish repeated quizzes of the same scope ("Tổng hợp", or a
        # given topic) with a running count instead of a title that's
        # identical every time (previously `subject.name` when all_knowledge,
        # so every "Tổng hợp" quiz in a subject shared one title).
        label = topic.strip() if topic else "Tổng hợp"
        existing_count = (
            self.db.query(Quiz)
            .filter(
                Quiz.user_id == user_id,
                Quiz.subject_id == subject_id,
                Quiz.title.like(f"{label} #%"),
            )
            .count()
        )
        quiz = Quiz(
            user_id=user_id,
            subject_id=subject_id,
            document_id=document_id,
            title=f"{label} #{existing_count + 1}",
            # Recorded so Lộ trình (path_service.document_topic_groups) can
            # later tell which quizzes count toward which (document, topic)
            # path's progress. NULL for "Tổng hợp"/all-knowledge quizzes -
            # those don't count toward any one topic.
            topic=topic.strip() if (topic and not all_knowledge) else None,
            difficulty=diff,
            source="ai" if used_ai else "shared",
        )
        self.db.add(quiz)
        self.db.commit()
        self.db.refresh(quiz)

        for q in chosen:
            self.db.add(QuizQuestion(
                quiz_id=quiz.id,
                question_text=q.question_text,
                options=q.options,
                correct_answer=q.correct_answer,
                explanation=q.explanation,
                # Every `chosen` row is a SharedQuizQuestion, which already
                # carries its own per-question topic (even inside a "Tổng
                # hợp" pool) - copy it over so wrong answers can be
                # attributed to a topic regardless of this quiz's own scope.
                topic=q.topic,
            ))
        self.db.commit()
        self.db.refresh(quiz)
        return quiz

    async def _generate_verified_ai_questions(
        self,
        user_id: UUID,
        subject: Subject,
        topic: Optional[str],
        all_knowledge: bool,
        count: int,
        difficulty,
        seen_texts: set,
        document_id: Optional[UUID] = None,
    ) -> List[dict]:
        """Generate `count` NEW questions for the subject (optionally narrowed
        to `topic`), grounded in RAG context when available. Each question is
        AI-verified against the subject; only verified ones are kept.

        `document_id`, when given (a Lộ trình topic scoped to one specific
        document), narrows the RAG context to just that document instead of
        every READY document of the subject - keeps generated questions on
        the exact material the topic came from.
        """
        context = ""
        if document_id:
            doc_ids = [document_id]
        else:
            ready_docs = (
                self.db.query(Document)
                .filter(
                    Document.user_id == user_id,
                    Document.subject_id == subject.id,
                    Document.status == DocumentStatus.READY,
                )
                .all()
            )
            doc_ids = [d.id for d in ready_docs]
        if doc_ids:
            try:
                context = await self._build_rag_context(user_id, doc_ids, difficulty)
            except HTTPException:
                context = ""

        diff_val = difficulty.value if hasattr(difficulty, "value") else str(difficulty)
        generated = await llm_manager.generate_quiz(
            topic=(topic or ("toàn bộ kiến thức của môn " + subject.name)),
            num_questions=count + 2,  # over-generate a little to survive verification
            difficulty=diff_val,
            context=context,
            subject=subject.name,
            excluded=[s for s in seen_texts][:20],
        )

        kept: List[dict] = []
        for q in generated or []:
            if len(kept) >= count:
                break
            if not isinstance(q, dict):
                continue
            text = (q.get("question_text") or "").strip()
            options = (q.get("options") or [])[:4]
            if not text or len(options) < 2 or text in seen_texts:
                continue
            verdict = await llm_manager.verify_quiz_question(
                subject=subject.name,
                topic=topic,
                question={
                    "question_text": text,
                    "options": options,
                    "correct_answer": q.get("correct_answer", 0),
                },
                context=context,
            )
            if not verdict.get("ok"):
                continue
            kept.append({
                "question_text": text,
                "options": options,
                "correct_answer": self._normalize_correct(q.get("correct_answer", 0), len(options)),
                "explanation": (q.get("explanation") or "").strip() or None,
            })
        return kept

    @staticmethod
    def _normalize_correct(raw: int, option_count: int) -> int:
        """Accept a correct-answer given as an index or a letter (A/B/C/D)."""
        letters = ["A", "B", "C", "D"]
        if isinstance(raw, str) and raw.strip().upper() in letters:
            return letters.index(raw.strip().upper())
        if isinstance(raw, int) and 0 <= raw < option_count:
            return raw
        return 0

    def _upsert_shared(self, skey: str, data: dict, topic: Optional[str]) -> SharedQuizQuestion:
        """Add a verified AI question to the shared bank (unique on
        subject_key + question_text); returns the stored row so it can be used
        immediately in this quiz."""
        existing = (
            self.db.query(SharedQuizQuestion)
            .filter(
                SharedQuizQuestion.subject_key == skey,
                SharedQuizQuestion.question_text == data["question_text"],
            )
            .first()
        )
        if existing:
            return existing
        row = SharedQuizQuestion(
            subject_key=skey,
            topic=topic,
            question_text=data["question_text"],
            options=json.dumps(data["options"]),
            correct_answer=data["correct_answer"],
            explanation=data.get("explanation"),
            difficulty="medium",
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row


async def backfill_document_topics_in_background(document_id: UUID, user_id: UUID) -> None:
    """Compute + cache Document.topics_json for one document WITHOUT the
    caller waiting on it - meant to be scheduled with `asyncio.create_task`
    from a request handler that needs to respond immediately (GET /documents/,
    PathService.document_topic_groups), not block on a RAG+LLM round trip.

    Opens its own short-lived session rather than reusing the request's
    (same reasoning as DocumentService.process_document / recover_stuck_documents:
    the request's session/connection is gone by the time this runs, since the
    request already returned)."""
    from app.database import SessionLocal
    with SessionLocal() as s:
        doc = s.query(Document).filter(Document.id == document_id).first()
        if doc:
            try:
                await QuizService(s).ensure_document_topics(user_id, doc)
            except Exception:
                pass
