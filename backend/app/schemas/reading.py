from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ReadingAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    # Pages the user is currently reading; citation prefers to cite here.
    context_pages: Optional[List[int]] = Field(
        None, description="Trang người dùng đang xem; ưu tiên trích dẫn ở đây."
    )


class ReadingAskResponse(BaseModel):
    answer: str
    # RAGPipeline.extract_sources() dicts (document_name, page, figure, ...)
    sources: List[dict]
    figure_note: Optional[str] = None
    # Set when the question was a "tóm tắt" request routed to the summarizer;
    # the summary is also persisted as a `summary` annotation.
    kind: Optional[str] = None  # "summary"
    pages: Optional[List[int]] = None  # [from_page, to_page] when kind == "summary"


class ReadingSummarizeRequest(BaseModel):
    from_page: int = Field(..., ge=1)
    to_page: int = Field(..., ge=1)


class ReadingSummarizeResponse(BaseModel):
    summary: str
    pages: List[int]  # [from_page, to_page]


class ReadingAnnotationCreate(BaseModel):
    page: Optional[int] = Field(None, ge=1)
    text: str = Field(..., min_length=1, max_length=2000)
    type: str = "note"  # "note" | "highlight" | "summary"


class ReadingAnnotationResponse(BaseModel):
    id: UUID
    document_id: UUID
    user_id: UUID
    page: Optional[int]
    text: str
    type: str
    created_at: datetime

    class Config:
        from_attributes = True


class ReadingChatMessageResponse(BaseModel):
    """One row of the document-scoped reading Q&A history (separate from the
    Tutor conversation system)."""
    id: UUID
    role: str  # "user" | "assistant"
    content: str
    sources: Optional[List[dict]] = None
    figure_note: Optional[str] = None
    kind: Optional[str] = None  # "summary" when the answer was a summarize intent
    label: Optional[str] = None  # e.g. "Tóm tắt trang 1-26"
    created_at: datetime

    class Config:
        from_attributes = True


class ReadingChatAppendRequest(BaseModel):
    """Persist one exchange: the user question + the assistant answer the
    frontend just received. Called in pairs (or single) by the reading panel
    after each turn so the dialogue survives refreshes."""
    user_message: Optional[str] = None
    assistant_message: Optional[str] = None
    sources: Optional[List[dict]] = None
    figure_note: Optional[str] = None
    kind: Optional[str] = None  # "summary" when the answer was a summarize intent
    label: Optional[str] = None
