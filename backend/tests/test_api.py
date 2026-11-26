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
