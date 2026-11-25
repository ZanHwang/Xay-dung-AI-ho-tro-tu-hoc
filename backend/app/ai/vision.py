"""GPT-4o vision utilities: scanned-page OCR, figure captions, query-time
figure inspection.

Every function returns None when the OpenAI key is missing or the call fails -
the pipeline then degrades gracefully to text-only RAG instead of crashing.
Calls hit OpenAI directly (the Groq mirror has no vision endpoint), so these
work regardless of the configured LLM_PROVIDER.
"""
import base64
import unicodedata
from typing import Optional

import httpx

from app.config import settings

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

OCR_PROMPT = (
    "Đây là ảnh một trang tài liệu được scan. Hãy transcribe CHÍNH XÁC toàn bộ "
    "văn bản, giữ nguyên bố cục, đánh số và bảng. Công thức toán viết dạng LaTeX "
    "trong $...$. Trả về CHỈ nội dung của trang, không thêm nhận xét hay tiêu đề."
)

CAPTION_PROMPT = (
    "Mô tả chi tiết hình/biểu đồ này để một hệ thống AI có thể trả lời câu hỏi về nó: "
    "loại hình, nội dung chính, nhãn/trục/thành phần, công thức (viết dạng LaTeX), "
    "kết luận có thể rút ra. 2-4 câu tiếng Việt, ngắn gọn."
)

INSPECT_PROMPT = (
    "Câu hỏi của người học: {question}\n"
    "Đoạn văn bản gần nhất trong tài liệu (kèm ảnh bên trên để bạn đối chiếu): {context}\n\n"
    "Công việc của bạn: đọc CHUẨN XÁC số liệu, nhãn trục, đơn vị, công thức (LaTeX) "
    "và thành phần của hình, rồi trả lời ngắn gọn bằng tiếng Việt (tối đa 4 câu, "
    "mỗi câu ≤ 20 từ) phần nào hình giúp trả lời câu hỏi. Chỉ trích dẫn số "
    "bạn THẤY THẬT SỰ trong hình - tuyệt đối không bịa. Nếu con số xuất hiện "
    "trong đoạn văn bản bạn KHÔNG THẤY trong hình thì KHÔNG NÊU nó.\n\n"
    "QUY TẮC NẶNG NỀ (đọc kỹ, không được bỏ qua):\n"
    "1. Nếu hình KHÔNG nói lên điều gì có giá trị cho câu hỏi (sai chủ đề, "
    "không đủ chi tiết, chỉ là icon/biểu tượng, hay liên quan gián tiếp), "
    "HÃY trả lời CHỈ đúng cụm từ: KHÔNG LIÊN QUAN (không thêm gì khác).\n"
    "2. Nếu hình nói được, mỗi câu phải chứa một sự kiện KHÁCH QUAN "
    "(giá trị, nhãn, đơn vị, công thức) - không được chỉ bình luận chung chung.\n"
    "3. Không được dùng các từ: 'có thể', 'có vẻ', 'tương tự', 'giống như' - "
    "chỉ đưa ra điều bạn THẤY trong hình.\n"
)

# Marker the vision model returns when the inspected figure does not actually
# support the question; callers treat it as "no analysis" so the answer is not
# prefixed with an irrelevant figure section.
_IRRELEVANT_MARKER = "KHÔNG LIÊN QUAN"
# Case-insensitive patterns the model may produce instead of the exact marker
# (lower-cased, accent-stripped).
_IRRELEVANT_PATTERNS = (
    "không liên quan",
    "khong lien quan",
    "irrelevant",
    "không hỗ trợ",
    "không trả lời được",
    "không thể phân tích",
    "chỉ là icon",
    "không liên quan đến câu hỏi",
)


def _deaccent(s: str) -> str:
    """Lower-case and strip Vietnamese diacritics (NFKD + drop combining marks)."""
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")


def _is_irrelevant(text: str) -> bool:
    """True if the vision model's reply is a "not relevant" marker of any kind."""
    if _IRRELEVANT_MARKER in text.upper():
        return True
    # De-accent so "KHÔNG LIÊN QUAN" and "KHONG LIEN QUAN" both match.
    norm = _deaccent(text)
    for p in _IRRELEVANT_PATTERNS:
        if _deaccent(p) in norm:
            return True
    return False


async def _call(
    prompt: str,
    image: Optional[bytes] = None,
    image_mime: str = "image/png",
    max_tokens: int = 800,
) -> Optional[str]:
    """One vision/text call. Returns the text, or None on any failure."""
    api_key = settings.openai_api_key
    if not api_key:
        return None
    content = []
    if image:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{image_mime};base64,{base64.b64encode(image).decode()}"},
            }
        )
    content.append({"type": "text", "text": prompt})
    payload = {
        "model": settings.vision_model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                OPENAI_CHAT_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError):
        return None


async def ocr_page(page_png: bytes) -> Optional[str]:
    """Transcribe a scanned page image to plain text (math as LaTeX)."""
    return await _call(OCR_PROMPT, page_png, max_tokens=1500)


async def caption_figure(figure_png: bytes, mime: str = "image/png") -> Optional[str]:
    """Describe a figure/chart so its content becomes searchable text."""
    return await _call(CAPTION_PROMPT, figure_png, mime)


async def inspect_figure(question: str, context: str, figure: bytes, mime: str = "image/png") -> Optional[str]:
    """Query-time vision: let the model look at the ACTUAL figure while answering.

    This is what makes figure-heavy questions answerable - the model sees the
    real pixels, not just the index-time caption.

    Returns the analysis text, or None both when the call fails AND when the
    model judges the figure irrelevant to the question (it is instructed to
    reply with exactly the marker below in that case). Callers treat None as
    "no figure to show" so the answer is never prefixed with a stray section.
    """
    result = await _call(
        INSPECT_PROMPT.format(question=question, context=context[:600]),
        figure,
        mime,
        max_tokens=600,
    )
    if result is None:
        return None
    if _is_irrelevant(result):
        return None
    return result
