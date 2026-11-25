"""Regression tests for the figure-inspection guard rails.

Covers the two layers that keep a stray "PHÂN TÍCH HÌNH" section from being
prefixed onto ordinary text answers:

  1. `_is_irrelevant` (vision.py) - the marker the vision model replies with
     when the inspected figure does not actually support the question.
     Must match the marker in every spelling / language / diacritic form the
     model plausibly produces.
  2. `_question_mentions_figure` (figures.py) - the cheap pre-filter that
     skips the image call entirely when the user's question is not about a
     figure/chart/table.

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
from app.ai.figures import (  # noqa: E402
    _question_mentions_figure,
    inspect_top_figure,
)


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
# Intent gate (_question_mentions_figure)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("question,expected", [
    # Real figure-intent questions
    ("đồ thị F1-score cho biết điều gì?", True),
    ("hình vẽ trong trang 5 mô tả cái gì?", True),
    ("bảng tham số có những cột nào?", True),
    ("số liệu trong biểu đồ này?", True),
    # Plain-text questions - no figure gate
    ("định nghĩa tam giác là gì?", False),
    ("tham số hidden layer là bao nhiêu?", False),
    ("công thức diện tích tam giác?", False),
    ("giải thích đoạn văn trên", False),
    # Edge
    ("", False),
])
def test_question_mentions_figure(question, expected):
    assert _question_mentions_figure(question) is expected, f"got {expected!r} -> {question!r}"


# ---------------------------------------------------------------------------
# End-to-end gate on inspect_top_figure (mocks the image I/O + vision call)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_inspect_top_figure_skips_image_call_when_question_is_not_about_a_figure():
    """A plain-text question must NOT trigger a vision call even when the
    top RAG result is figure-backed."""
    import app.config as C
    from unittest import mock

    user_id = uuid.uuid4()
    doc_id = uuid.uuid4()
    tmp = tempfile.mkdtemp()
    fig_dir = os.path.join(tmp, str(user_id), "figures", str(doc_id))
    os.makedirs(fig_dir, exist_ok=True)
    open(os.path.join(fig_dir, "001.png"), "wb").write(b"\x89PNG fake")

    results = [{"content": "x", "figure": "001.png", "document_id": str(doc_id)}]

    with mock.patch.object(figos := __import__("app.ai.figures", fromlist=["os"]).os, "getcwd", return_value=tmp), \
         mock.patch.object(C.settings, "object_storage_bucket", ""), \
         mock.patch.object(__import__("app.ai.figures", fromlist=["inspect_figure"]), "inspect_figure",
                           new=mock.AsyncMock(return_value="DO THI")) as m:
        out = await inspect_top_figure(user_id, "định nghĩa tam giác là gì?", results)

    assert out is None
    assert m.call_count == 0, f"vision call should be gated out, got {m.call_count} calls"


@pytest.mark.asyncio
async def test_inspect_top_figure_inspects_when_question_mentions_figure():
    """When the question is about a figure, the top figure-backed hit is
    sent to the vision model and its analysis is returned verbatim."""
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
        out = await inspect_top_figure(user_id, "đồ thị F1 cho biết gì?", results)

    assert out == "Đồ thị F1 theo ngưỡng"
    assert m.call_count == 1
