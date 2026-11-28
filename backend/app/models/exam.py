from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.types import Uuid

from app.database import Base


class ExamAssignment(Base):
    __tablename__ = "exam_assignments"
    __table_args__ = {"info": {"explicit_install": True}}

    id = Column(Uuid, primary_key=True, default=uuid4)
    class_id = Column(Uuid, ForeignKey("class_rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    questions = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ExamSubmission(Base):
    __tablename__ = "exam_submissions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "user_id", name="uq_exam_submission_student"),
        {"info": {"explicit_install": True}},
    )

    id = Column(Uuid, primary_key=True, default=uuid4)
    assignment_id = Column(Uuid, ForeignKey("exam_assignments.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    analysis = Column(Text, nullable=False)
    official = Column(Text, nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ExamFile(Base):
    __tablename__ = "exam_files"
    __table_args__ = {"info": {"explicit_install": True}}

    id = Column(Uuid, primary_key=True, default=uuid4)
    submission_id = Column(Uuid, ForeignKey("exam_submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(16), nullable=False)
    position = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    media_type = Column(String(32), nullable=False)
    content = Column(LargeBinary, nullable=False)
