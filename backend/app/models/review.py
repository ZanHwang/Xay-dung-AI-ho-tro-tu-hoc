import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, DateTime, ForeignKey, Date, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class Review(Base):
    """Spaced-repetition schedule for a quiz question the user got wrong/right
    (merged from tu-hoc-rag-v2). After answering a question, a review row is
    written so the question resurfaces in a due quiz: correct → +3 days,
    wrong → +1 day. `next_review` is the first date the question is due again.
    """
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("question_id", "user_id", name="uq_review_question_user"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    question_id = Column(UUID(as_uuid=True), ForeignKey("quiz_questions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    next_review = Column(Date, nullable=False)
    interval_days = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    question = relationship("QuizQuestion")
    user = relationship("User", back_populates="reviews")
