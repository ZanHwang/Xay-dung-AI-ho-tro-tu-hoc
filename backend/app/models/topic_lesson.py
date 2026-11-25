import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class TopicLesson(Base):
    """Cached "Học" content for one (document, topic) pair of the Lộ trình
    feature: an AI-written summary plus the source excerpts (from that SAME
    document only) it was grounded on. Generated once (on first request) and
    reused after that - see PathService.get_or_create_lesson - so revisiting
    a topic's Học screen never re-triggers RAG search + an LLM call.
    """
    __tablename__ = "topic_lessons"
    __table_args__ = (
        UniqueConstraint("document_id", "topic", name="uq_topic_lesson_document_topic"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    topic = Column(String(255), nullable=False)
    summary = Column(Text, nullable=False)
    excerpts_json = Column(Text, nullable=False)  # JSON [{document_name, page, content}]
    created_at = Column(DateTime, default=datetime.utcnow)
