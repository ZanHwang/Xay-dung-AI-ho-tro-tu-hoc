"""What Hôm nay lists when there is a lot: subjects, scores, conversations."""
from app.models import Conversation, DocumentStudy, Message, MessageRole

from tests.test_path import Learner, ago, client, learner, no_backfill, sessions  # noqa: F401 (fixtures)


def subjects(learner):
    response = learner.client.get("/api/subjects/", headers=learner.headers)
    assert response.status_code == 200, response.text
    return {item["name"]: item["stats"]["last_activity"] for item in response.json()["subjects"]}


def chat(learner, subject_id, title, at=None, topic=None, messages=1):
    conversation_id = learner._add(Conversation(
        user_id=learner.id, subject_id=subject_id, title=title, topic=topic,
        created_at=at or ago(days=1), updated_at=at or ago(days=1),
    ))
    for index in range(messages):
        learner._add(Message(
            conversation_id=conversation_id, role=MessageRole.USER, content=f"Câu {index}", created_at=at or ago(days=1),
        ))
    return conversation_id


# ---------------------------------------------------------------- subjects

def test_a_subject_never_used_has_no_last_activity(learner):
    learner.subject("Trống")
    assert subjects(learner) == {"Trống": None}


def test_last_activity_is_the_latest_of_quiz_chat_lesson_and_upload(learner):
    quiz = learner.subject("Quiz")
    learner.attempt(quiz, None, None, correct=1, at=ago(days=4))
    talk = learner.subject("Hỏi")
    chat(learner, talk, "Câu hỏi", at=ago(days=3))
    lesson = learner.subject("Học")
    document = learner.document(lesson, "bai.pdf", uploaded=ago(days=9))
    learner._add(DocumentStudy(document_id=document, last_studied_at=ago(days=2)))
    upload = learner.subject("Tải")
    learner.document(upload, "moi.pdf", uploaded=ago(days=1))

    found = subjects(learner)

    assert [name for name, _ in sorted(found.items(), key=lambda item: item[1], reverse=True)] == ["Tải", "Học", "Hỏi", "Quiz"]
    assert found["Học"].startswith(ago(days=2).date().isoformat())


def test_one_subject_page_has_last_activity_too(learner):
    subject = learner.subject("Một môn")
    chat(learner, subject, "Câu hỏi", at=ago(hours=5))
    response = learner.client.get(f"/api/subjects/{subject}", headers=learner.headers)
    assert response.json()["stats"]["last_activity"] is not None


def test_other_users_activity_does_not_count(learner, client, sessions):
    subject = learner.subject("Của tôi")
    other = Learner(client, sessions, "other@example.com")
    other.attempt(other.subject("Của họ"), None, None, correct=1)
    assert subjects(learner) == {"Của tôi": None}
    assert subject


# ---------------------------------------------------------------- scores

def dashboard(learner):
    response = learner.client.get("/api/progress/dashboard", headers=learner.headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_dashboard_lists_each_quiz_once_with_its_latest_attempt(learner):
    subject = learner.subject()
    first, _ = learner.attempt(subject, None, None, correct=1, at=ago(days=5), title="Một")
    learner.attempt(subject, None, None, correct=3, at=ago(days=1), quiz_id=first)
    learner.attempt(subject, None, None, correct=4, at=ago(days=2), title="Hai")

    recent = dashboard(learner)["recent_quizzes"]

    assert [(row["title"], row["correct_count"]) for row in recent] == [("Một", 3), ("Hai", 4)]
    assert recent[0]["subject_id"] == str(subject) and recent[0]["partial"] is False


def test_dashboard_shows_at_most_five_quizzes(learner):
    subject = learner.subject()
    for number in range(7):
        learner.attempt(subject, None, None, correct=1, at=ago(hours=number), title=f"Quiz {number}")
    assert [row["title"] for row in dashboard(learner)["recent_quizzes"]] == [f"Quiz {n}" for n in range(5)]


def test_a_review_session_is_marked_and_kept_out_of_the_average(learner):
    subject = learner.subject()
    quiz, _ = learner.attempt(subject, None, None, correct=2, at=ago(days=2))
    learner.attempt(subject, None, None, correct=1, answered=1, at=ago(days=1), quiz_id=quiz)

    data = dashboard(learner)

    assert data["recent_quizzes"][0]["partial"] is True
    assert (data["recent_quizzes"][0]["correct_count"], data["recent_quizzes"][0]["total_questions"]) == (1, 1)
    assert (data["total_quizzes"], data["avg_score"]) == (1, 50)


def results(learner, **params):
    response = learner.client.get("/api/progress/results", params=params, headers=learner.headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_results_page_lists_every_attempt_newest_first_in_pages(learner):
    subject = learner.subject()
    quiz, _ = learner.attempt(subject, None, None, correct=1, at=ago(days=9), title="Lặp")
    for number in range(1, 25):
        learner.attempt(subject, None, None, correct=2, at=ago(days=9) + (ago(days=0) - ago(days=9)) * number / 30,
                        quiz_id=quiz)

    first = results(learner, limit=20)
    second = results(learner, limit=20, offset=20)

    assert first["total"] == 25 and len(first["results"]) == 20 and len(second["results"]) == 5
    dates = [row["created_at"] for row in first["results"] + second["results"]]
    assert dates == sorted(dates, reverse=True)
    assert len({row["id"] for row in first["results"] + second["results"]}) == 25


def test_results_page_filters_by_subject_and_hides_other_users(learner, client, sessions):
    biology = learner.subject("Sinh")
    maths = learner.subject("Toán")
    learner.attempt(biology, None, None, correct=1, title="Sinh 1")
    learner.attempt(maths, None, None, correct=1, title="Toán 1")
    other = Learner(client, sessions, "other@example.com")
    other.attempt(other.subject("Sinh"), None, None, correct=1, title="Của người khác")

    assert [row["title"] for row in results(learner, subject_id=str(biology))["results"]] == ["Sinh 1"]
    assert {row["title"] for row in results(learner)["results"]} == {"Sinh 1", "Toán 1"}
    assert results(learner, subject_id=str(other_subject_of(other)))["total"] == 0


def other_subject_of(other):
    with other.sessions() as db:
        from app.models import Subject
        return db.query(Subject).filter(Subject.user_id == other.id).one().id


def test_results_page_requires_sign_in(client):
    assert client.get("/api/progress/results").status_code == 401


# ---------------------------------------------------------------- conversations

def conversations(learner, **params):
    response = learner.client.get("/api/conversations/", params=params, headers=learner.headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_conversations_say_which_belong_to_a_lesson(learner):
    subject = learner.subject()
    chat(learner, subject, "Hỏi thường", at=ago(hours=2))
    chat(learner, subject, "Học: Pha tối", at=ago(hours=1), topic="Pha tối")

    found = {row["title"]: row["topic"] for row in conversations(learner)["conversations"]}

    assert found == {"Hỏi thường": None, "Học: Pha tối": "Pha tối"}


def test_conversations_can_be_searched_by_title(learner, client, sessions):
    subject = learner.subject()
    chat(learner, subject, "Đạo hàm của hàm hợp")
    chat(learner, subject, "ĐẠO HÀM riêng")
    chat(learner, subject, "Tích phân")
    chat(learner, subject, "Ma tran nghich dao")
    chat(learner, subject, "100% chắc chắn")
    other = Learner(client, sessions, "other@example.com")
    chat(other, other.subject(), "Đạo hàm của người khác")

    assert sorted(row["title"] for row in conversations(learner, q="đạo hàm")["conversations"]) in (
        ["ĐẠO HÀM riêng", "Đạo hàm của hàm hợp"],  # Postgres ILIKE folds Vietnamese letters too
        [],  # the SQLite used here only folds ASCII letters
    )
    assert [row["title"] for row in conversations(learner, q="TRAN")["conversations"]] == ["Ma tran nghich dao"]
    assert conversations(learner, q="hàm hợp")["total"] == 1
    assert [row["title"] for row in conversations(learner, q="%")["conversations"]] == ["100% chắc chắn"]
    assert conversations(learner, q="không có")["total"] == 0


def test_conversations_page_with_offset(learner):
    subject = learner.subject()
    for number in range(7):
        chat(learner, subject, f"Cuộc {number}", at=ago(hours=number))
    page = conversations(learner, limit=5, offset=5)
    assert page["total"] == 7 and [row["title"] for row in page["conversations"]] == ["Cuộc 5", "Cuộc 6"]
