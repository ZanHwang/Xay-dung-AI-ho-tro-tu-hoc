"""Shared figure-inspection helper for query-time vision.

Moved out of the RAG orchestrator so the reading workspace (document-scoped
Q&A) can reuse the exact same "look at the top figure-backed hit" flow.
"""
import os
import re
import unicodedata
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.ai.vision import inspect_figure
from app.config import settings

# Keywords that mark a question is actually ABOUT a figure/chart/table
# (as opposed to a random top-1 RAG result that happens to carry a figure).
# Matched against the NORMALIZED (diacritic-stripped, lower-cased) question,
# so we use NO-DIACRITIC spellings. Two families:
#   * "hinh*"  : any word containing the token "hinh" -> hình, hình vẽ, ...
#   * explicit no-diacritic spellings of common chart/table/number words.
# The gate is intentionally broad: a false positive just costs one extra
# vision call (still capped by the _is_irrelevant marker); a false negative
# silently skips figure-backed answers, which is the bug we are fixing.
# No-diacritic spellings of the figure/chart/table keywords. Matched against
# the de-accented question (NFKD + strip combining marks), so "đồ thị" ->
# "do thi", "hình vẽ" -> "hinh ve".
_FIGURE_INTENT_RE = re.compile(
    r"(?:"
    r"hinh\w*|"
    r"do thi|bieu do|do thi|solieu|solieu|bang|chart|figure|graph|diagram|"
    r"matran|axis|truc|diem|thongke|sieu|doi|"
    r"thongso|luong|tonghop"
    r")",
    re.IGNORECASE,
)


def _deaccent(s: str) -> str:
    """Lower-case and strip Vietnamese diacritics (NFKD + drop combining marks)."""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")

def _question_mentions_figure(question: str) -> bool:
    """Cheap pre-filter: does the user's question actually point at a figure?"""
    if not question:
        return False
    norm = _deaccent(question)
    return bool(_FIGURE_INTENT_RE.search(norm))


async def inspect_top_figure(
    user_id: UUID,
    message: str,
    search_results: List[Dict[str, Any]],
) -> Optional[str]:
    """Look at the top figure-backed hit with the vision model.

    Guardrails that keep the caller's answer from being polluted with an
    irrelevant figure section:
      * The user's question must actually mention a figure/chart/table
        (see _FIGURE_INTENT_RE) - otherwise we return None immediately and
        skip the image call entirely (saves a vision API call + 0 stray text).
      * Only the FIRST figure-backed result is inspected (one image call
        keeps query cost bounded).
      * If the vision model judges the figure irrelevant (replies with the
        marker), the analysis is dropped to None - so callers never prefix
        the answer with a stray "PHÂN TÍCH HÌNH" section.
    """
    if not _question_mentions_figure(message):
        return None

    for result in search_results:
        if not result.get("figure"):
            continue
        # result["figure"] is just the stored filename (e.g. "000.png");
        # the path mirrors the service's layout:
        #   <bucket>/<user_id>/figures/<document_id>/<filename>
        doc_id = result.get("document_id")
        if not doc_id:
            continue
        figure_dir = os.path.join(
            os.getcwd(),
            settings.object_storage_bucket,
            str(user_id),
            "figures",
            str(doc_id),
        )
        filename = os.path.basename(result["figure"])
        absolute_path = os.path.join(figure_dir, filename)
        if not os.path.exists(absolute_path):
            continue
        try:
            with open(absolute_path, "rb") as f:
                image = f.read()
        except OSError:
            continue
        mime = "image/jpeg" if absolute_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
        return await inspect_figure(
            question=message,
            context=result.get("content", "")[:600],
            figure=image,
            mime=mime,
        )
    return None
