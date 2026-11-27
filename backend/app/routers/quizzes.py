from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional
from uuid import UUID
from app.database import get_db
from app.schemas.quiz import (
    QuizCreate, QuizRename, QuizResponse, QuizWithQuestionsResponse, QuizListResponse,
    QuizWithQuestionsListResponse,
    QuizSubmit, QuizResultResponse, QuizResultListResponse, QuizQuestionResponse,
    QuizCreateNext, SuggestedTopicsResponse
)
from app.services.quiz_service import QuizService
from app.utils.security import get_current_user
from app.models import User, Review
import json

router = APIRouter()


def get_quiz_service(db: Session = Depends(get_db)) -> QuizService:
    return QuizService(db)


def _quiz_to_response(quiz, questions: Optional[list] = None) -> dict:
    """Convert quiz model to response dict. `questions` overrides
    `quiz.questions` (e.g. just the due/wrong subset - see
    _quiz_with_questions_response) without ever touching the real relationship."""
    items = quiz.questions if questions is None else questions
    return {
        "id": quiz.id,
        "user_id": quiz.user_id,
        "subject_id": quiz.subject_id,
        "document_id": quiz.document_id,
        "title": quiz.title,
        "difficulty": quiz.difficulty,
        "source": quiz.source,
        "created_at": quiz.created_at,
        "total_questions": len(items) if items else None
    }


def _quiz_with_questions_response(quiz, db: Optional[Session] = None, questions: Optional[list] = None) -> dict:
    """Convert quiz model to response with questions (or just the given
    `questions` subset - due/wrong-only views never mutate quiz.questions
    itself, see QuizService.get_due_questions/get_wrong_questions). When `db`
    is given, each question's `last_correct` (most recent spaced-repetition
    outcome, if any) is looked up so the frontend can tag "mới sai" vs "đã
    đúng" while taking a due-questions session."""
    items = quiz.questions if questions is None else questions
    response = _quiz_to_response(quiz, items)
    last_correct_by_id = {}
    if db is not None and items:
        rows = db.query(Review).filter(Review.question_id.in_([q.id for q in items])).all()
        last_correct_by_id = {row.question_id: row.last_correct for row in rows}
    response["questions"] = [
        {
            "id": q.id,
            "quiz_id": q.quiz_id,
            "question_text": q.question_text,
            "options": json.loads(q.options) if isinstance(q.options, str) else q.options,
            "correct_answer": q.correct_answer,
            "explanation": q.explanation,
            "topic": q.topic,
            "created_at": q.created_at,
            "last_correct": last_correct_by_id.get(q.id),
        }
        for q in items
    ]
    return response


def _result_to_response(result) -> dict:
    """Convert result model to response dict."""
    answers = [
        {
            "question_id": a.question_id,
            "selected_answer": a.selected_answer,
            "is_correct": a.is_correct,
            "correct_answer": a.question.correct_answer if a.question else None,
            "explanation": a.question.explanation if a.question else None,
            "time_spent": a.time_spent,
            "used_hint": a.used_hint
        }
        for a in result.answers
    ]
    return {
        "id": result.id,
        "quiz_id": result.quiz_id,
        "score": result.score,
        "total_questions": result.total_questions,
        "correct_count": result.correct_count,
        "created_at": result.created_at,
        "answers": answers,
    }


@router.get("/", response_model=QuizListResponse)
async def get_quizzes(
    subject_id: Optional[UUID] = Query(None, description="Filter by subject"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Get all quizzes for the current user.
    """
    quizzes, total = service.get_quizzes_by_user(
        current_user.id, subject_id, limit, offset
    )
    return QuizListResponse(
        total=total,
        quizzes=[_quiz_to_response(q) for q in quizzes]
    )


@router.get("/full", response_model=QuizWithQuestionsListResponse)
async def get_quizzes_full(
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Every quiz of the user, with its questions - used by the frontend to
    rebuild full quiz history (including retaking) on a device/browser that
    doesn't have it in localStorage yet. Must be registered before
    `/{quiz_id}` so "full" isn't parsed as a quiz id.
    """
    quizzes, total = service.get_quizzes_by_user(current_user.id, None, limit, offset)
    return QuizWithQuestionsListResponse(
        total=total,
        quizzes=[_quiz_with_questions_response(q, service.db) for q in quizzes]
    )


@router.post("/", response_model=QuizWithQuestionsResponse, status_code=status.HTTP_201_CREATED)
async def create_quiz(
    data: QuizCreate,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Create a new quiz with AI-generated questions.
    """
    quiz = await service.create_quiz(current_user.id, data)
    return _quiz_with_questions_response(quiz, service.db)


@router.get("/{quiz_id}", response_model=QuizWithQuestionsResponse)
async def get_quiz(
    quiz_id: UUID,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Get a specific quiz with questions.
    Note: Correct answers are included for review purposes.
    """
    quiz = service.get_quiz_by_id(quiz_id, current_user.id)
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    return _quiz_with_questions_response(quiz, service.db)


@router.delete("/{quiz_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quiz(
    quiz_id: UUID,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Delete a quiz and its questions/results.
    """
    deleted = service.delete_quiz(quiz_id, current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )


@router.patch("/{quiz_id}", response_model=QuizWithQuestionsResponse)
async def rename_quiz(
    quiz_id: UUID,
    data: QuizRename,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Rename a quiz. Every place that reads the title straight from the
    backend (due-review popup, a different device's sync) needs this - a
    local-only rename isn't enough.
    """
    quiz = service.rename_quiz(quiz_id, current_user.id, data.title)
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    return _quiz_with_questions_response(quiz, service.db)


@router.post("/{quiz_id}/submit", response_model=QuizResultResponse)
async def submit_quiz(
    quiz_id: UUID,
    data: QuizSubmit,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Submit quiz answers and get results.
    """
    result = service.submit_quiz(quiz_id, current_user.id, data)
    return _result_to_response(result)


@router.get("/history/results", response_model=QuizResultListResponse)
async def get_quiz_history(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Get quiz history for the current user.

    Must be registered before `/{quiz_id}/results` so "history" isn't parsed
    as a quiz id (same reasoning as `/full` above).
    """
    results, total = service.get_quiz_results_by_user(
        current_user.id, None, limit, offset
    )
    return QuizResultListResponse(
        total=total,
        results=[_result_to_response(r) for r in results]
    )


@router.get("/{quiz_id}/results", response_model=QuizResultListResponse)
async def get_quiz_results(
    quiz_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Get all results for a specific quiz.
    """
    # Verify quiz ownership
    quiz = service.get_quiz_by_id(quiz_id, current_user.id)
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )

    results, total = service.get_quiz_results_by_user(
        current_user.id, quiz_id, limit, offset
    )
    return QuizResultListResponse(
        total=total,
        results=[_result_to_response(r) for r in results]
    )


@router.get("/suggested-topics/", response_model=SuggestedTopicsResponse)
async def get_suggested_topics(
    subject_id: UUID,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service),
):
    """AI-detect the main topics covered by a subject's READY documents."""
    topics = await service.suggest_topics_for_subject(current_user.id, subject_id)
    return SuggestedTopicsResponse(subject_id=subject_id, topics=topics)


@router.get("/known-topics/", response_model=SuggestedTopicsResponse)
async def get_known_topics(
    subject_id: UUID,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service),
):
    """Custom topics ("Chủ đề khác…") proven valid before - at least one
    AI-verified question already exists for them in this subject's shared
    bank. Offered as quick picks for the next "Tạo Quiz", independent of Lộ
    trình (per-document topics)."""
    topics = service.get_known_topics(subject_id, current_user.id)
    return SuggestedTopicsResponse(subject_id=subject_id, topics=topics)


@router.post("/create-next", response_model=QuizWithQuestionsResponse, status_code=status.HTTP_201_CREATED)
async def create_next_quiz(
    data: QuizCreateNext,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service),
):
    """Create the next subject quiz from the shared bank + verified AI.

    A new quiz differs from the user's recent ones: questions already used in
    that subject's recent quizzes are excluded (a little overlap is allowed
    only when the pool is short). AI-generated questions are verified to belong
    to the subject before they are used and added to the shared bank.
    """
    quiz = await service.create_next_quiz(
        current_user.id,
        data.subject_id,
        data.topic,
        data.all_knowledge,
        data.num_questions,
        data.difficulty,
        document_id=data.document_id,
    )
    return _quiz_with_questions_response(quiz, service.db)


@router.get("/{quiz_id}/due-questions", response_model=QuizWithQuestionsResponse)
async def get_due_questions(
    quiz_id: UUID,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Read-only: this quiz's own questions whose review date has come due (see
    QuizService.REVIEW_SCHEDULE). Does NOT create anything - submit the
    answers back to POST /{quiz_id}/submit with `question_ids` set to just
    this subset.
    """
    quiz, due_questions = service.get_due_questions(current_user.id, quiz_id)
    return _quiz_with_questions_response(quiz, service.db, due_questions)


@router.get("/results/{result_id}/wrong-questions", response_model=QuizWithQuestionsResponse)
async def get_wrong_questions(
    result_id: UUID,
    current_user: User = Depends(get_current_user),
    service: QuizService = Depends(get_quiz_service)
):
    """
    Read-only: the ORIGINAL quiz of this result, with just the questions the
    user failed in it. Does NOT create anything - same submit-back contract
    as /{quiz_id}/due-questions above.
    """
    quiz, wrong_questions = service.get_wrong_questions(current_user.id, result_id)
    return _quiz_with_questions_response(quiz, service.db, wrong_questions)
