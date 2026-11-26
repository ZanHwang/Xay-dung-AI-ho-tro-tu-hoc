import json
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import User, Subject, Quiz, QuizQuestion, QuizResult, Review
from app.schemas.quiz import QuizSubmit, QuizWithQuestionsResponse
from app.schemas.class_room import ClassOut
from app.services.quiz_service import QuizService
from app.services.classes_service import ClassService
from app.utils.security import get_current_user
from app.utils.dates import today_hcm


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        yield session
    engine.dispose()


@pytest.fixture
def student(db):
    user = User(email="student@example.com", full_name="Student", hashed_password="unused", role="student")
    db.add(user)
    db.commit()
    return user


def make_quiz(db, user, name="Subject"):
    subject = Subject(user_id=user.id, name=name)
    db.add(subject)
    db.flush()
    quiz = Quiz(user_id=user.id, subject_id=subject.id, title=name, difficulty="medium")
    db.add(quiz)
    db.flush()
    db.add_all([QuizQuestion(quiz_id=quiz.id, question_text=f"Question {i}", options=json.dumps(["yes", "no"]), correct_answer=0) for i in range(3)])
    db.commit()
    return quiz


def test_partial_and_empty_submissions_count_all_questions(db, student):
    quiz = make_quiz(db, student)
    service = QuizService(db)
    result = service.submit_quiz(quiz.id, student.id, QuizSubmit(answers=[{"question_id": quiz.questions[0].id, "selected_answer": 0}]))
    assert result.score == pytest.approx(100 / 3)
    assert result.correct_count == 1 and len(result.answers) == 3
    assert db.query(Review).count() == 3
    empty = service.submit_quiz(quiz.id, student.id, QuizSubmit(answers=[]))
    assert empty.score == 0 and empty.id != result.id


def test_invalid_answers_do_not_leave_partial_results(db, student):
    quiz = make_quiz(db, student)
    answer = {"question_id": quiz.questions[0].id, "selected_answer": 0}
    for answers in ([answer, answer], [{"question_id": uuid.uuid4(), "selected_answer": 0}], [{**answer, "selected_answer": 99}]):
        with pytest.raises(HTTPException) as exc:
            QuizService(db).submit_quiz(quiz.id, student.id, QuizSubmit(answers=answers))
        assert exc.value.status_code == 400
    assert db.query(QuizResult).count() == 0


def test_cross_subject_reviews_serialize_and_filter_before_limit(db, student):
    first = make_quiz(db, student, "First")
    second = make_quiz(db, student, "Second")
    for index, quiz in enumerate((first, second)):
        db.add(Review(user_id=student.id, question_id=quiz.questions[0].id, next_review=today_hcm() - timedelta(days=2-index)))
    db.commit()
    service = QuizService(db)
    mixed = service.create_quiz_from_review(student.id, num_questions=2)
    assert mixed.subject_id is None and len(mixed.questions) == 2
    from app.routers.quizzes import _quiz_with_questions_response
    assert QuizWithQuestionsResponse(**_quiz_with_questions_response(mixed)).subject_id is None
    filtered = service.create_quiz_from_review(student.id, subject_id=second.subject_id, num_questions=1)
    assert filtered.subject_id == second.subject_id and len(filtered.questions) == 1


def test_join_class_returns_teacher_and_actual_member_count(db, student):
    teacher = User(email="teacher@example.com", full_name="Teacher", hashed_password="unused", role="teacher")
    db.add(teacher); db.commit()
    service = ClassService(db)
    created = service.create_class(teacher, "Test class")
    joined = ClassOut(**service.join_class(student.id, created["code"]))
    assert joined.teacher_id == teacher.id and joined.students == 2
    assert service.join_class(student.id, created["code"])["students"] == 2


def test_history_route_is_not_parsed_as_quiz_uuid(db, student):
    quiz = make_quiz(db, student)
    QuizService(db).submit_quiz(quiz.id, student.id, QuizSubmit(answers=[]))
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: student
    try:
        response = TestClient(app).get("/api/quizzes/history/results")
        assert response.status_code == 200
        assert response.json()["total"] == 1
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
