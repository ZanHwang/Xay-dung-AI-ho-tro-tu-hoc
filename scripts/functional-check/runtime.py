"""Isolated test runtime. Does not load the project's .env or production DB."""
import os
import sys
import tempfile
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
ROOT = Path(tempfile.gettempdir()) / 'tuhoc-functional-check'
ROOT.mkdir(parents=True, exist_ok=True)
os.chdir(ROOT)
sys.path.insert(0, str(PROJECT / 'backend'))
os.environ['DATABASE_URL'] = 'sqlite:///' + (ROOT / 'functional.db').as_posix()
os.environ['SECRET_KEY'] = 'local-functional-check-only-not-production'
os.environ['OBJECT_STORAGE_BUCKET'] = str(ROOT / 'uploads')
for key in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_EMBEDDING_API_KEY', 'QDRANT_API_KEY'):
    os.environ[key] = ''
os.environ['QDRANT_URL'] = 'http://127.0.0.1:6333'

# The project targets PostgreSQL. Only adapt the DDL type spelling for an
# isolated SQLite test database; application routes and services are unchanged.
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import UUID

@compiles(UUID, 'sqlite')
def sqlite_uuid(element, compiler, **kwargs):
    return 'CHAR(32)'

from app.main import app

@app.get('/_functional-check')
def isolated_runtime_marker():
    return {'isolated_functional_check': True}

from app.ai.llm import LLMManager, OpenAIProvider, AnthropicProvider
async def blocked_ai(*args, **kwargs):
    raise RuntimeError('AI calls disabled by user request')
LLMManager.generate = blocked_ai
OpenAIProvider.generate = blocked_ai
AnthropicProvider.generate = blocked_ai
from app.ai.embedding import EmbeddingProvider
EmbeddingProvider.embed = blocked_ai

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8000, log_level='warning')
