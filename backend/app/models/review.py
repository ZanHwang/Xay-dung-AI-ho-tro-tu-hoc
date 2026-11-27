import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, DateTime, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class Review(Base):
    """Spaced-repetition schedule for a quiz question the user got wrong/right
    (merged from tu-hoc-rag-v2, graduated-ladder rewrite). `stage` is the index
    into QuizService.REVIEW_SCHEDULE (1h, 4h, 24h, 3d, 7d, 14d, 30d, then stays
    at 30d): correct -> advance one stage, wrong -> back to stage 0, at any
    point. `next_review` is the next due timestamp; `last_correct` is the most
    recent answer's correctness, kept only for display (not scheduling).
    """
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("question_id", "user_id", name="uq_review_question_user"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    question_id = Column(UUID(as_uuid=True), ForeignKey("quiz_questions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    next_review = Column(DateTime, nullable=False)
    stage = Column(Integer, nullable=False, default=0)
    last_correct = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    question = relationship("QuizQuestion")
    user = relationship("User", back_populates="reviews")
