from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Subject, Document, Quiz
from app.schemas.subject import SubjectCreate, SubjectUpdate
from fastapi import HTTPException, status


class SubjectService:
    def __init__(self, db: Session):
        self.db = db

    def get_subjects_by_user(self, user_id: UUID) -> List[Subject]:
        """Get all subjects for a user."""
        return (
            self.db.query(Subject)
            .filter(Subject.user_id == user_id)
            .order_by(Subject.created_at.desc())
            .all()
        )

    def get_known_names(self, query: Optional[str] = None, limit: int = 300) -> List[str]:
        """Distinct subject names that already exist (across EVERY user, not
        just the caller's own) - lets someone naming a new subject pick an
        existing, slightly-differently-spelled name instead of inventing yet
        another variant. Matters because the shared question bank is keyed by
        subject_key_for(name) (quiz_service.py/subject_key.py): two subjects
        named "NLP" and "Xử lý ngôn ngữ tự nhiên" (or just different casing/
        spacing the alias list doesn't cover) end up as two SEPARATE pools
        instead of sharing one. Cross-user by design, same sharing scope as
        the bank itself.

        `query` is rarely used now - the frontend fetches once (no query,
        this default limit) and filters client-side as the user types, to
        stay instant instead of a per-keystroke round trip. Kept as an
        optional server-side narrowing for any other caller that does want it."""
        q = self.db.query(Subject.name).distinct()
        if query and query.strip():
            q = q.filter(Subject.name.ilike(f"%{query.strip()}%"))
        rows = q.order_by(Subject.name).limit(limit).all()
        return [row[0] for row in rows]

    def get_subject_by_id(self, subject_id: UUID, user_id: UUID) -> Optional[Subject]:
        """Get a subject by ID, ensuring user ownership."""
        subject = (
            self.db.query(Subject)
            .filter(Subject.id == subject_id, Subject.user_id == user_id)
            .first()
        )
        return subject

    def create_subject(self, user_id: UUID, subject_data: SubjectCreate) -> Subject:
        """Create a new subject."""
        # Check duplicate name (case-insensitive) within the same user's subjects
        normalized_name = subject_data.name.strip()
        existing = (
            self.db.query(Subject)
            .filter(
                Subject.user_id == user_id,
                func.lower(Subject.name) == normalized_name.lower(),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Bạn đã có môn học với tên \"{existing.name}\".",
            )

        subject = Subject(
            user_id=user_id,
            name=normalized_name,
            description=subject_data.description,
            color=subject_data.color,
            icon=subject_data.icon,
            learning_goal=subject_data.learning_goal,
            start_date=subject_data.start_date,
            deadline=subject_data.deadline
        )
        self.db.add(subject)
        self.db.commit()
        self.db.refresh(subject)

        return subject

    def update_subject(self, subject_id: UUID, user_id: UUID, subject_data: SubjectUpdate) -> Subject:
        """Update a subject."""
        subject = self.get_subject_by_id(subject_id, user_id)
        if not subject:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subject not found"
            )

        update_data = subject_data.model_dump(exclude_unset=True)

        # If renaming, check duplicate name within the same user's subjects
        if "name" in update_data and update_data["name"] is not None:
            new_name = update_data["name"].strip()
            duplicate = (
                self.db.query(Subject)
                .filter(
                    Subject.user_id == user_id,
                    Subject.id != subject_id,
                    func.lower(Subject.name) == new_name.lower(),
                )
                .first()
            )
            if duplicate:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Bạn đã có môn học với tên \"{duplicate.name}\".",
                )
            update_data["name"] = new_name

        for field, value in update_data.items():
            setattr(subject, field, value)

        self.db.commit()
        self.db.refresh(subject)
        return subject

    async def delete_subject(self, subject_id: UUID, user_id: UUID) -> bool:
        """Delete a subject and everything in it. The ORM cascade on Subject
        deletes its documents, conversations and quizzes rows; each document's
        vectors/file/figures and each conversation's attachment files live
        outside the DB, so purge them first."""
        from app.services.document_service import DocumentService

        subject = self.get_subject_by_id(subject_id, user_id)
        if not subject:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subject not found"
            )

        from app.services.chat_attachment_service import ChatAttachmentService

        documents = DocumentService(self.db)
        for document in subject.documents:
            await documents.purge_storage(document)
        attachments = ChatAttachmentService(self.db)
        for conversation in subject.conversations:
            await attachments.purge_conversation(conversation.id, user_id)
        self.db.delete(subject)
        self.db.commit()
        return True

    def get_subject_stats(self, subject_id: UUID, user_id: UUID) -> dict:
        """Get statistics for ONE subject - 3 round trips (ownership check +
        2 counts). Fine for the single-subject endpoints that call this
        (GET /subjects/{id}, /{id}/stats, update); for the LIST endpoint use
        get_stats_for_subjects instead - calling this once per subject there
        turned "load the subjects list" into 1 + 3*N round trips to Neon, the
        single biggest contributor to the whole app feeling slow on load."""
        subject = self.get_subject_by_id(subject_id, user_id)
        if not subject:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subject not found"
            )

        total_documents = self.db.query(Document).filter(Document.subject_id == subject_id).count()
        total_quizzes = self.db.query(Quiz).filter(Quiz.subject_id == subject_id).count()

        return {
            "total_documents": total_documents,
            "total_quizzes": total_quizzes,
            "last_activity": None
        }

    def get_stats_for_subjects(self, subject_ids: List[UUID]) -> dict:
        """Document/quiz counts for MANY subjects at once - exactly 2 GROUP BY
        round trips regardless of how many subjects, vs. get_subject_stats'
        3 round trips EACH if called in a loop. Returns {subject_id: {
        total_documents, total_quizzes, last_activity}}; a subject_id with no
        rows in a count simply doesn't appear in that count's dict (treated
        as 0 below), there is no row to return."""
        if not subject_ids:
            return {}
        doc_counts = dict(
            self.db.query(Document.subject_id, func.count(Document.id))
            .filter(Document.subject_id.in_(subject_ids))
            .group_by(Document.subject_id)
            .all()
        )
        quiz_counts = dict(
            self.db.query(Quiz.subject_id, func.count(Quiz.id))
            .filter(Quiz.subject_id.in_(subject_ids))
            .group_by(Quiz.subject_id)
            .all()
        )
        return {
            sid: {
                "total_documents": doc_counts.get(sid, 0),
                "total_quizzes": quiz_counts.get(sid, 0),
                "last_activity": None,
            }
            for sid in subject_ids
        }
