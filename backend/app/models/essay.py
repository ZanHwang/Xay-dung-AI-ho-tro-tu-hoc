import uuid
from datetime import datetime
from sqlalchemy import Column, Float, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class Essay(Base):
    """A graded (or pending) short-essay answer, scored by AI against a rubric
    (merged from tu-hoc-rag-v2). `rubric` and `feedback` are stored as JSON in
    Text columns to match the project's JSON-in-Text convention.
    - `rubric`:   [{criterion, max}, ...]
    - `feedback`: {scores: [{criterion, score, max, quote, feedback}], overall}
    `status` is "pending" (awaiting teacher batch grading) or "graded".
    """
    __tablename__ = "essays"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("class_rooms.id", ondelete="SET NULL"), nullable=True)
    prompt = Column(Text, nullable=False)
    rubric = Column(Text, nullable=False)  # JSON array
    essay = Column(Text, nullable=False)
    total = Column(Float, nullable=True)
    max_total = Column(Float, nullable=True)
    feedback = Column(Text, nullable=True)  # JSON object
    status = Column(String(20), nullable=False, default="graded")
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    subject = relationship("Subject")
    user = relationship("User")
    class_room = relationship("ClassRoom")
