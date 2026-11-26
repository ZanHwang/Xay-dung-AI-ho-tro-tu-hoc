"""Keep tests independent of the developer's database and AI credentials."""
import os
import tempfile
from pathlib import Path

import pytest
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.compiler import compiles

_test_dir = tempfile.TemporaryDirectory(prefix="tuhoc-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + (Path(_test_dir.name) / "startup.db").as_posix()
os.environ["SECRET_KEY"] = "isolated-tests-only"
os.environ["QDRANT_URL"] = "http://127.0.0.1:6333"
for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_EMBEDDING_API_KEY", "QDRANT_API_KEY"):
    os.environ[key] = ""


@compiles(UUID, "sqlite")
def sqlite_uuid(element, compiler, **kwargs):
    return "CHAR(32)"


def pytest_sessionfinish(session, exitstatus):
    from app.database import engine
    engine.dispose()
    _test_dir.cleanup()


@pytest.fixture(autouse=True)
def no_external_ai(monkeypatch):
    from app.ai.llm import OpenAIProvider, AnthropicProvider
    from app.ai.embedding import EmbeddingProvider

    async def blocked(*args, **kwargs):
        raise AssertionError("Tests must mock AI calls")

    monkeypatch.setattr(OpenAIProvider, "generate", blocked)
    monkeypatch.setattr(AnthropicProvider, "generate", blocked)
    monkeypatch.setattr(EmbeddingProvider, "embed", blocked)
