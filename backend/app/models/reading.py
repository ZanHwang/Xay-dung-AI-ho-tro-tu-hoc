import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID, JSON
from app.database import Base


class ReadingAnnotation(Base):
    """A highlight, note, or chapter summary saved against a document page in
    the reading workspace (HDS BƯỚC 6 - Immersive Reading).

    - `type` is a plain-string column (same style as AskSession.status):
      "note" | "highlight" | "summary".
    - `page` is 1-based and nullable (a note added with no page context).
    - A chapter summary is stored with `page` = range start and `type` =
      "summary" so it shows up in the notes panel next to notes/highlights.
    """
    __tablename__ = "reading_annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    page = Column(Integer, nullable=True)
    text = Column(Text, nullable=False)
    type = Column(String(20), nullable=False, default="note")  # "note" | "highlight" | "summary"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ReadingChatMessage(Base):
    """One turn of the document-scoped Q&A panel (reading workspace).

    Kept per (user, document) in its OWN table so the chat history of a
    specific file survives refreshes / device changes WITHOUT touching the
    Tutor conversation system - the reading panel's dialogue never bleeds
    into /api/conversations.
    """
    __tablename__ = "reading_chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False, default="user")  # "user" | "assistant"
    content = Column(Text, nullable=False)
    sources = Column(JSON, nullable=True)  # RAG sources (assistant answers only)
    figure_note = Column(Text, nullable=True)  # vision analysis attached to the answer
    kind = Column(String(20), nullable=True)  # "summary" when the answer was a summarize intent
    label = Column(String(200), nullable=True)  # e.g. "Tóm tắt trang 1-26"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
