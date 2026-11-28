from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.models.exam import ExamSubmission
from app.schemas.exam import AssignmentIn, AssignmentOut, AssignmentSummary, FinalizeIn, SubmissionOut, SubmissionSummary
from app.services.exam_service import ExamService
from app.services.exam_uploads import collect_uploads
from app.utils.security import get_current_user

router = APIRouter()


class RegradeIn(BaseModel):
    revision: int = Field(ge=1)


def get_exam_service(
    db: Session = Depends(get_db), _user: User = Depends(get_current_user),
) -> ExamService:
    if not inspect(db.connection()).has_table(ExamSubmission.__tablename__):
        raise HTTPException(503, "Chưa cài đặt schema chấm bài thi trên cơ sở dữ liệu này.")
    return ExamService(db)


@router.get("/exams/history", response_model=list[SubmissionSummary])
def history(user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service)):
    return service.personal_history(user)


@router.post("/exams/submissions", response_model=SubmissionOut, status_code=201)
async def submit_personal(
    exam_files: list[UploadFile] = File(...),
    answer_files: list[UploadFile] = File(...),
    official_files: list[UploadFile] = File(default_factory=list),
    user: User = Depends(get_current_user),
    service: ExamService = Depends(get_exam_service),
):
    uploads, pages = await collect_uploads({
        "exam": exam_files, "answer": answer_files, "official": official_files,
    })
    return await service.submit(user, uploads, pages)


@router.get("/exams/submissions/{submission_id}", response_model=SubmissionOut)
def submission(
    submission_id: UUID, user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return service.submission(submission_id, user)


@router.post("/exams/submissions/{submission_id}/regrade", response_model=SubmissionOut)
async def regrade_personal(
    submission_id: UUID, data: RegradeIn,
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return await service.regrade_personal(submission_id, user, data.revision)


@router.get("/exams/submissions/{submission_id}/files/{file_id}")
def submission_file(
    submission_id: UUID, file_id: UUID,
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    file = service.file(submission_id, file_id, user)
    return Response(file.content, media_type=file.media_type, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(file.name, safe='')}",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })


assignments = "/classes/{class_id}/assignments"


@router.get(assignments, response_model=list[AssignmentSummary])
def list_assignments(
    class_id: UUID, user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return service.list_assignments(class_id, user)


@router.post(assignments, response_model=AssignmentOut, status_code=201)
def create_assignment(
    class_id: UUID, data: AssignmentIn,
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return service.create_assignment(class_id, user, data)


@router.get(assignments + "/{assignment_id}", response_model=AssignmentOut)
def assignment_detail(
    class_id: UUID, assignment_id: UUID,
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return service.assignment(class_id, assignment_id, user)


@router.get(assignments + "/{assignment_id}/submissions", response_model=list[SubmissionSummary])
def classroom_submissions(
    class_id: UUID, assignment_id: UUID,
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return service.classroom_submissions(class_id, assignment_id, user)


@router.post(assignments + "/{assignment_id}/submissions", response_model=SubmissionOut, status_code=201)
async def submit_classwork(
    class_id: UUID, assignment_id: UUID, answer_files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    assignment = service.assignment_for_submission(class_id, assignment_id, user)
    uploads, pages = await collect_uploads({"answer": answer_files})
    return await service.submit(user, uploads, pages, assignment)


@router.post(assignments + "/{assignment_id}/submissions/{submission_id}/regrade", response_model=SubmissionOut)
async def regrade(
    class_id: UUID, assignment_id: UUID, submission_id: UUID, data: RegradeIn,
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return await service.regrade(class_id, assignment_id, submission_id, user, data.revision)


@router.post(assignments + "/{assignment_id}/submissions/{submission_id}/finalize", response_model=SubmissionOut)
def finalize(
    class_id: UUID, assignment_id: UUID, submission_id: UUID, data: FinalizeIn,
    user: User = Depends(get_current_user), service: ExamService = Depends(get_exam_service),
):
    return service.finalize(class_id, assignment_id, submission_id, user, data)
