from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class DocumentStudy(Base):
    """When the owner of a document last opened one of its "Học" lessons.

    Together with the document's latest full quiz attempt this decides which
    Lộ trình the "Học tiếp" card continues - see PathService.continue_topic.
    One row per document (a document already belongs to exactly one user).
    """
    __tablename__ = "document_studies"

    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    last_studied_at = Column(DateTime, nullable=False, default=datetime.utcnow)
