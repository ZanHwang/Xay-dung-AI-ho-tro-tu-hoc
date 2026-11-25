import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class SharedQuizQuestion(Base):
    """A reusable multiple-choice question shared by ALL users for a subject.

    Keyed by a normalized `subject_key` (e.g. "machine_learning") so that two
    users who both have a "Học máy" / "Machine Learning" subject draw from the
    same pool. `created_by` records which user's AI generated it; `topic` is a
    free-form label so a subject's knowledge can be organised without a formal
    Topic row.
    """
    __tablename__ = "shared_quiz_questions"
    __table_args__ = (
        UniqueConstraint("subject_key", "question_text", name="uq_shared_qq_key_text"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_key = Column(String(80), nullable=False, index=True)
    topic = Column(String(255), nullable=True)
    question_text = Column(Text, nullable=False)
    options = Column(Text, nullable=False)  # JSON array of option strings
    correct_answer = Column(Integer, nullable=False)  # index into options
    explanation = Column(Text, nullable=True)
    difficulty = Column(String(20), nullable=False, default="medium")
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
