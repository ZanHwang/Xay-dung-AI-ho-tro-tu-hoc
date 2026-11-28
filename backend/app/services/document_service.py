import os
import uuid
from typing import Any, Dict, List, Optional, BinaryIO
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Document, Subject, DocumentStatus
from app.schemas.document import DocumentUpload, DocumentUpdate
from app.config import settings
from fastapi import HTTPException, status, UploadFile
import shutil
from app.ai.document_processor import (
    extract_text,
    chunk_text,
    figure_info,
    figure_bytes,
    page_texts,
    render_page_png,
)
from app.ai.qdrant_store import qdrant_store
from app.ai.vision import caption_figure, ocr_page, inspect_figure

# Supported file types
# PDF only: page numbers, OCR, figures and page images (Lộ trình "Học") all
# come from the PDF pipeline - users convert Word/PowerPoint to PDF first.
ALLOWED_EXTENSIONS = {".pdf"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Document ids with a `process_document` task currently running IN THIS
# PROCESS. Module-level (not per-request/per-instance) on purpose: it must
# survive across the many short-lived DocumentService/session instances
# created per request, and answer "is this document actually still being
# worked on" from the only place that can truly know - the live task itself
# (see process_document's try/finally below). Correctly empty right after a
# fresh process start (nothing could have been scheduled yet), which is
# exactly what makes DocumentService.recover_stuck_documents' "nothing in
# this process could possibly still own it" reasoning valid. Used to refuse
# "Xử lý lại" (reprocess_document) on a document that just happens to be
# slow, not actually stuck - without this, that click would silently start a
# second pipeline run racing the real one (duplicate AI calls, a confusing
# interleaving of status writes, and the Qdrant delete-then-reembed added
# for crash recovery could even delete the still-running run's own output).
_processing_document_ids: set[UUID] = set()


def resolve_document_path(document: Document) -> str:
    """Absolute path of the stored file for a document.

    `document.file_path` is stored relative to the storage bucket (e.g.
    `documents/<user_id>/<uuid>_<filename>.pdf`). The bucket itself can be a
    relative path (default "documents"), and file_path may already start with
    that prefix - in that case we must NOT prepend it again.
    """
    raw_path = document.file_path
    bucket = settings.object_storage_bucket
    if os.path.isabs(raw_path):
        return raw_path
    if bucket and (
        raw_path == bucket
        or raw_path.startswith(bucket + os.sep)
        or raw_path.startswith(bucket + "/")
    ):
        return raw_path
    if os.path.isabs(bucket):
        return os.path.join(bucket, raw_path)
    return os.path.join(os.getcwd(), bucket, raw_path) if bucket else os.path.join(os.getcwd(), raw_path)


class DocumentService:
    def __init__(self, db: Session):
        self.db = db

    def _get_storage_path(self, user_id: UUID, filename: str) -> str:
        """Generate storage path for a file."""
        user_dir = os.path.join(settings.object_storage_bucket, str(user_id))
        os.makedirs(user_dir, exist_ok=True)
        return os.path.join(user_dir, f"{uuid.uuid4()}_{filename}")

    def _validate_file(self, file: UploadFile) -> str:
        """Validate uploaded file."""
        # Check file extension
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Chỉ hỗ trợ file PDF. Hãy chuyển file Word/PowerPoint sang PDF trước khi tải lên."
            )
        return ext

    def get_documents_by_user(
        self, user_id: UUID, subject_id: Optional[UUID] = None,
        status_filter: Optional[DocumentStatus] = None,
        limit: int = 50, offset: int = 0
    ) -> tuple[List[Document], int]:
        """Get all documents for a user."""
        query = self.db.query(Document).filter(Document.user_id == user_id)

        if subject_id:
            query = query.filter(Document.subject_id == subject_id)
        if status_filter:
            query = query.filter(Document.status == status_filter)

        total = query.count()
        documents = query.order_by(Document.created_at.desc()).offset(offset).limit(limit).all()
        return documents, total

    def get_document_by_id(self, document_id: UUID, user_id: UUID) -> Optional[Document]:
        """Get a document by ID, ensuring user ownership."""
        return (
            self.db.query(Document)
            .filter(Document.id == document_id, Document.user_id == user_id)
            .first()
        )

    async def upload_document(
        self, user_id: UUID, file: UploadFile, subject_id: Optional[UUID] = None
    ) -> Document:
        """Upload a new document."""
        # Validate file
        ext = self._validate_file(file)

        # Read file content
        content = await file.read()
        file_size = len(content)

        # Check file size
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB"
            )
        existing = (
            self.db.query(Document)
            .filter(
                Document.user_id == user_id,
                Document.subject_id == subject_id,
                Document.filename == file.filename,
                Document.file_size == file_size,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"File \"{file.filename}\" đã tồn tại trong môn học này."
            )
        # Verify subject ownership if provided
        if subject_id:
            subject = (
                self.db.query(Subject)
                .filter(Subject.id == subject_id, Subject.user_id == user_id)
                .first()
            )
            if not subject:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Subject not found"
                )

        # Generate storage path
        storage_path = self._get_storage_path(user_id, file.filename)

        # Save file (in production, save to object storage)
        # For now, save to local storage
        os.makedirs(os.path.dirname(storage_path), exist_ok=True)
        with open(storage_path, "wb") as f:
            f.write(content)

        # Create document record
        document = Document(
            user_id=user_id,
            subject_id=subject_id,
            filename=file.filename,
            file_path=storage_path,
            file_type=ext[1:],  # Remove dot
            file_size=file_size,
            status=DocumentStatus.UPLOADED
        )
        self.db.add(document)
        self.db.commit()
        self.db.refresh(document)

        # The RAG pipeline (extract -> chunk -> embed -> Qdrant) runs in the
        # background so the upload response returns quickly. The document stays
        # in "uploaded" state while that happens; poll /documents/{id}/status.
        # See `process_document` below.

        return document

    async def process_document(self, document_id: UUID, user_id: UUID) -> None:
        """Run the RAG pipeline for a document, on a background task.

        Intended to be scheduled with `asyncio.create_task` so the upload /
        reprocess endpoints return immediately. Every DB touchpoint goes
        through `_set_status`, which opens and closes its own short-lived
        session - no session is held open across the slow steps in between
        (OCR / figure captioning / embedding, all external AI calls that can
        run long). Holding one session open for the whole pipeline used to
        let Neon close the idle connection mid-wait, surfacing as
        "server closed the connection unexpectedly" on the next commit;
        `pool_pre_ping` can't catch that because it only revalidates a
        connection when checked out fresh from the pool, which a session
        held open the entire time never does.
        Pipeline errors are recorded on the document (status=failed) and never
        re-raised - a failed background task should not crash the worker.

        For PDFs the pipeline is:
          1. text layer per page (PyMuPDF),
          2. OCR scan-only pages with the vision model,
          3. detect embedded figures, save them and caption them,
          4. chunk + embed text chunks and figure-caption chunks into Qdrant.
        """
        if document_id in _processing_document_ids:
            # Another task for this exact document is already live in this
            # process (should not normally happen - reprocess_document
            # refuses to even schedule this while that's true - but this is
            # the one place that can actually know for sure, so it's kept as
            # a hard backstop regardless of caller).
            return

        info = self._set_status(document_id, user_id, DocumentStatus.EXTRACTING)
        if info is None:
            return

        _processing_document_ids.add(document_id)
        try:
            chunks: List[str] = []
            figures: List[Optional[str]] = []  # parallel to chunks

            chunks, figures = await self._process_pdf(document_id, user_id, info["file_path"])

            if not chunks:
                text = extract_text(info["file_path"])
                chunks = chunk_text(text)
                figures = [None] * len(chunks)

            if not chunks:
                self._set_status(
                    document_id, user_id, DocumentStatus.READY,
                    error_message="Không trích xuất được nội dung (tài liệu có thể chỉ là ảnh).",
                )
                return

            self._set_status(document_id, user_id, DocumentStatus.EMBEDDING)
            # This pipeline always re-runs in full on every call, regardless
            # of WHY (first run, manual "Xử lý lại", or auto-recovery after a
            # crash) - and store_chunks() always inserts with fresh random
            # point ids rather than overwriting existing ones. A previous
            # attempt that reached this point (even if it never got to set
            # READY, e.g. the process died right after) would otherwise leave
            # its old chunks in Qdrant forever, duplicated alongside the new
            # ones. Clearing first makes re-embedding idempotent; a document
            # with nothing stored yet is a harmless no-op delete.
            await qdrant_store.delete_document(document_id, info["user_id"])
            await qdrant_store.store_chunks(
                document_id=document_id,
                user_id=info["user_id"],
                document_name=info["filename"],
                chunks=chunks,
                figures=figures,
            )
            self._set_status(document_id, user_id, DocumentStatus.READY, clear_error=True)

            # Best-effort: detect THIS document's own topics (used by the
            # "Tạo Quiz" chips and Lộ trình, both grouped/gated per document
            # now - see QuizService.ensure_document_topics). Never lets a
            # failure here mark the document as failed.
            if info["subject_id"]:
                try:
                    from app.database import SessionLocal
                    from app.services.quiz_service import QuizService
                    with SessionLocal() as s:
                        doc = s.query(Document).filter(Document.id == document_id).first()
                        if doc:
                            await QuizService(s).ensure_document_topics(info["user_id"], doc)
                except Exception:
                    pass
        except Exception as exc:
            try:
                self._set_status(
                    document_id, user_id, DocumentStatus.FAILED,
                    error_message=f"Không xử lý được tài liệu ({type(exc).__name__}): {exc}",
                )
            except Exception:
                pass
        finally:
            _processing_document_ids.discard(document_id)

    def _set_status(
        self, document_id: UUID, user_id: UUID, status_value: DocumentStatus,
        *, error_message: Optional[str] = None, clear_error: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Update a document's status through its own short-lived session,
        and return the plain columns the pipeline needs next (never an ORM
        instance tied to the session that's about to close). Keeping each DB
        touchpoint this short is what lets `pool_pre_ping` actually do its
        job - every call here checks out a fresh connection from the pool,
        instead of reusing one held open across the slow AI calls between
        touchpoints.
        """
        from app.database import SessionLocal
        with SessionLocal() as s:
            doc = (
                s.query(Document)
                .filter(Document.id == document_id, Document.user_id == user_id)
                .first()
            )
            if not doc:
                return None
            doc.status = status_value
            if clear_error:
                doc.error_message = None
            elif error_message is not None:
                doc.error_message = error_message
            s.commit()
            return {
                "file_path": doc.file_path,
                "file_type": doc.file_type,
                "filename": doc.filename,
                "user_id": doc.user_id,
                "subject_id": doc.subject_id,
            }

    # ------------------------------------------------------------------
    # PDF pipeline: OCR of scan-only pages + caption of embedded figures
    # ------------------------------------------------------------------

    async def _process_pdf(self, document_id: UUID, user_id: UUID, file_path: str) -> tuple[List[str], List[Optional[str]]]:
        """Return (chunks, figure_paths) for one PDF.

        Text pages become ordinary chunks; OCR'd pages become chunks marked
        with their page; each embedded figure becomes a "Mô tả hình" chunk
        that carries the path of the stored image so the UI can display it
        and the vision model can inspect it at query time.
        """
        pages = page_texts(file_path)

        text_parts: List[str] = []
        in_ocr = False
        for page_no, text, needs_ocr in pages:
            if text:
                text_parts.append(f"[Trang {page_no}]\n{text}")
            elif needs_ocr:
                png = render_page_png(file_path, page_no)
                if png:
                    if not in_ocr:
                        self._set_status(document_id, user_id, DocumentStatus.OCR_PROCESSING)
                        in_ocr = True
                    ocr = await ocr_page(png)
                    if ocr:
                        text_parts.append(f"[Trang {page_no}]\n{ocr}")
        text = "\n\n".join(text_parts)
        chunks = chunk_text(text)
        figures: List[Optional[str]] = [None] * len(chunks)

        # Figures: caption at index time, keep the image for query-time
        # inspection. The caption chunk is what makes a figure findable.
        figures_dir = self._figures_dir(user_id, document_id)
        for index, info in enumerate(figure_info(file_path)):
            image, mime = figure_bytes(file_path, info)
            if not image:
                continue
            ext = "jpg" if mime == "image/jpeg" else "png"
            relative_path = os.path.join(figures_dir, f"{index:03d}.{ext}")
            os.makedirs(figures_dir, exist_ok=True)
            with open(os.path.join(os.getcwd(), relative_path), "wb") as f:
                f.write(image)

            caption = await caption_figure(image, mime)
            if not caption:
                caption = f"Hình trên trang {info['page']} (không mô tả được)."
            chunks.append(
                f"[Trang {info['page']}]\n[Mô tả hình {index + 1}]\n{caption}"
            )
            # Store only the filename: the figures endpoint resolves it inside
            # the document's fixed figure directory, and the UI builds the
            # citation URL from document_id + this name.
            figures.append(os.path.basename(relative_path))

        return chunks, figures

    def _figures_dir(self, user_id: UUID, document_id: UUID) -> str:
        """Storage dir for a document's extracted figures (relative to CWD)."""
        return os.path.join(
            settings.object_storage_bucket, str(user_id), "figures", str(document_id)
        )

    def update_document(
        self, document_id: UUID, user_id: UUID, data: DocumentUpdate
    ) -> Document:
        """Update document (e.g., change subject)."""
        document = self.get_document_by_id(document_id, user_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found"
            )

        # Verify subject ownership if changing
        if data.subject_id:
            subject = (
                self.db.query(Subject)
                .filter(Subject.id == data.subject_id, Subject.user_id == user_id)
                .first()
            )
            if not subject:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Subject not found"
                )
            document.subject_id = data.subject_id

        self.db.commit()
        self.db.refresh(document)
        return document

    async def delete_document_async(self, document_id: UUID, user_id: UUID) -> bool:
        """Delete a document, its file, and its stored vectors in Qdrant."""
        document = self.get_document_by_id(document_id, user_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found"
            )

        await self.purge_storage(document)
        self.db.delete(document)
        self.db.commit()
        return True

    async def purge_storage(self, document: Document) -> None:
        """Remove everything a document owns outside the DB row: its Qdrant
        vectors, the uploaded file and its extracted figures directory."""
        # Vectors first so the chat can never cite a deleted document.
        try:
            await qdrant_store.delete_document(document.id, document.user_id)
        except Exception:
            # Qdrant is unavailable: still remove the file/figures, leaving the
            # orphaned vectors (they are owned per user and harmless).
            pass
        path = resolve_document_path(document)
        if os.path.exists(path):
            os.remove(path)
        shutil.rmtree(self._figures_dir(document.user_id, document.id), ignore_errors=True)

    def get_document_status(self, document_id: UUID, user_id: UUID) -> dict:
        """Get processing status of a document."""
        document = self.get_document_by_id(document_id, user_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found"
            )

        return {
            "id": document.id,
            "status": document.status,
            "error_message": document.error_message
        }

    def reprocess_document(self, document_id: UUID, user_id: UUID) -> Document:
        """Re-process a document (reset status and schedule the pipeline).

        Refuses while a `process_document` task for this exact document is
        still genuinely running in this process - a document can show as
        "stuck" in the UI just because it is legitimately slow (e.g. a big
        scanned PDF needing OCR), not actually orphaned; without this check,
        clicking "Xử lý lại" on one of those would start a second pipeline
        run racing the real one instead of safely declining.
        """
        document = self.get_document_by_id(document_id, user_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found"
            )
        if document_id in _processing_document_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tài liệu này vẫn đang được xử lý — chưa thật sự kẹt, vui lòng đợi thêm.",
            )

        document.status = DocumentStatus.UPLOADED
        document.error_message = None
        self.db.commit()
        self.db.refresh(document)

        # The caller (router) schedules `process_document` as a background task.

        return document


async def recover_stuck_documents() -> int:
    """Startup recovery for documents orphaned by a server restart.

    `process_document` (above) runs as a bare `asyncio.create_task` with no
    persistence across process restarts (see its docstring) - if the process
    dies or reloads mid-pipeline, the task is gone with no trace: the
    document is left in a non-terminal status (uploaded/extracting/
    ocr_processing/chunking/embedding) forever, with no error ever recorded,
    since the exception handler that would set it to FAILED never runs
    either.

    Called once from a FastAPI startup event (see main.py). At that point
    nothing in THIS (freshly-started) process could possibly still be
    working on any document - whatever process was is gone - so every
    document not already READY/FAILED is safe to reset and re-queue from
    scratch, with zero user action (no more manually clicking "Xử lý lại").
    Returns how many documents were re-queued.
    """
    import asyncio
    from app.database import SessionLocal

    with SessionLocal() as db:
        stuck_ids = [
            (row.id, row.user_id)
            for row in db.query(Document.id, Document.user_id)
            .filter(Document.status.notin_([DocumentStatus.READY, DocumentStatus.FAILED]))
            .all()
        ]
        for document_id, _ in stuck_ids:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.status = DocumentStatus.UPLOADED
                doc.error_message = None
        db.commit()

    for document_id, user_id in stuck_ids:
        asyncio.create_task(DocumentService(SessionLocal()).process_document(document_id, user_id))

    return len(stuck_ids)
