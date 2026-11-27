"""Regression tests for the figure-inspection guard rails.

Covers what keeps a stray "PHÂN TÍCH HÌNH" section from being prefixed onto
ordinary text answers:

  1. `_is_irrelevant` (vision.py) - the marker the vision model replies with
     when the inspected figure does not actually support the question.
     Must match the marker in every spelling / language / diacritic form the
     model plausibly produces.
  2. `inspect_top_figure` (figures.py) - inspects the best-matching
     figure-backed RAG result regardless of how the question is worded (no
     keyword gate: retrieval relevance is already the signal - see the
     function's docstring for why a keyword gate was removed).

Both are pure (no I/O, no LLM), so they can be unit-tested without mocking
any OpenAI client or Qdrant connection.
"""
import os
import sys
import tempfile
import uuid

import pytest

# Make the package importable when tests are run with `pytest tests/...` from
# the backend root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.ai.vision import _is_irrelevant  # noqa: E402
from app.ai.figures import inspect_top_figure  # noqa: E402


# ---------------------------------------------------------------------------
# Marker detection (_is_irrelevant)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    # Exact marker, any case
    ("KHÔNG LIÊN QUAN", True),
    ("không liên quan", True),
    ("Không liên quan", True),
    # Marker embedded in a longer sentence
    ("Hình này không liên quan đến câu hỏi.", True),
    ("Không hỗ trợ được.", True),
    # Diacritic-stripped spelling
    ("khong lien quan", True),
    # English variant
    ("This figure is irrelevant to the question.", True),
    # Real analyses must NOT be swallowed
    ("Đồ thị F1-score theo ngưỡng, trục x là threshold.", False),
    ("Bảng mô tả tham số: hidden=512, lr=1e-3.", False),
    ("Trị số đỉnh của đường cam là 0.73.", False),
    # Empty / None
    ("", False),
])
def test_is_irrelevant(text, expected):
    assert _is_irrelevant(text) is expected, f"got {expected!r} -> {text!r}"


# ---------------------------------------------------------------------------
# End-to-end behavior of inspect_top_figure (mocks the image I/O + vision call)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_inspect_top_figure_inspects_regardless_of_question_wording():
    """No keyword gate anymore: a plain-text question (no figure/chart/table
    word in it) still triggers vision when the top RAG result is
    figure-backed - retrieval relevance is the only signal used."""
    import app.config as C
    from unittest import mock

    user_id = uuid.uuid4()
    doc_id = uuid.uuid4()
    tmp = tempfile.mkdtemp()
    fig_dir = os.path.join(tmp, str(user_id), "figures", str(doc_id))
    os.makedirs(fig_dir, exist_ok=True)
    open(os.path.join(fig_dir, "001.png"), "wb").write(b"\x89PNG fake")

    results = [{"content": "x", "figure": "001.png", "document_id": str(doc_id)}]

    with mock.patch.object(__import__("app.ai.figures", fromlist=["os"]).os, "getcwd", return_value=tmp), \
         mock.patch.object(C.settings, "object_storage_bucket", ""), \
         mock.patch.object(__import__("app.ai.figures", fromlist=["inspect_figure"]), "inspect_figure",
                           new=mock.AsyncMock(return_value="Đồ thị F1 theo ngưỡng")) as m:
        out = await inspect_top_figure(user_id, "định nghĩa tam giác là gì?", results)

    assert out == "Đồ thị F1 theo ngưỡng"
    assert m.call_count == 1


@pytest.mark.asyncio
async def test_inspect_top_figure_skips_results_with_no_figure_until_one_has_it():
    """Walks results in relevance order and inspects the FIRST one that
    actually carries a figure, not necessarily the top-ranked result."""
    import app.config as C
    from unittest import mock

    user_id = uuid.uuid4()
    doc_id = uuid.uuid4()
    tmp = tempfile.mkdtemp()
    fig_dir = os.path.join(tmp, str(user_id), "figures", str(doc_id))
    os.makedirs(fig_dir, exist_ok=True)
    open(os.path.join(fig_dir, "002.png"), "wb").write(b"\x89PNG fake")

    results = [
        {"content": "no figure here", "figure": None, "document_id": str(doc_id)},
        {"content": "x", "figure": "002.png", "document_id": str(doc_id)},
    ]

    with mock.patch.object(__import__("app.ai.figures", fromlist=["os"]).os, "getcwd", return_value=tmp), \
         mock.patch.object(C.settings, "object_storage_bucket", ""), \
         mock.patch.object(__import__("app.ai.figures", fromlist=["inspect_figure"]), "inspect_figure",
                           new=mock.AsyncMock(return_value="Bảng số liệu")) as m:
        out = await inspect_top_figure(user_id, "giải thích đoạn văn trên", results)

    assert out == "Bảng số liệu"
    assert m.call_count == 1
