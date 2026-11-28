from dataclasses import dataclass
from pathlib import PurePosixPath

import fitz
from fastapi import HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.schemas.exam import FileRole

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_UPLOAD_BYTES = 24 * 1024 * 1024
MAX_PAGES = 12
MAX_FILES_PER_ROLE = 6


@dataclass(frozen=True)
class ExamUpload:
    role: FileRole
    name: str
    media_type: str
    content: bytes


@dataclass(frozen=True)
class ExamPage:
    role: FileRole
    name: str
    number: int
    image: bytes
    native_text: str = ""


def file_format(content: bytes) -> tuple[str, str]:
    if content.startswith(b"%PDF-"):
        return "pdf", "application/pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "jpeg", "image/jpeg"
    raise HTTPException(422, "Chỉ hỗ trợ tệp PDF, PNG hoặc JPEG hợp lệ.")


async def collect_uploads(groups: dict[FileRole, list[UploadFile]]) -> tuple[list[ExamUpload], list[ExamPage]]:
    uploads = []
    size = 0
    if any(len(files) > MAX_FILES_PER_ROLE for files in groups.values()):
        raise HTTPException(422, f"Mỗi mục nhận tối đa {MAX_FILES_PER_ROLE} tệp.")
    for role, files in groups.items():
        for file in files:
            data = await file.read(MAX_FILE_BYTES + 1)
            size += len(data)
            if len(data) > MAX_FILE_BYTES or size > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Tối đa 8 MB mỗi tệp và 24 MB cho một bài nộp.")
            name = PurePosixPath((file.filename or "tai-lieu").replace("\\", "/")).name
            name = "".join(char for char in name if char.isprintable())[:255] or "tai-lieu"
            uploads.append(ExamUpload(role, name, file_format(data)[1], data))
    pages = await run_in_threadpool(render_uploads, uploads)
    return uploads, pages


def render_uploads(uploads: list[ExamUpload]) -> list[ExamPage]:
    pages = []
    for upload in uploads:
        try:
            kind, _ = file_format(upload.content)
            with fitz.open(stream=upload.content, filetype=kind) as document:
                if document.needs_pass or not document.page_count:
                    raise ValueError("No readable pages")
                if len(pages) + document.page_count > MAX_PAGES:
                    raise HTTPException(422, f"Tổng số trang và ảnh tối đa là {MAX_PAGES}.")
                for page in document:
                    native_text = ""
                    if kind == "pdf" and upload.role != "answer":
                        text = page.get_text("text", sort=True).strip()
                        if 32 <= len(text) <= 18000 and "\ufffd" not in text and not page.get_image_info() and not page.get_drawings():
                            native_text = text
                    side = max(page.rect.width, page.rect.height)
                    if side <= 0 or side > 12000:
                        raise ValueError("Unsupported page size")
                    scale = min(2.8, 2000 / side)
                    pixels = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB)
                    if min(pixels.width, pixels.height) < 16:
                        raise ValueError("Invalid page dimensions")
                    pages.append(ExamPage(
                        upload.role, upload.name, page.number + 1, pixels.tobytes("jpeg", jpg_quality=92), native_text,
                    ))
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(422, f"Không đọc được tệp {upload.name}. Hãy thử tệp khác.") from exc
    return pages
