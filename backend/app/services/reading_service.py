"""Service for the reading workspace (HDS BƯỚC 6 - Immersive Reading).

Document-scoped Q&A that only cites ONE document, chapter summarization
read straight from the PDF file (with a bounded OCR budget for scanned
pages), persistence of notes / highlights / summaries, and per-document
Q&A history kept in its own table (separate from the Tutor system).
"""
import json
import re
import unicodedata
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional, Set
from uuid import UUID

from app.models import Document, DocumentStatus, User, ReadingAnnotation, ReadingChatMessage
from app.schemas.reading import (
    ReadingAskRequest,
    ReadingSummarizeRequest,
    ReadingAnnotationCreate,
    ReadingChatAppendRequest,
)
from app.ai.rag import RAGPipeline
from app.ai.llm import llm_manager
from app.ai.figures import inspect_top_figure
from app.ai.document_processor import page_texts, render_page_png, pdf_page_count
from app.ai.vision import ocr_page
from app.services.document_service import read_document_bytes
from app.ai.llm import MATH_RULE

# Max pages per summarization request and max OCR calls per request.
MAX_SUMMARY_PAGES = 30
MAX_SUMMARY_OCR = 5
MAX_SUMMARY_CHARS = 12000


def _strip(s: str) -> str:
    """Lower-case and remove all diacritics (NFKD, then drop the
    combining marks). Any Vietnamese spelling - precomposed or
    decomposed - collapses to plain ASCII, so keyword matching no longer
    depends on how the tone marks were encoded (the root cause of a raw
    regex of accented words silently missing)."""
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


# B1 prefilter keyword list - checked (diacritic-free) against the
# _strip()-ed question. A false positive just costs one cheap LLM "chat"
# verdict; a false negative routes a summary request to normal RAG. The
# LLM is the real intent judge; this gate only decides whether to pay.
_SUMMARY_KEYWORDS = (
    "tom tat", "tom luoc", "tong hop", "summar", "y chinh", "liet ke",
    "outline", "so luoc", "viet ve", "noi ve", "chu de",
    "noi dung chinh", "goi y", "luot", "doc luot", "soan",
)


def _summary_prefilter(question: str) -> bool:
    q = _strip(question)
    return any(k in q for k in _SUMMARY_KEYWORDS)


# Explicit page range / single page, used by the regex fallback path.
# These are ASCII-only patterns ("trang" has no diacritics in the forms
# people actually type) and are applied to the RAW question - no normalisation
# involved, so they cannot be defeated by Unicode-form mismatches.
_PAGE_RANGE = re.compile(
    r"trang\s*(\d+)\s*(?:đến|tới|->|-|—)\s*(\d+)", re.IGNORECASE
)
_SINGLE_PAGE = re.compile(r"\btrang\s*(\d+)\b", re.IGNORECASE)

# B1: intent classifier. The reply must be exactly one JSON object.
_CLASSIFY_SYSTEM = """Bạn phân loại câu hỏi của người dùng về một tài liệu.
Chỉ trả về MỘT object JSON duy nhất, không giải thích, không text thừa:
{"intent": "summary" | "chat", "from_page": số | null, "to_page": số | null}

- intent="summary" khi người dùng yêu cầu tóm tắt / nêu ý chính / liệt kê / outline /
  "tài liệu này viết về gì" / đọc lướt ... của CẢ tài liệu hoặc một khoảng trang.
- intent="chat" cho mọi câu hỏi thường khác (giải thích, định nghĩa, trích dẫn, hỏi về 1 chủ đề...).
- Với summary: from_page và to_page là khoảng trang (bắt đầu từ 1).
  "cả tài liệu / cả file" → from_page=1, to_page=TỔNG SỐ TRANG.
  Khoảng cụ thể ("tóm tắt trang 3-12") → ghi đúng khoảng đó. Một trang ("trang 5") → cả hai bằng 5.
- Với chat: from_page=null, to_page=null.
"""


def _parse_json_reply(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """Parse the classifier reply; tolerate code fences / stray text around it."""
    if not raw:
        return None
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else None
    except ValueError:
        return None


class _SummaryError(Exception):
    """Internal error with a user-facing Vietnamese message."""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


MERGE_SYSTEM = """Bạn là AI Gia Sư. Nhiệm vụ: gộp N bản tóm tắt riêng lẻ (mỗi bản phủ
một khoảng trang) thành MỘT bản tóm tắt duy nhất, liền mạch, không lặp ý.

QUY TẮC:
- Mỗi bản tóm tắt phần được gắn nhãn khoảng trang; gộp thành một bản theo thứ
  tự trang, chia theo các phần/chương chính của tài liệu (đặt tiêu đề ngắn
  cho từng phần), mỗi phần 2-5 gạch đầu dòng.
- Giữ lại số liệu / định nghĩa / kết luận quan trọng; bỏ chi tiết lặp lại.
- Trả lời bằng tiếng Việt.
""" + MATH_RULE

READING_ASK_SYSTEM = """Bạn là AI Gia Sư, giúp học sinh đọc SÂU một TÀI LIỆU.

QUY TẮC:
- CHỈ dùng nội dung tài liệu được cung cấp bên dưới (và phân tích hình nếu có).
- Khi trích dẫn, ghi rõ (trang N). Nếu nội dung không đủ để trả lời, nói rõ
  "không đủ thông tin trong tài liệu" kèm gợi ý các trang gần nhất để tìm.
- Trả lời bằng tiếng Việt, đúng kiểu học sinh Việt Nam.
""" + MATH_RULE

SUMMARY_SYSTEM = """Bạn là AI Gia Sư. Nhiệm vụ: tóm tắt một đoạn trang của tài liệu.

QUY TẮC:
- Tóm tắt dạng 4-8 gạch đầu dòng ngắn, giữ lại số liệu / định nghĩa quan trọng.
- Trả lời bằng tiếng Việt.
""" + MATH_RULE


def filter_results_by_pages(
    results: List[Dict[str, Any]],
    pages: Set[str],
    limit: int = 6,
) -> List[Dict[str, Any]]:
    """Prefer chunks whose "[Trang N]" marker is in `pages`; top up with the
    remaining results (original relevance order) up to `limit`.

    `pages` is a set of page numbers as STRINGS - the same shape
    RAGPipeline._page_of returns - so callers can pass
    {str(p) for p in context_pages} directly.
    """
    preferred = [r for r in results if RAGPipeline._page_of(r) in pages]
    rest = [r for r in results if RAGPipeline._page_of(r) not in pages]
    return (preferred + rest)[:limit]


class ReadingService:
    def __init__(self, db: Session):
        self.db = db
        self.rag = RAGPipeline()

    def _get_document(self, document_id: UUID, user_id: UUID) -> Document:
        """Fetch the document and assert ownership (404 otherwise)."""
        document = (
            self.db.query(Document)
            .filter(Document.id == document_id, Document.user_id == user_id)
            .first()
        )
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tài liệu không tồn tại.",
            )
        return document

    # ------------------------------------------------------------------
    # Q&A scoped to one document
    # ------------------------------------------------------------------

    async def ask(self, document_id: UUID, user: User, data: ReadingAskRequest) -> Dict[str, Any]:
        document = self._get_document(document_id, user.id)
        if document.status != DocumentStatus.READY:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tài liệu chưa sẵn sàng để hỏi (đang xử lý).",
            )

        # A "summarize" request typed into the question box is routed to the
        # summarization engine (reads the PDF, not RAG) - the panel has no
        # dedicated summarize button anymore.
        summary_result = await self._run_summarize_from_ask(document_id, user, data, document)
        if summary_result:
            return summary_result

        # Over-retrieve so the context_pages post-filter still has material.
        # score_threshold=0.5 only drops low-relevance padding from the same
        # top-12 - can only return fewer chunks than before, never more, so
        # this adds no extra retrieval cost or latency.
        results = await self.rag.search_documents(
            query=data.question,
            user_id=user.id,
            document_ids=[document_id],
            limit=12,
            score_threshold=0.5,
        )
        if data.context_pages:
            results = filter_results_by_pages(
                results,
                pages={str(p) for p in data.context_pages},
                limit=6,
            )
        if not results:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy nội dung trong tài liệu. Hãy kiểm tra tài liệu đã index (Ready) chưa.",
            )

        context = self.rag.build_context(data.question, results)
        sources = self.rag.extract_sources(results)
        figure_note = await inspect_top_figure(user.id, data.question, results)

        prompt_parts: List[str] = [f"Câu hỏi: {data.question}"]
        if data.context_pages:
            prompt_parts.append(
                f"Người dùng đang xem các trang: {', '.join(str(p) for p in data.context_pages)}"
            )
        prompt_parts.append(context)
        if figure_note:
            prompt_parts.append(
                f"PHÂN TÍCH HÌNH (do mô hình thị giác nhìn ảnh gốc): {figure_note}"
            )
        prompt = "\n\n".join(prompt_parts)

        answer = await llm_manager.generate(
            prompt=prompt,
            system_prompt=READING_ASK_SYSTEM,
            temperature=0.3,
        )
        if not answer or answer.startswith("[Placeholder]"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI không trả lời được. Thử lại.",
            )

        return {"answer": answer, "sources": sources, "figure_note": figure_note}

    # ------------------------------------------------------------------
    # Chapter / page-range summary
    # ------------------------------------------------------------------

    async def summarize(
        self, document_id: UUID, user: User, data: ReadingSummarizeRequest
    ) -> Dict[str, Any]:
        document = self._get_document(document_id, user.id)
        if document.status != DocumentStatus.READY:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tài liệu chưa sẵn sàng.",
            )
        if data.to_page < data.from_page:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Trang kết thúc phải lớn hơn hoặc bằng trang bắt đầu.",
            )
        if document.total_pages and data.to_page > document.total_pages:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tài liệu chỉ có {document.total_pages} trang.",
            )

        summary = await self._summarize_range(document, user, data.from_page, data.to_page)

        # Persist the summary so it shows up in the notes panel.
        self.db.add(
            ReadingAnnotation(
                user_id=user.id,
                document_id=document_id,
                page=data.from_page,
                text=summary,
                type="summary",
            )
        )
        self.db.commit()

        return {"summary": summary, "pages": [data.from_page, data.to_page]}

    async def _summarize_range(
        self, document: Document, user: User, from_page: int, to_page: int
    ) -> str:
        """Summarize a page range, read straight from the PDF file.

        Ranges wider than MAX_SUMMARY_PAGES are split into same-width parts
        (a1), each summarized on its own, then ONE final LLM call merges the
        parts into a single coherent summary (MERGE_SYSTEM) - so "tóm tắt cả
        file" works no matter how long the document is.
        """
        if from_page < 1 or to_page < from_page:
            raise _SummaryError(
                "Khoảng trang không hợp lệ (trang kết thúc phải ≥ trang bắt đầu, từ 1 trở đi)."
            )
        if document.total_pages and to_page > document.total_pages:
            raise _SummaryError(
                f"Tài liệu chỉ có {document.total_pages} trang."
            )

        async def chunk(
            part_from: int, part_to: int, ocr_budget: int = MAX_SUMMARY_OCR
        ) -> "tuple[str, bool]":
            """Read one part's pages into a combined text (bounded OCR)."""
            data = await read_document_bytes(document)
            pages = [
                p for p in page_texts(data) if part_from <= p[0] <= part_to
            ]
            parts: List[str] = []
            ocr_truncated = False
            budget = ocr_budget
            for page_no, text, needs_ocr in pages:
                if text:
                    parts.append(f"[Trang {page_no}]\n{text}")
                elif needs_ocr:
                    if budget > 0:
                        budget -= 1
                        png = render_page_png(data, page_no)
                        ocr = await ocr_page(png) if png else None
                        if ocr:
                            parts.append(f"[Trang {page_no}]\n{ocr}")
                    else:
                        ocr_truncated = True
            combined = "\n\n".join(parts)
            if len(combined) > MAX_SUMMARY_CHARS:
                half = MAX_SUMMARY_CHARS // 2
                combined = combined[:half] + "\n...(bị lược bỏ phần giữa)...\n" + combined[-half:]
            if ocr_truncated:
                combined += "\n(Chú ý: một số trang scan trong khoảng này không đọc được hoàn toàn.)"
            return combined, ocr_truncated

        width = to_page - from_page + 1
        if width <= MAX_SUMMARY_PAGES:
            combined, _ = await chunk(from_page, to_page)
            if not combined.strip():
                raise _SummaryError("Không đọc được nội dung của khoảng trang này.")
            out = await llm_manager.generate(
                prompt=f"Tóm tắt trang {from_page}-{to_page} của tài liệu:\n{combined}",
                system_prompt=SUMMARY_SYSTEM,
                temperature=0.25,
            )
            if not out or out.startswith("[Placeholder]"):
                raise _SummaryError("AI không tóm tắt được. Thử lại.")
            return out

        # (a1) Wide range: split into MAX_SUMMARY_PAGES-sized parts, summarize
        # each, then merge the parts into one final summary.
        parts: List[str] = []
        part_start = from_page
        while part_start <= to_page:
            part_end = min(part_start + MAX_SUMMARY_PAGES - 1, to_page)
            combined, _ = await chunk(part_start, part_end)
            if not combined.strip():
                # Skip an unreadable part; don't abort the whole summary.
                part_start = part_end + 1
                continue
            part_summary = await llm_manager.generate(
                prompt=f"Tóm tắt trang {part_start}-{part_end} của tài liệu:\n{combined}",
                system_prompt=SUMMARY_SYSTEM,
                temperature=0.25,
            )
            if part_summary and not part_summary.startswith("[Placeholder]"):
                parts.append(
                    f"=== Tóm tắt phần trang {part_start}-{part_end} ===\n{part_summary}"
                )
            part_start = part_end + 1
        if not parts:
            raise _SummaryError("Không đọc được nội dung của khoảng trang này.")

        if len(parts) == 1:
            return parts[0].split("=== Tóm tắt phần trang ", 1)[-1].split(" ===", 1)[-1]

        merged = await llm_manager.generate(
            prompt=(
                f"Dưới đây là {len(parts)} bản tóm tắt riêng lẻ theo thứ tự trang, "
                f"của khoảng trang {from_page}-{to_page} trong một tài liệu. "
                f"Hãy gộp chúng thành MỘT bản tóm tắt duy nhất, liền mạch:\n\n"
                + "\n\n".join(parts)
            ),
            system_prompt=MERGE_SYSTEM,
            temperature=0.25,
        )
        if not merged or merged.startswith("[Placeholder]"):
            # Fallback: if the merge step fails, just concatenate the parts.
            merged = "\n\n".join(
                p.split("=== Tóm tắt phần trang ", 1)[-1].split(" ===", 1)[-1] for p in parts
            )
        return merged

    # ------------------------------------------------------------------
    # "Summarize" intent, typed into the plain question box
    # A1: backfill total_pages; B1: one tiny LLM call judges the intent
    # ------------------------------------------------------------------

    async def _ensure_total_pages(self, document: Document) -> int:
        """Return the document's page count, backfilling `documents.total_pages`
        in place (A1). The import pipeline never wrote it, so "tóm tắt cả
        file" had no range to work on. Read the PDF once, cache in the DB.
        """
        if document.total_pages:
            return document.total_pages
        count = None
        if document.file_type == "pdf":
            try:
                count = pdf_page_count(await read_document_bytes(document))
            except Exception:
                count = None
        if count:
            document.total_pages = count
            self.db.commit()
            return count
        return 1

    def _regex_fallback_range(self, question: str, total: int) -> Optional[tuple]:
        """Heuristic path when the classifier reply is missing/unusable:
        an explicit "trang X-Y" (or single "trang N") wins, else the whole
        document. Callers have already passed the summary prefilter."""
        m = _PAGE_RANGE.search(question)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            return (min(a, b), max(a, b))
        single = _SINGLE_PAGE.search(question)
        if single:
            p = int(single.group(1))
            return (p, p)
        return (1, total)

    async def _summarize_range_from_question(
        self, question: str, document: Document, current_page: int
    ) -> Optional[tuple]:
        """Return (from_page, to_page) when the question asks to summarize,
        else None.

        B1: the narrow prefilter decides whether to PAY for one tiny LLM
        classification call (temperature 0, ~20 output tokens); that call is
        the real judge - it understands "nêu ý chính", "giúp mình lướt
        nhanh", "tài liệu này viết về gì" - not just the literal word "tóm
        tắt". If the classifier is unreachable or its reply is unusable, the
        regex fallback keeps the old deterministic behaviour."""
        if not _summary_prefilter(question):
            return None
        total = await self._ensure_total_pages(document)

        prompt = (
            _CLASSIFY_SYSTEM
            + f"\nTỔNG SỐ TRANG của tài liệu: {total}\n"
            + f"Trang người dùng đang xem: {current_page}\n"
            + f"Câu hỏi của người dùng: {question}\n"
        )
        reply = await llm_manager.generate(
            prompt=prompt,
            system_prompt="Trả lời đúng một object JSON duy nhất, không giải thích.",
            temperature=0.0,
            max_tokens=60,
        )
        data = _parse_json_reply(reply)
        if data is not None:
            intent = str(data.get("intent", "")).lower()
            if intent == "summary":
                fp, tp = data.get("from_page"), data.get("to_page")
                a = fp if isinstance(fp, int) and 1 <= fp <= total else 1
                b = tp if isinstance(tp, int) and 1 <= tp <= total else total
                if a > b:
                    a, b = b, a
                return (a, b)
            if intent == "chat":
                return None

        # Classifier missing or reply not usable -> regex fallback.
        return self._regex_fallback_range(question, total)

    async def _run_summarize_from_ask(
        self, document_id: UUID, user: User, data: ReadingAskRequest, document: Document
    ) -> Dict[str, Any]:
        current_page = data.context_pages[0] if data.context_pages else 1
        rng = await self._summarize_range_from_question(data.question, document, current_page)
        if rng is None:
            return {}
        try:
            summary = await self._summarize_range(document, user, rng[0], rng[1])
        except _SummaryError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=e.detail,
            )
        # Persist the summary so it shows up in the notes panel (b: vẫn lưu).
        self.db.add(
            ReadingAnnotation(
                user_id=user.id,
                document_id=document_id,
                page=rng[0],
                text=summary,
                type="summary",
            )
        )
        self.db.commit()
        return {
            "answer": summary,
            "sources": [],
            "figure_note": None,
            "kind": "summary",
            "pages": [rng[0], rng[1]],
        }

    # ------------------------------------------------------------------
    # Per-document Q&A history (D2 - kept OUTSIDE the Tutor system)
    # ------------------------------------------------------------------

    def list_chat_history(self, document_id: UUID, user: User) -> List[ReadingChatMessage]:
        self._get_document(document_id, user.id)
        return (
            self.db.query(ReadingChatMessage)
            .filter(
                ReadingChatMessage.document_id == document_id,
                ReadingChatMessage.user_id == user.id,
            )
            .order_by(ReadingChatMessage.created_at.asc())
            .all()
        )

    def append_chat_history(
        self, document_id: UUID, user: User, data: ReadingChatAppendRequest
    ) -> None:
        """Persist one exchange (user question + optional assistant answer).
        Either side may be omitted, so the panel can log the user message
        first and the answer later without a round-trip lock."""
        self._get_document(document_id, user.id)
        if data.user_message:
            self.db.add(
                ReadingChatMessage(
                    user_id=user.id,
                    document_id=document_id,
                    role="user",
                    content=data.user_message,
                )
            )
        if data.assistant_message:
            self.db.add(
                ReadingChatMessage(
                    user_id=user.id,
                    document_id=document_id,
                    role="assistant",
                    content=data.assistant_message,
                    sources=data.sources,
                    figure_note=data.figure_note,
                    kind=data.kind,
                    label=data.label,
                )
            )
        self.db.commit()

    # ------------------------------------------------------------------
    # Annotations (notes / highlights / summaries)
    # ------------------------------------------------------------------

    def create_annotation(
        self, document_id: UUID, user: User, data: ReadingAnnotationCreate
    ) -> ReadingAnnotation:
        document = self._get_document(document_id, user.id)
        if document.status != DocumentStatus.READY:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tài liệu chưa sẵn sàng.",
            )
        if data.type not in ("note", "highlight", "summary"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Loại ghi chú không hợp lệ (note, highlight, summary).",
            )
        annotation = ReadingAnnotation(
            user_id=user.id,
            document_id=document_id,
            page=data.page,
            text=data.text.strip(),
            type=data.type,
        )
        self.db.add(annotation)
        self.db.commit()
        self.db.refresh(annotation)
        return annotation

    def list_annotations(self, document_id: UUID, user: User) -> List[ReadingAnnotation]:
        self._get_document(document_id, user.id)
        return (
            self.db.query(ReadingAnnotation)
            .filter(
                ReadingAnnotation.document_id == document_id,
                ReadingAnnotation.user_id == user.id,
            )
            .order_by(
                ReadingAnnotation.page.asc().nullsfirst(),
                ReadingAnnotation.created_at.asc(),
            )
            .all()
        )

    def delete_annotation(
        self, document_id: UUID, annotation_id: UUID, user: User
    ) -> None:
        self._get_document(document_id, user.id)
        annotation = (
            self.db.query(ReadingAnnotation)
            .filter(
                ReadingAnnotation.id == annotation_id,
                ReadingAnnotation.document_id == document_id,
                ReadingAnnotation.user_id == user.id,
            )
            .first()
        )
        if not annotation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ghi chú không tồn tại.",
            )
        self.db.delete(annotation)
        self.db.commit()
