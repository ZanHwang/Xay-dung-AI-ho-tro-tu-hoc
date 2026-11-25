from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from app.models.document import DocumentStatus


class DocumentBase(BaseModel):
    filename: str
    file_type: str
    file_size: Optional[int] = None


class DocumentUpload(BaseModel):
    subject_id: Optional[UUID] = None


class DocumentUpdate(BaseModel):
    subject_id: Optional[UUID] = None


class DocumentResponse(DocumentBase):
    id: UUID
    user_id: UUID
    subject_id: Optional[UUID] = None
    status: DocumentStatus
    total_pages: Optional[int] = None
    # SQLAlchemy reserves the `metadata` attribute on declarative classes, so the
    # column is named `message_metadata` in the model. We expose it as `metadata`
    # in the API and read it via the `message_metadata` attribute on the ORM row.
    metadata: Optional[str] = Field(default=None, validation_alias="message_metadata")
    error_message: Optional[str] = None
    # This document's own AI-detected topics (Document.topics_json via the
    # `topics` property), already ordered learn-this-before-that - used to
    # group "Tạo Quiz" chips and Lộ trình per document.
    topics: List[str] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


class DocumentStatusResponse(BaseModel):
    id: UUID
    status: DocumentStatus
    error_message: Optional[str] = None


class DocumentListResponse(BaseModel):
    total: int
    documents: List[DocumentResponse]


class DocumentProcessRequest(BaseModel):
    force_reprocess: bool = False
