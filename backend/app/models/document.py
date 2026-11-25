import json
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class DocumentStatus(str, enum.Enum):
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    EXTRACTING = "extracting"
    OCR_PROCESSING = "ocr_processing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    READY = "ready"
    FAILED = "failed"


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    file_type = Column(String(20), nullable=False)  # pdf, docx, pptx
    file_size = Column(Integer, nullable=True)  # bytes
    status = Column(Enum(DocumentStatus), default=DocumentStatus.UPLOADING)
    total_pages = Column(Integer, nullable=True)
    message_metadata = Column(Text, nullable=True)  # JSON string
    error_message = Column(Text, nullable=True)
    # AI-detected topics for THIS document alone (JSON list of strings,
    # already ordered learn-this-before-that - see
    # QuizService.ensure_document_topics / LLMManager.order_topics). Lộ
    # trình and "Tạo Quiz" group chips by document using this, instead of
    # the old subject-wide merged list that used to live on Subject
    # (removed, owner-confirmed cleanup).
    topics_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="documents")
    subject = relationship("Subject", back_populates="documents")

    @property
    def topics(self) -> list:
        """Parsed `topics_json`, read by DocumentResponse (from_attributes)."""
        return json.loads(self.topics_json) if self.topics_json else []
