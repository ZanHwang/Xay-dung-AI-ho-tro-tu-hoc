from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.progress import DashboardResponse, ResultListResponse
from app.schemas.review import DueQuizzesResponse, DueQuizSummary
from app.services.progress_service import ProgressService
from app.utils.security import get_current_user
from app.utils.dates import now_hcm
from app.models import User, Review, QuizQuestion, Quiz

router = APIRouter()


def get_progress_service(db: Session = Depends(get_db)) -> ProgressService:
    return ProgressService(db)


@router.get("/reviews/due-quizzes", response_model=DueQuizzesResponse)
def reviews_due_quizzes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Spaced-repetition: quizzes that currently have at least one due question,
    grouped with a count each (correct -> advance a stage, wrong -> back to
    stage 0 - see QuizService.REVIEW_SCHEDULE). The dashboard card / header
    bell open a list built from this, picking one quiz reviews just its own
    due questions (see GET /quizzes/{quiz_id}/due-questions).
    """
    rows = (
        db.query(
            Quiz.id, Quiz.title, Quiz.subject_id,
            func.count(Review.id), func.min(Review.next_review)
        )
        .join(QuizQuestion, QuizQuestion.quiz_id == Quiz.id)
        .join(Review, Review.question_id == QuizQuestion.id)
        .filter(Review.user_id == current_user.id, Review.next_review <= now_hcm())
        .group_by(Quiz.id, Quiz.title, Quiz.subject_id)
        .order_by(func.min(Review.next_review))
        .all()
    )
    quizzes = [
        DueQuizSummary(quiz_id=r[0], title=r[1], subject_id=r[2], due_count=r[3])
        for r in rows
    ]
    return DueQuizzesResponse(total=sum(item.due_count for item in quizzes), quizzes=quizzes)


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    service: ProgressService = Depends(get_progress_service)
):
    """
    Get dashboard data for the current user.
    """
    data = service.get_dashboard_data(current_user.id)
    return DashboardResponse(**data)


@router.get("/results", response_model=ResultListResponse)
def get_results(
    subject_id: Optional[UUID] = Query(None, description="Only this subject's quizzes"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: ProgressService = Depends(get_progress_service),
):
    """Every quiz submission of the current user, newest first ("Sổ điểm")."""
    total, results = service.get_results(current_user.id, subject_id, limit, offset)
    return ResultListResponse(total=total, results=results)
