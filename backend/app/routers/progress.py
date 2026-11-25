from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.progress import DashboardResponse
from app.schemas.review import ReviewDueResponse
from app.services.progress_service import ProgressService
from app.utils.security import get_current_user
from app.utils.dates import today_hcm
from app.models import User, Review, QuizQuestion

router = APIRouter()


def get_progress_service(db: Session = Depends(get_db)) -> ProgressService:
    return ProgressService(db)


@router.get("/reviews/due", response_model=ReviewDueResponse)
def reviews_due(
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Spaced-repetition: quiz questions whose review date has come due
    (correct -> +3 days, wrong -> +1 day after answering). The dashboard's
    'Học tiếp' card pulls from here.
    """
    rows = (
        db.query(Review, QuizQuestion)
        .join(QuizQuestion, QuizQuestion.id == Review.question_id)
        .filter(
            Review.user_id == current_user.id,
            Review.next_review <= today_hcm(),
        )
        .order_by(Review.next_review)
        .limit(limit)
        .all()
    )
    questions = [
        {
            "question_id": r.question_id,
            "question_text": q.question_text,
            "options": q.options,
            "due_date": r.next_review,
            "interval_days": r.interval_days,
        }
        for r, q in rows
    ]
    return ReviewDueResponse(total=len(questions), questions=questions)


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
