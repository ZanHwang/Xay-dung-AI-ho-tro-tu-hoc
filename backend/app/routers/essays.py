"""Essay (bài tự luận) grading by barem, ported from tu-hoc-rag-v2."""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.essay import (
    EssayGradeIn, EssayGradeOut, EssayOut, EssayListOut,
)
from app.services.essay_service import EssayService
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


def get_essay_service(db: Session = Depends(get_db)) -> EssayService:
    return EssayService(db)


@router.post("/grade", response_model=EssayGradeOut)
async def grade_essay(
    data: EssayGradeIn,
    current_user: User = Depends(get_current_user),
    service: EssayService = Depends(get_essay_service),
):
    """Grade a single essay against a barem (AI, 60% fallback when the LLM
    cannot produce valid JSON). +50 XP + streak touch (v2 rules)."""
    return await service.grade_essay(
        user_id=current_user.id,
        subject_id=data.subject_id,
        class_id=data.class_id,
        prompt=data.prompt,
        rubric=data.rubric,
        essay_text=data.essay,
    )


@router.get("/", response_model=EssayListOut)
def list_essays(
    current_user: User = Depends(get_current_user),
    service: EssayService = Depends(get_essay_service),
):
    """The user's graded essays, newest first."""
    rows = service.list_for_user(current_user.id)
    return EssayListOut(total=len(rows), essays=[EssayOut(**r) for r in rows])
