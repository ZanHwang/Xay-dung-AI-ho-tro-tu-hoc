from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, ReadingAnnotation
from app.schemas.reading import (
    ReadingAskRequest,
    ReadingAskResponse,
    ReadingSummarizeRequest,
    ReadingSummarizeResponse,
    ReadingAnnotationCreate,
    ReadingAnnotationResponse,
    ReadingChatMessageResponse,
    ReadingChatAppendRequest,
)
from app.services.reading_service import ReadingService
from app.utils.security import get_current_user


def get_reading_service(db: Session = Depends(get_db)) -> ReadingService:
    return ReadingService(db)


router = APIRouter()


@router.post("/{document_id}/ask", response_model=ReadingAskResponse)
async def reading_ask(
    document_id: UUID,
    data: ReadingAskRequest,
    current_user: User = Depends(get_current_user),
    service: ReadingService = Depends(get_reading_service),
):
    """Ask a question about ONE document. Returns an answer, the page-cited
    sources, and an optional figure analysis when a figure-backed hit was
    found among the top results.

    A "summarize" request (or "summarize pages X-Y") is routed to the
    summarization engine and returns `kind="summary"` + the page range."""
    return await service.ask(document_id, current_user, data)


@router.post("/{document_id}/summarize", response_model=ReadingSummarizeResponse)
async def reading_summarize(
    document_id: UUID,
    data: ReadingSummarizeRequest,
    current_user: User = Depends(get_current_user),
    service: ReadingService = Depends(get_reading_service),
):
    """Summarize a page range, read straight from the PDF file. The summary
    is persisted as a `summary` annotation so it shows up in the notes panel."""
    return await service.summarize(document_id, current_user, data)


@router.get("/{document_id}/annotations", response_model=List[ReadingAnnotationResponse])
async def reading_list_annotations(
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ReadingService = Depends(get_reading_service),
):
    """All of the user's notes / highlights / summaries for a document,
    ordered by page then creation time."""
    return service.list_annotations(document_id, current_user)


@router.post(
    "/{document_id}/annotations",
    response_model=ReadingAnnotationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def reading_create_annotation(
    document_id: UUID,
    data: ReadingAnnotationCreate,
    current_user: User = Depends(get_current_user),
    service: ReadingService = Depends(get_reading_service),
):
    """Create a note or highlight pinned to a page of the document."""
    return service.create_annotation(document_id, current_user, data)


@router.delete(
    "/{document_id}/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reading_delete_annotation(
    document_id: UUID,
    annotation_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ReadingService = Depends(get_reading_service),
):
    """Delete one of the user's annotations."""
    service.delete_annotation(document_id, annotation_id, current_user)
    return None


# ---------------------------------------------------------------------------
# Per-document Q&A history (its own table - NOT the Tutor conversations)
# ---------------------------------------------------------------------------

@router.get(
    "/{document_id}/chat-history",
    response_model=List[ReadingChatMessageResponse],
)
async def reading_list_chat_history(
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ReadingService = Depends(get_reading_service),
):
    """The user's past Q&A for this document, oldest first."""
    return service.list_chat_history(document_id, current_user)


@router.post(
    "/{document_id}/chat-history",
    status_code=status.HTTP_201_CREATED,
)
async def reading_append_chat_history(
    document_id: UUID,
    data: ReadingChatAppendRequest,
    current_user: User = Depends(get_current_user),
    service: ReadingService = Depends(get_reading_service),
):
    """Persist one exchange (the user question and/or the AI answer) so the
    reading panel's dialogue survives refreshes and device changes."""
    service.append_chat_history(document_id, current_user, data)
    return None
