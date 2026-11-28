"""Lộ trình: topic states and what "Học tiếp" continues."""
import asyncio
import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import (
    Document, DocumentStatus, DocumentStudy, Quiz, QuizQuestion, QuizResult, Subject, User,
)

NOW = datetime.utcnow()


def ago(**delta) -> datetime:
    return NOW - timedelta(**delta)


@pytest.fixture
def sessions(tmp_path):
    engine = create_engine(
        "sqlite:///" + (tmp_path / "path.db").as_posix(), connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield sessionmaker(autocommit=False, autoflush=False, bind=engine)
    engine.dispose()


@pytest.fixture
def client(sessions):
    def override_get_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def no_backfill(monkeypatch):
    """Record, instead of running, the background topic detection (an AI call)."""
    started = []

    def record(document_id, user_id):
        started.append(document_id)
        return asyncio.sleep(0)

    monkeypatch.setattr("app.services.path_service.backfill_document_topics_in_background", record)
    return started


class Learner:
    """A signed-in user plus helpers that seed their data."""

    def __init__(self, client, sessions, email):
        self.client, self.sessions = client, sessions
        client.post("/api/auth/register", json={
            "email": email, "password": "password123", "confirm_password": "password123", "full_name": "Learner",
        })
        login = client.post("/api/auth/login", data={"username": email, "password": "password123"})
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        with sessions() as db:
            self.id = db.query(User).filter(User.email == email).one().id

    def _add(self, row):
        with self.sessions() as db:
            db.add(row)
            db.commit()
            return getattr(row, "id", None)

    def subject(self, name="Sinh học"):
        return self._add(Subject(user_id=self.id, name=name))

    def document(self, subject_id, name, topics=("A", "B", "C"), uploaded=None, status=DocumentStatus.READY):
        return self._add(Document(
            user_id=self.id, subject_id=subject_id, filename=name, file_path=f"documents/{name}",
            file_type="pdf", status=status, created_at=uploaded or ago(days=30),
            topics_json=None if topics is None else json.dumps(list(topics)),
        ))

    def attempt(self, subject_id, document_id, topic, correct, answered=4, questions=4, at=None,
                quiz_id=None, title="Quiz"):
        """Submit a quiz (a new one with `questions` questions, or `quiz_id`
        again) answering `answered` questions; returns (quiz_id, result_id)."""
        if quiz_id is None:
            quiz_id = self._add(Quiz(
                user_id=self.id, subject_id=subject_id, document_id=document_id, title=title, topic=topic,
            ))
            for index in range(questions):
                self._add(QuizQuestion(
                    quiz_id=quiz_id, question_text=f"Câu {index + 1}", options='["a","b"]', correct_answer=0,
                ))
        result_id = self._add(QuizResult(
            user_id=self.id, quiz_id=quiz_id, score=100 * correct / answered,
            total_questions=answered, correct_count=correct, created_at=at or ago(days=1),
        ))
        return quiz_id, result_id

    def home(self):
        response = self.client.get("/api/subjects/path/continue", headers=self.headers)
        assert response.status_code == 200, response.text
        return response.json()

    def next_topic(self):
        found = self.home()["next"]
        return found and (found["document_name"], found["topic"])

    def visit(self, subject_id, document_id):
        return self.client.post(
            f"/api/subjects/{subject_id}/path/documents/{document_id}/visit", headers=self.headers,
        )


@pytest.fixture
def learner(client, sessions):
    return Learner(client, sessions, "learner@example.com")


def test_topic_states_follow_full_attempts_only(learner):
    subject = learner.subject()
    document = learner.document(subject, "chuong-1.pdf")
    learner.attempt(subject, document, "A", correct=4, at=ago(days=3))
    learner.attempt(subject, document, "A", correct=1, at=ago(days=2))
    # 1/1 in a review session must not finish topic B
    learner.attempt(subject, document, "B", correct=1, answered=1, at=ago(days=1))

    response = learner.client.get(f"/api/subjects/{subject}/path/topics", headers=learner.headers)

    assert response.status_code == 200
    assert response.json()[0]["topics"] == [
        {"topic": "A", "state": "done", "best_percent": 100, "recent_percent": 25},
        {"topic": "B", "state": "current", "best_percent": None, "recent_percent": None},
        {"topic": "C", "state": "locked", "best_percent": None, "recent_percent": None},
    ]


def test_continue_is_empty_without_documents(learner):
    assert learner.next_topic() is None


def test_continue_starts_with_the_oldest_upload_when_nothing_was_studied(learner):
    subject = learner.subject()
    learner.document(subject, "moi.pdf", uploaded=ago(days=1))
    learner.document(subject, "cu.pdf", uploaded=ago(days=9))

    assert learner.next_topic() == ("cu.pdf", "A")


def test_continue_returns_the_whole_road_of_that_document(learner):
    subject = learner.subject()
    document = learner.document(subject, "chuong-1.pdf", topics=("A", "B"))

    found = learner.home()["next"]

    assert found["subject_id"] == str(subject)
    assert found["document_id"] == str(document)
    assert [item["state"] for item in found["topics"]] == ["current", "locked"]


def test_continue_follows_the_latest_quiz(learner):
    subject = learner.subject()
    first = learner.document(subject, "chuong-1.pdf", uploaded=ago(days=9))
    second = learner.document(subject, "chuong-2.pdf", uploaded=ago(days=2))
    learner.attempt(subject, first, "A", correct=4, at=ago(days=3))
    learner.attempt(subject, second, "A", correct=4, at=ago(days=1))

    assert learner.next_topic() == ("chuong-2.pdf", "B")


def test_continue_follows_a_lesson_visit_until_a_newer_quiz(learner):
    subject = learner.subject()
    first = learner.document(subject, "chuong-1.pdf", uploaded=ago(days=9))
    second = learner.document(subject, "chuong-2.pdf", uploaded=ago(days=2))
    learner.attempt(subject, first, "A", correct=4, at=ago(days=1))

    assert learner.visit(subject, second).status_code == 204
    assert learner.next_topic() == ("chuong-2.pdf", "A")

    learner.attempt(subject, first, "B", correct=1, at=datetime.utcnow() + timedelta(minutes=1))
    assert learner.next_topic() == ("chuong-1.pdf", "B")


def test_visiting_again_moves_the_same_row_forward(learner, sessions):
    subject = learner.subject()
    document = learner.document(subject, "chuong-1.pdf")
    learner._add(DocumentStudy(document_id=document, last_studied_at=ago(days=5)))

    assert learner.visit(subject, document).status_code == 204
    assert learner.visit(subject, document).status_code == 204

    with sessions() as db:
        rows = db.query(DocumentStudy).all()
        assert [row.document_id for row in rows] == [document]
        assert rows[0].last_studied_at > ago(minutes=5)


def test_a_review_session_does_not_change_what_comes_next(learner):
    subject = learner.subject()
    first = learner.document(subject, "chuong-1.pdf", uploaded=ago(days=9))
    second = learner.document(subject, "chuong-2.pdf", uploaded=ago(days=2))
    learner.attempt(subject, first, "A", correct=4, at=ago(days=3))
    learner.attempt(subject, second, "A", correct=1, answered=1, at=ago(hours=1))

    assert learner.next_topic() == ("chuong-1.pdf", "B")


def test_a_finished_document_hands_over_to_the_next_recent_one(learner):
    subject = learner.subject()
    oldest = learner.document(subject, "chuong-0.pdf", uploaded=ago(days=20))
    older = learner.document(subject, "chuong-1.pdf", uploaded=ago(days=9))
    finished = learner.document(subject, "chuong-2.pdf", topics=("A",), uploaded=ago(days=2))
    learner.attempt(subject, older, "A", correct=4, at=ago(days=2))
    learner.attempt(subject, finished, "A", correct=4, at=ago(days=1))

    assert learner.next_topic() == ("chuong-1.pdf", "B")
    assert oldest  # never studied, so it waits behind the studied one


def test_continue_looks_at_every_subject(learner):
    for number in range(1, 5):
        subject = learner.subject(f"Môn {number}")
        document = learner.document(subject, f"mon-{number}.pdf", topics=("A",), uploaded=ago(days=10 - number))
        if number < 4:
            learner.attempt(subject, document, "A", correct=4, at=ago(hours=number))

    assert learner.next_topic() == ("mon-4.pdf", "A")


def test_continue_is_empty_when_everything_is_done(learner):
    subject = learner.subject()
    document = learner.document(subject, "chuong-1.pdf", topics=("A",))
    learner.attempt(subject, document, "A", correct=3)

    assert learner.next_topic() is None


def test_continue_skips_unready_and_topicless_documents(learner, no_backfill):
    subject = learner.subject()
    learner.document(subject, "dang-xu-ly.pdf", status=DocumentStatus.OCR_PROCESSING, uploaded=ago(days=9))
    topicless = learner.document(subject, "chua-co-chu-de.pdf", topics=None, uploaded=ago(days=8))
    learner.document(subject, "rong.pdf", topics=(), uploaded=ago(days=7))
    learner.document(subject, "loi.pdf", status=DocumentStatus.FAILED, uploaded=ago(days=7))
    learner.document(None, "khong-thuoc-mon.pdf", uploaded=ago(days=6))
    learner.document(subject, "dung.pdf", uploaded=ago(days=1))

    home = learner.home()

    assert (home["next"]["document_name"], home["next"]["topic"]) == ("dung.pdf", "A")
    assert home["others"] == [] and home["state"] == "ready"
    # topics never computed: worked out in the background, like the Lộ trình tab does
    assert no_backfill == [topicless]


def test_topic_detection_is_not_restarted_on_every_visit(learner, no_backfill):
    subject = learner.subject()
    topicless = learner.document(subject, "chua-co-chu-de.pdf", topics=None)

    for _ in range(3):
        assert learner.home()["state"] == "preparing"

    assert no_backfill == [topicless]


def test_others_lists_up_to_three_more_roads_in_the_same_order(learner):
    subject = learner.subject()
    for number in range(1, 6):
        document = learner.document(subject, f"chuong-{number}.pdf", uploaded=ago(days=10 + number))
        learner.attempt(subject, document, "A", correct=4, at=ago(hours=number))

    home = learner.home()

    assert home["next"]["document_name"] == "chuong-1.pdf"
    assert [road["document_name"] for road in home["others"]] == ["chuong-2.pdf", "chuong-3.pdf", "chuong-4.pdf"]
    assert all(road["topic"] == "B" and road["subject_id"] == str(subject) for road in home["others"])


@pytest.mark.parametrize("documents, state", [
    ([], "no_documents"),
    ([dict(status=DocumentStatus.FAILED)], "no_documents"),
    ([dict(topics=())], "no_documents"),
    ([dict(status=DocumentStatus.EMBEDDING)], "preparing"),
    ([dict(topics=None)], "preparing"),
    ([dict(topics=("A",), done=True)], "finished"),
    ([dict(topics=("A",), done=True), dict(status=DocumentStatus.CHUNKING)], "preparing"),
])
def test_state_explains_why_there_is_nothing_to_continue(learner, documents, state):
    subject = learner.subject()
    for index, spec in enumerate(documents):
        done = spec.pop("done", False)
        document = learner.document(subject, f"tai-lieu-{index}.pdf", **spec)
        if done:
            learner.attempt(subject, document, "A", correct=4)

    assert learner.home() == {"next": None, "others": [], "state": state}


def test_another_users_documents_are_invisible_and_untouchable(learner, client, sessions):
    other = Learner(client, sessions, "other@example.com")
    subject = other.subject()
    document = other.document(subject, "cua-nguoi-khac.pdf")

    assert learner.next_topic() is None
    assert learner.visit(subject, document).status_code == 404
    own_subject = learner.subject()
    assert learner.visit(own_subject, document).status_code == 404
    with sessions() as db:
        assert db.query(DocumentStudy).count() == 0


def test_continue_requires_sign_in(client):
    assert client.get("/api/subjects/path/continue").status_code == 401
