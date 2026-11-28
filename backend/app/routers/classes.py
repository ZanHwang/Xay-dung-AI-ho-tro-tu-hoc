"""Classes (lớp học), ported from tu-hoc-rag-v2.

Teacher-only writes (create class, batch-grade) are guarded on
`user.role == "teacher"`. Students join by code.
"""
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.class_room import ClassCreate, ClassJoin, ClassOut, ClassMemberOut
from app.schemas.essay import BatchGradeIn, BatchGradeOut, PendingEssayOut, PendingListOut
from app.services.classes_service import ClassService
from app.services.essay_service import EssayService
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


def get_class_service(db: Session = Depends(get_db)) -> ClassService:
    return ClassService(db)


def get_essay_service(db: Session = Depends(get_db)) -> EssayService:
    return EssayService(db)


@router.get("/", response_model=list[ClassOut])
def list_classes(
    current_user: User = Depends(get_current_user),
    service: ClassService = Depends(get_class_service),
):
    """Classes the user teaches OR is enrolled in."""
    return service.list_classes(current_user.id, current_user)


@router.post("/", response_model=ClassOut, status_code=201)
def create_class(
    data: ClassCreate,
    current_user: User = Depends(get_current_user),
    service: ClassService = Depends(get_class_service),
):
    """Create a class (teacher only) + auto-enroll the teacher."""
    return service.create_class(current_user, data.name)


@router.post("/join", response_model=ClassOut)
def join_class(
    data: ClassJoin,
    current_user: User = Depends(get_current_user),
    service: ClassService = Depends(get_class_service),
):
    """Join a class by its 6-char code (students; teachers may too)."""
    return service.join_class(current_user.id, data.code)


@router.get("/{class_id}/members", response_model=list[ClassMemberOut])
def class_members(
    class_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ClassService = Depends(get_class_service),
):
    service.require_owner(class_id, current_user)
    return service.members(class_id)


@router.get("/{class_id}/essays/pending", response_model=PendingListOut)
def pending_essays(
    class_id: UUID,
    current_user: User = Depends(get_current_user),
    service: EssayService = Depends(get_essay_service),
    classes: ClassService = Depends(get_class_service),
):
    """Pending (ungraded) essays in a class, tagged with the student's name."""
    classes.require_owner(class_id, current_user)
    rows = service.pending_for_class(class_id)
    return PendingListOut(total=len(rows), essays=[PendingEssayOut(**r) for r in rows])


@router.post("/{class_id}/essays/grade-batch", response_model=BatchGradeOut)
async def grade_batch(
    class_id: UUID,
    data: BatchGradeIn,
    current_user: User = Depends(get_current_user),
    service: EssayService = Depends(get_essay_service),
    classes: ClassService = Depends(get_class_service),
):
    """Teacher: grade every pending essay in a class with one prompt + barem."""
    classes.require_owner(class_id, current_user)
    return await service.grade_batch(current_user.id, class_id, data.prompt, data.rubric)
