import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import User, Document, DocumentStatus

# Test database (isolated from test_api.py's test.db)
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reading.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers(client):
    client.post(
        "/api/auth/register",
        json={
            "email": "reader@example.com",
            "password": "password123",
            "confirm_password": "password123",
            "full_name": "Reader",
        },
    )
    login = client.post(
        "/api/auth/login",
        data={"username": "reader@example.com", "password": "password123"},
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def user_doc(auth_headers):
    """Register is already done by auth_headers; seed a READY document and
    return (user_id, document_id)."""
    db = TestingSessionLocal()
    user = db.query(User).filter(User.email == "reader@example.com").first()
    doc = Document(
        user_id=user.id,
        filename="bai-giang.pdf",
        file_path="documents/test_reading.pdf",
        file_type="pdf",
        status=DocumentStatus.READY,
        total_pages=10,
    )
    db.add(doc)
    db.commit()
    doc_id = doc.id
    user_id = user.id
    db.close()
    return user_id, doc_id


# ---------------------------------------------------------------------------
# Pure helper
# ---------------------------------------------------------------------------

def test_filter_results_by_pages():
    from app.services.reading_service import filter_results_by_pages

    results = [
        {"content": "[Trang 3] định nghĩa tam giác", "id": "c3"},
        {"content": "[Trang 7] định lý pitago", "id": "c7"},
        {"content": "[Trang 3] công thức diện tích", "id": "c3b"},
        {"content": "[Trang 1] giới thiệu", "id": "c1"},
    ]
    out = filter_results_by_pages(results, {"3"}, limit=6)
    ids = [r["id"] for r in out]
    # page-3 chunks come first, in original relative order
    assert ids[0] == "c3"
    assert ids[1] == "c3b"
    # a non-page-3 chunk never precedes a page-3 chunk
    assert ids.index("c3b") < ids.index("c7")
    # limit respected
    assert len(out) <= 6


# ---------------------------------------------------------------------------
# Annotations CRUD
# ---------------------------------------------------------------------------

def test_annotation_crud(client, auth_headers, user_doc):
    _, doc_id = user_doc

    created = client.post(
        f"/api/reading/{doc_id}/annotations",
        json={"page": 2, "text": "ghi chú x", "type": "note"},
        headers=auth_headers,
    )
    assert created.status_code == 201
    ann_id = created.json()["id"]

    listing = client.get(f"/api/reading/{doc_id}/annotations", headers=auth_headers)
    assert listing.status_code == 200
    assert len(listing.json()) == 1
    assert listing.json()[0]["type"] == "note"

    bad = client.post(
        f"/api/reading/{doc_id}/annotations",
        json={"text": "x", "type": "bogus"},
        headers=auth_headers,
    )
    assert bad.status_code == 422

    deleted = client.delete(
        f"/api/reading/{doc_id}/annotations/{ann_id}", headers=auth_headers
    )
    assert deleted.status_code == 204

    listing = client.get(f"/api/reading/{doc_id}/annotations", headers=auth_headers)
    assert len(listing.json()) == 0


def test_annotation_foreign_document_404(client, auth_headers, user_doc):
    _, doc_id = user_doc
    other = uuid.uuid4()
    r = client.get(f"/api/reading/{other}/annotations", headers=auth_headers)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Ask endpoint (RAG + LLM monkeypatched, no Qdrant / no real LLM needed)
# ---------------------------------------------------------------------------

def test_ask_happy_path(client, auth_headers, user_doc, monkeypatch):
    from app.ai.rag import RAGPipeline
    from app.services import reading_service as rs

    _, doc_id = user_doc

    async def fake_search(self, query, user_id, document_ids=None, limit=5):
        return [
            {
                "content": "[Trang 3] nội dung ABC của định lý.",
                "document_name": "bai-giang.pdf",
                "document_id": doc_id,
                "id": "c1",
                "figure": None,
            }
        ]

    async def fake_generate(prompt, system_prompt=None, **kw):
        return "Đáp án: ABC được nêu ở trang 3."

    monkeypatch.setattr(RAGPipeline, "search_documents", fake_search)
    monkeypatch.setattr(rs.llm_manager, "generate", fake_generate)

    r = client.post(
        f"/api/reading/{doc_id}/ask",
        json={"question": "ABC là gì?", "context_pages": [3]},
        headers=auth_headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert "trang 3" in data["answer"].lower()
    assert data["sources"] and data["sources"][0]["page"] == "3"


def test_ask_502_on_placeholder(client, auth_headers, user_doc, monkeypatch):
    from app.ai.rag import RAGPipeline
    from app.services import reading_service as rs

    _, doc_id = user_doc

    async def fake_search(self, query, user_id, document_ids=None, limit=5):
        return [
            {
                "content": "[Trang 3] nội dung.",
                "document_name": "bai-giang.pdf",
                "document_id": doc_id,
                "id": "c1",
                "figure": None,
            }
        ]

    async def fake_generate(prompt, system_prompt=None, **kw):
        return "[Placeholder] Đây là câu trả lời mẫu."

    monkeypatch.setattr(RAGPipeline, "search_documents", fake_search)
    monkeypatch.setattr(rs.llm_manager, "generate", fake_generate)

    r = client.post(
        f"/api/reading/{doc_id}/ask",
        json={"question": "ABC là gì?"},
        headers=auth_headers,
    )
    assert r.status_code == 502


def test_ask_not_ready_409(client, auth_headers, user_doc):
    from app.models import Document as DocModel, DocumentStatus

    _, doc_id = user_doc
    db = TestingSessionLocal()
    doc = db.query(DocModel).get(doc_id)
    doc.status = DocumentStatus.EXTRACTING
    db.commit()
    db.close()

    r = client.post(
        f"/api/reading/{doc_id}/ask",
        json={"question": "x?"},
        headers=auth_headers,
    )
    assert r.status_code == 409
