import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class ClassRoom(Base):
    """A class (group of students) owned by a teacher (merged from
    tu-hoc-rag-v2). `code` is a short 6-char join code."""
    __tablename__ = "class_rooms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    code = Column(String(10), nullable=False, unique=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    teacher = relationship("User", back_populates="classes")
    enrollments = relationship("Enrollment", back_populates="class_room", cascade="all, delete-orphan")


class Enrollment(Base):
    """Links a student (user) to a class they belong to. A teacher auto-
    enrolls themselves when creating a class."""
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("class_id", "user_id", name="uq_enrollment_class_user"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("class_rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    class_room = relationship("ClassRoom", back_populates="enrollments")
    user = relationship("User", back_populates="enrollments")
