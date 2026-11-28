"""Extract plain text from stored documents and split it into chunks.

PDFs are read with PyMuPDF (keeps page structure better than pypdf for
formulas); each page's text is tagged `[Trang N]` so answers can cite which
page they came from. Scan-only pages (no text layer) are flagged for OCR in
the service layer. Embedded images large enough to be figures are detected
here too - the service captions them with the vision model.
"""
import re
from typing import Any, Dict, List, Optional, Tuple

try:
    # PyMuPDF >= 2.0 renamed the package; `fitz` is now a legacy alias and
    # emits a FutureWarning on import. Prefer the new name, fall back to the
    # alias for older installs. Both expose the same API.
    import pymupdf as fitz  # PyMuPDF - page-accurate text, figures, page render
    _HAS_PYMUPDF = True
except ImportError:  # pragma: no cover - falls back to pypdf below
    try:
        import fitz  # type: ignore[no-redef]
        _HAS_PYMUPDF = True
    except ImportError:
        fitz = None
        _HAS_PYMUPDF = False

from pypdf import PdfReader

CHUNK_SIZE = 500     # characters per chunk
CHUNK_OVERLAP = 100  # overlap so sentences don't get split across chunks

# A page whose text layer yields fewer characters than this is treated as
# scan-only and routed through OCR.
MIN_TEXT_LENGTH = 200
# Minimum pixel area for an embedded image to count as a figure/chart
# (icons, bullets and tiny logos fall below this).
MIN_FIGURE_AREA = 150 * 150
OCR_DPI = 150


def extract_text(file_path: str) -> str:
    """Extract readable text from a stored PDF (text layers only - uploads are
    PDF-only, see document_service.ALLOWED_EXTENSIONS).

    Returns an empty string when there is no reliable text layer (scanned
    PDFs) - the service layer detects those pages and runs OCR.
    """
    return _extract_pdf(file_path)


def page_texts(file_path: str) -> List[Tuple[int, str, bool]]:
    """Per-page text for a PDF: (page_no, text, needs_ocr).

    needs_ocr is True when the text layer is empty/too thin - the service
    renders the page and transcribes it with the vision model instead.
    Without PyMuPDF this degrades to pypdf with OCR flagged on empty pages.
    """
    pages: List[Tuple[int, str, bool]] = []
    if _HAS_PYMUPDF:
        try:
            doc = fitz.open(file_path)
        except Exception:
            return pages
        try:
            for i, page in enumerate(doc, 1):
                text = (page.get_text("text") or "").strip()
                pages.append((i, text, len(text) < MIN_TEXT_LENGTH))
        finally:
            doc.close()
        return pages
    # pypdf fallback: OCR flags only when a page has no text at all.
    try:
        reader = PdfReader(file_path)
    except Exception:
        return pages
    for i, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        pages.append((i, text, len(text) < MIN_TEXT_LENGTH))
    return pages


def pdf_page_count(file_path: str) -> Optional[int]:
    """Number of pages in a PDF (PyMuPDF preferred, pypdf fallback).

    Used to backfill documents.total_pages on demand - the import pipeline
    never wrote it, so "summarize the whole file" had no range to work on.
    """
    if _HAS_PYMUPDF:
        try:
            doc = fitz.open(file_path)
            try:
                return doc.page_count
            finally:
                doc.close()
        except Exception:
            pass
    try:
        return len(PdfReader(file_path).pages)
    except Exception:
        return None


def render_page_png(file_path: str, page_no: int, dpi: int = OCR_DPI) -> Optional[bytes]:
    """Render one PDF page to a PNG (for OCR and for the model to see it)."""
    if not _HAS_PYMUPDF:
        return None
    try:
        doc = fitz.open(file_path)
        try:
            pix = doc[page_no - 1].get_pixmap(dpi=dpi)
            return pix.tobytes("png")
        finally:
            doc.close()
    except Exception:
        return None


def figure_info(file_path: str) -> List[Dict[str, Any]]:
    """Find embedded images large enough to be figures or charts in a PDF.

    Returns [{"page": n, "xref": int, "bbox": [x0,y0,x1,y1]}] - one entry per
    candidate figure, in document order.
    """
    if not _HAS_PYMUPDF:
        return []
    out: List[Dict[str, Any]] = []
    try:
        doc = fitz.open(file_path)
    except Exception:
        return out
    try:
        for i, page in enumerate(doc, 1):
            for info in page.get_image_info():
                width = info.get("width") or 0
                height = info.get("height") or 0
                if not (width and height and width * height >= MIN_FIGURE_AREA):
                    continue
                out.append({
                    "page": i,
                    "xref": info.get("xref") or 0,
                    "bbox": info.get("bbox") or [0, 0, 0, 0],
                })
    finally:
        doc.close()
    return out


def figure_bytes(file_path: str, info: Dict[str, Any]) -> Tuple[Optional[bytes], str]:
    """Return (image_bytes, mime_type) for a detected figure.

    Prefers the embedded image data; falls back to rendering its page
    region. Returns (None, "image/png") when neither works (e.g. without
    PyMuPDF the whole figure feature is skipped).
    """
    if not _HAS_PYMUPDF:
        return None, "image/png"
    try:
        doc = fitz.open(file_path)
    except Exception:
        return None, "image/png"
    try:
        if info.get("xref"):
            img = doc.extract_image(info["xref"])
            if img and img.get("image"):
                ext = img.get("ext", "png").lower()
                mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
                return img["image"], mime
        x0, y0, x1, y1 = (float(v) for v in (info.get("bbox") or [0, 0, 0, 0]))
        if x1 <= x0 or y1 <= y0:
            return None, "image/png"
        pix = doc[info["page"] - 1].get_pixmap(clip=fitz.Rect(x0, y0, x1, y1), dpi=110)
        return pix.tobytes("png"), "image/png"
    except Exception:
        return None, "image/png"
    finally:
        doc.close()


def _extract_pdf(file_path: str) -> str:
    parts: List[str] = []
    if _HAS_PYMUPDF:
        try:
            doc = fitz.open(file_path)
        except Exception:
            doc = None
        if doc is not None:
            try:
                for i, page in enumerate(doc, 1):
                    text = (page.get_text("text") or "").strip()
                    if text:
                        parts.append(f"[Trang {i}]\n{text}")
            finally:
                doc.close()
            return "\n\n".join(parts)
    try:
        reader = PdfReader(file_path)
    except Exception:
        return ""
    for i, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        if text:
            parts.append(f"[Trang {i}]\n{text}")
    return "\n\n".join(parts)


_PAGE_MARKER = re.compile(r"\[Trang \d+\]")


def chunk_text(text: str) -> List[str]:
    """Split text into overlapping chunks suitable for embedding.

    Chunks are cut by character count, so most start mid-page with no
    "[Trang N]" marker of their own; each such chunk is prefixed with the
    marker of the page it starts on, so every chunk can be cited by page
    (see RAGPipeline._page_of, which reads the last marker in a chunk).
    """
    text = text.strip()
    if not text:
        return []
    markers = [(m.start(), m.group()) for m in _PAGE_MARKER.finditer(text)]
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end]
        current = next((label for pos, label in reversed(markers) if pos <= start), None)
        if current and not chunk.lstrip().startswith("[Trang "):
            chunk = f"{current}\n{chunk}"
        if chunk.strip():
            chunks.append(chunk)
        if end >= len(text):
            break
        start = end - CHUNK_OVERLAP
    return chunks
