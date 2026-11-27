"""Shared figure-inspection helper for query-time vision.

Moved out of the RAG orchestrator so the reading workspace (document-scoped
Q&A) can reuse the exact same "look at the top figure-backed hit" flow.
"""
import os
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.ai.vision import inspect_figure
from app.config import settings


async def inspect_top_figure(
    user_id: UUID,
    message: str,
    search_results: List[Dict[str, Any]],
) -> Optional[str]:
    """Look at the top figure-backed hit with the vision model.

    No keyword gate on the question: RAG retrieval already decided these
    chunks are relevant to the question, so if the best-matching one carries
    a figure, that figure is worth looking at regardless of exact wording -
    an earlier keyword-based gate here both missed valid cases (any phrasing
    that didn't use the listed words) and false-triggered on common unrelated
    words (de-accented substring matches like "bang" catching "bằng" (equals),
    "diem" catching "điểm" (score/point), "doi" catching "đổi" (change)).

    Guardrail that keeps the caller's answer from being polluted with an
    irrelevant figure section:
      * Only the FIRST figure-backed result is inspected (one image call
        keeps query cost bounded) - callers already retrieve in relevance
        order, so this is the best-matching figure available.
      * If the vision model judges the figure irrelevant (replies with the
        marker), the analysis is dropped to None - so callers never prefix
        the answer with a stray "PHÂN TÍCH HÌNH" section.
    """
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
