from fastapi import APIRouter, Depends, Form, HTTPException, status, Query, UploadFile, File
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
import asyncio
import os
from app.database import get_db
from app.schemas.document import (
    DocumentResponse, DocumentListResponse, DocumentStatusResponse, DocumentProcessRequest
)
from app.services.document_service import DocumentService, resolve_document_path
from app.ai.document_processor import render_page_png
from app.services.quiz_service import backfill_document_topics_in_background
from app.models.document import DocumentStatus
from app.config import settings
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


def get_document_service(db: Session = Depends(get_db)) -> DocumentService:
    return DocumentService(db)


@router.get("/", response_model=DocumentListResponse)
async def get_documents(
    subject_id: Optional[UUID] = Query(None, description="Filter by subject"),
    status_filter: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service),
):
    """
    Get all documents for the current user.
    """
    status_enum = None
    if status_filter:
        try:
            status_enum = DocumentStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Valid values: {[s.value for s in DocumentStatus]}"
            )

    documents, total = service.get_documents_by_user(
        current_user.id, subject_id, status_enum, limit, offset
    )
    # Backfill topics for documents that predate Document.topics_json - in
    # the BACKGROUND, not awaited here. This endpoint is on the hot path for
    # nearly every page (Tài liệu tab, "Tạo Quiz"'s document list, Lộ trình),
    # so blocking it on a RAG+LLM round trip per untopicked document (and
    # holding this request's DB connection the whole time) made everything
    # feel slow, not just the documents list. A document missing topics just
    # shows none THIS load; they appear on the next one once the background
    # task finishes (a few seconds later).
    for doc in documents:
        if doc.status == DocumentStatus.READY and not doc.topics_json:
            asyncio.create_task(backfill_document_topics_in_background(doc.id, current_user.id))
    return DocumentListResponse(total=total, documents=documents)


@router.post("/", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(..., description="File to upload (PDF, DOCX, PPTX)"),
    # Accept subject_id as a multipart form field. The previous signature used
    # `Query(...)` which silently dropped the value when the client sent it as
    # a form field, leaving the document unattached to any subject.
    subject_id: Optional[UUID] = Form(None, description="Subject to attach document to"),
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service)
):
    """
    Upload a new document.
    Supported formats: PDF, DOCX, PPTX
    Maximum size: 50MB
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided"
        )

    document = await service.upload_document(current_user.id, file, subject_id)

    # Kick off the RAG pipeline (extract -> chunk -> embed -> Qdrant) in the
    # background so this response returns immediately. The task creates its
    # own DB session, so it is safe to let it outlive this request.
    asyncio.create_task(service.process_document(document.id, current_user.id))

    return document


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service)
):
    """
    Get a specific document.
    """
    document = service.get_document_by_id(document_id, current_user.id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    return document


@router.get("/{document_id}/download")
async def download_document(
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service)
):
    """
    Download the original file for a document.
    Returns a binary stream with the stored filename as Content-Disposition.
    """
    document = service.get_document_by_id(document_id, current_user.id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    file_path = resolve_document_path(document)
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="File is no longer available on the server."
        )
    return FileResponse(
        path=file_path,
        media_type=document.file_type or "application/octet-stream",
        filename=document.filename,
    )


@router.get("/{document_id}/figures/{filename}")
async def get_document_figure(
    document_id: UUID,
    filename: str,
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service),
):
    """Serve an extracted figure image for a document.

    Figure files are stored under
    `<bucket>/<user_id>/figures/<document_id>/<n>.{png,jpg}` by the index
    pipeline. Only the bare filename is accepted and it is resolved inside
    that fixed directory, so path traversal is not possible.
    """
    document = service.get_document_by_id(document_id, current_user.id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    base_dir = os.path.join(
        os.getcwd(),
        settings.object_storage_bucket,
        str(current_user.id),
        "figures",
        str(document_id),
    )
    file_path = os.path.join(base_dir, os.path.basename(filename))
    # Guard against anything that escapes the figures directory.
    if os.path.abspath(file_path).startswith(os.path.abspath(base_dir)) and os.path.isfile(file_path):
        media_type = "image/jpeg" if file_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
        return FileResponse(path=file_path, media_type=media_type, filename=filename)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Figure not found")


@router.get("/{document_id}/pages/{page_no}/image")
async def get_document_page_image(
    document_id: UUID,
    page_no: int,
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service),
):
    """Rasterize one page of the document's original PDF as a PNG - lets the
    frontend show the actual slide/page alongside a RAG excerpt's text (see
    Lộ trình "Học" screen), not just the extracted text. Rendered on demand,
    no cache - this isn't a hot path (only "Học" calls it) and PyMuPDF
    rendering one page is fast enough.
    """
    document = service.get_document_by_id(document_id, current_user.id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    # page_no is 1-based; 0/negative would index from the end (doc[-1]).
    png = render_page_png(resolve_document_path(document), page_no) if page_no >= 1 else None
    if not png:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    return Response(content=png, media_type="image/png")


@router.get("/{document_id}/status", response_model=DocumentStatusResponse)
async def get_document_status(
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service)
):
    """
    Get processing status of a document.
    Useful for polling after upload.
    """
    status_info = service.get_document_status(document_id, current_user.id)
    return DocumentStatusResponse(**status_info)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service)
):
    """
    Delete a document and its file.
    """
    await service.delete_document_async(document_id, current_user.id)
    return None


@router.post("/{document_id}/reprocess", response_model=DocumentResponse)
async def reprocess_document(
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: DocumentService = Depends(get_document_service)
):
    """
    Re-process a document.
    Resets status and re-queues processing.
    """
    document = service.reprocess_document(document_id, current_user.id)
    asyncio.create_task(service.process_document(document.id, current_user.id))
    return document
