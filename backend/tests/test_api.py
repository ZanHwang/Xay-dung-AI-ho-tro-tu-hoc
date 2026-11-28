import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

# Test database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    # Scoped to this fixture (not module level) so the override doesn't leak
    # into other test files sharing the same `app` singleton within one
    # pytest process.
    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


class TestAuth:
    """Test authentication endpoints."""

    def test_register(self, client):
        """Test user registration."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "full_name": "Test User"
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "test@example.com"
        assert "id" in data

    def test_register_duplicate_email(self, client):
        """Test registration with duplicate email."""
        # Register first user
        client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "full_name": "Test User"
            }
        )

        # Try to register again
        response = client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password456",
                "confirm_password": "password456",
                "full_name": "Another User"
            }
        )
        assert response.status_code == 400

    def test_login(self, client):
        """Test user login."""
        # Register user
        client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "full_name": "Test User"
            }
        )

        # Login
        response = client.post(
            "/api/auth/login",
            data={
                "username": "test@example.com",
                "password": "password123"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_get_me(self, client):
        """Test get current user."""
        # Register and login
        client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "full_name": "Test User"
            }
        )
        login_response = client.post(
            "/api/auth/login",
            data={
                "username": "test@example.com",
                "password": "password123"
            }
        )
        token = login_response.json()["access_token"]

        # Get me
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test@example.com"

    def test_refresh_token(self, client):
        """A valid token can be swapped for a fresh, usable one; no token can't."""
        client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "full_name": "Test User"
            }
        )
        token = client.post(
            "/api/auth/login",
            data={"username": "test@example.com", "password": "password123"}
        ).json()["access_token"]

        response = client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        new_token = response.json()["access_token"]
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_token}"})
        assert me.status_code == 200
        assert me.json()["email"] == "test@example.com"

        assert client.post("/api/auth/refresh").status_code == 401


class TestSubjects:
    """Test subject endpoints."""

    @pytest.fixture
    def auth_headers(self, client):
        """Get auth headers."""
        client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "full_name": "Test User"
            }
        )
        login_response = client.post(
            "/api/auth/login",
            data={
                "username": "test@example.com",
                "password": "password123"
            }
        )
        token = login_response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    def test_create_subject(self, client, auth_headers):
        """Test create subject."""
        response = client.post(
            "/api/subjects/",
            json={
                "name": "Toán học",
                "description": "Môn toán",
                "color": "#ff0000"
            },
            headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Toán học"
        assert data["color"] == "#ff0000"

    def test_get_subjects(self, client, auth_headers):
        """Test get subjects."""
        # Create subject first
        client.post(
            "/api/subjects/",
            json={"name": "Toán học"},
            headers=auth_headers
        )

        # Get subjects
        response = client.get("/api/subjects/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1

    def test_update_subject(self, client, auth_headers):
        """Test update subject."""
        # Create subject
        create_response = client.post(
            "/api/subjects/",
            json={"name": "Toán"},
            headers=auth_headers
        )
        subject_id = create_response.json()["id"]

        # Update subject
        response = client.put(
            f"/api/subjects/{subject_id}",
            json={"name": "Toán nâng cao"},
            headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Toán nâng cao"

    def test_delete_subject(self, client, auth_headers):
        """Test delete subject."""
        # Create subject
        create_response = client.post(
            "/api/subjects/",
            json={"name": "Toán"},
            headers=auth_headers
        )
        subject_id = create_response.json()["id"]

        # Delete subject
        response = client.delete(
            f"/api/subjects/{subject_id}",
            headers=auth_headers
        )
        assert response.status_code == 204


class TestConversations:
    """Test conversation endpoints."""

    @pytest.fixture
    def auth_headers(self, client):
        """Get auth headers."""
        client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "full_name": "Test User"
            }
        )
        login_response = client.post(
            "/api/auth/login",
            data={
                "username": "test@example.com",
                "password": "password123"
            }
        )
        token = login_response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    def test_create_conversation(self, client, auth_headers):
        """Test create conversation."""
        response = client.post(
            "/api/conversations/",
            json={"title": "Hỏi về toán"},
            headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Hỏi về toán"

    def test_chat(self, client, auth_headers, monkeypatch):
        """Test chat endpoint."""
        from app.ai.llm import llm_manager

        async def fake_generate(*args, **kwargs):
            return "Offline test response"

        monkeypatch.setattr(llm_manager, "generate", fake_generate)
        response = client.post(
            "/api/conversations/chat",
            json={
                "content": "Xin chào",
                "mode": "chat"
            },
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert data["message"]["content"] is not None


class TestHealth:
    """Test health check."""

    def test_root(self, client):
        """Test root endpoint."""
        response = client.get("/")
        assert response.status_code == 200
        assert "AI Tutor API" in response.json()["message"]

    def test_health(self, client):
        """Test health endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        assert "status" in response.json()


def _pdf_bytes(pages: int = 2) -> bytes:
    import pymupdf
    doc = pymupdf.open()
    for n in range(1, pages + 1):
        doc.new_page().insert_text((72, 72), f"Noi dung trang {n}")
    return doc.tobytes()


def _login(client, email="test@example.com"):
    client.post("/api/auth/register", json={
        "email": email, "password": "password123",
        "confirm_password": "password123", "full_name": "Test User",
    })
    token = client.post("/api/auth/login", data={"username": email, "password": "password123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _user_id(client, headers):
    return client.get("/api/auth/me", headers=headers).json()["id"]


class TestDocumentStorage:
    """Documents live in shared storage (R2 in production, a temp folder here)."""

    @pytest.fixture(autouse=True)
    def no_background_processing(self, monkeypatch):
        from app.services.document_service import DocumentService

        from app.ai.qdrant_store import qdrant_store

        async def skip(*args, **kwargs):
            return None

        monkeypatch.setattr(DocumentService, "process_document", skip)
        monkeypatch.setattr(qdrant_store, "delete_document", skip)

    def test_upload_download_page_image_and_delete(self, client, isolated_storage):
        from app.services.storage import StorageError, document_key, document_prefix, figure_key
        import asyncio

        headers = _login(client)
        pdf = _pdf_bytes()
        uploaded = client.post(
            "/api/documents/", headers=headers,
            files={"file": ("bai giang.pdf", pdf, "application/pdf")},
        )
        assert uploaded.status_code == 201
        doc = uploaded.json()
        assert isolated_storage.backend.get(document_key(doc["user_id"], doc["id"])) == pdf

        download = client.get(f"/api/documents/{doc['id']}/download", headers=headers)
        assert download.status_code == 200
        assert download.content == pdf
        assert download.headers["content-type"] == "application/pdf"

        page = client.get(f"/api/documents/{doc['id']}/pages/2/image", headers=headers)
        assert page.status_code == 200 and page.content.startswith(b"\x89PNG")
        assert client.get(f"/api/documents/{doc['id']}/pages/0/image", headers=headers).status_code == 404

        asyncio.run(isolated_storage.put(figure_key(doc["user_id"], doc["id"], "000.png"), b"\x89PNG", "image/png"))
        figure = client.get(f"/api/documents/{doc['id']}/figures/000.png", headers=headers)
        assert figure.status_code == 200 and figure.content == b"\x89PNG"

        other = _login(client, "other@example.com")
        assert client.get(f"/api/documents/{doc['id']}/download", headers=other).status_code == 404

        assert client.delete(f"/api/documents/{doc['id']}", headers=headers).status_code in (200, 204)
        isolated_storage._cache.clear()
        for key in (document_key(doc["user_id"], doc["id"]), figure_key(doc["user_id"], doc["id"], "000.png")):
            with pytest.raises(StorageError):
                isolated_storage.backend.get(key)
        assert not isolated_storage.backend._path(document_prefix(doc["user_id"], doc["id"])).exists()

    def test_chat_attachment_shared_and_cleaned_up(self, client, isolated_storage, monkeypatch):
        from app.ai.llm import llm_manager
        from app.services.storage import StorageError, chat_attachment_key
        import json

        async def fake_generate(*args, **kwargs):
            return "Offline test response"

        monkeypatch.setattr(llm_manager, "generate", fake_generate)
        headers = _login(client)
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 32

        assert client.post("/api/conversations/attachments", headers=headers,
                           files={"file": ("fake.png", b"<html>not an image</html>", "image/png")}).status_code == 422

        uploaded = client.post("/api/conversations/attachments", headers=headers,
                               files={"file": ("bai tap.png", png, "image/png")})
        assert uploaded.status_code == 201
        attachment = uploaded.json()
        assert attachment["type"] == "image/png"

        other = _login(client, "other@example.com")
        assert client.get(f"/api/conversations/attachments/{attachment['id']}", headers=other).status_code == 404
        got = client.get(f"/api/conversations/attachments/{attachment['id']}", headers=headers)
        assert got.status_code == 200 and got.content == png

        chat = client.post("/api/conversations/chat", headers=headers, json={
            "content": "Giải giúp bài này", "mode": "chat", "attachment_ids": [attachment["id"]],
        }).json()
        conversation_id = chat["message"]["conversation_id"]
        messages = client.get(f"/api/conversations/{conversation_id}/messages", headers=headers).json()["messages"]
        user_message = next(m for m in messages if m["role"] == "user")
        assert json.loads(user_message["message_metadata"])["attachments"][0]["id"] == attachment["id"]

        assert client.delete(f"/api/conversations/{conversation_id}", headers=headers).status_code == 204
        isolated_storage._cache.clear()
        with pytest.raises(StorageError):
            isolated_storage.backend.get(chat_attachment_key(_user_id(client, headers), attachment["id"]))

    def test_local_storage_rejects_path_traversal(self, isolated_storage):
        with pytest.raises(ValueError):
            isolated_storage.backend.put("../outside.txt", b"x", "text/plain")
