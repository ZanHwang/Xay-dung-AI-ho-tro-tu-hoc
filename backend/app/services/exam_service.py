from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from pydantic import TypeAdapter
from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.models import User
from app.models.exam import ExamAssignment, ExamFile, ExamSubmission
from app.schemas.exam import (
    AnalysisOut, AssignmentIn, AssignmentOut, AssignmentSummary, FileOut, FinalizeIn,
    OfficialOut, PageReading, Question, SubmissionOut, SubmissionSummary, TeacherQuestion,
)
from app.services.classes_service import ClassService
from app.services.exam_grading import analyze_submission, recoverable_choice_marks
from app.services.exam_uploads import ExamPage, ExamUpload, render_uploads

assignment_questions = TypeAdapter(list[TeacherQuestion])


class ExamService:
    def __init__(self, db: Session):
        self.db = db
        self.classes = ClassService(db)

    def _assignment(self, class_id: UUID, assignment_id: UUID) -> ExamAssignment:
        assignment = self.db.get(ExamAssignment, assignment_id)
        if assignment is None or assignment.class_id != class_id:
            raise HTTPException(404, "Không tìm thấy đề thi trong lớp.")
        return assignment

    def _assignment_summary(self, row: ExamAssignment, **extra) -> AssignmentSummary:
        questions = assignment_questions.validate_json(row.questions)
        return AssignmentSummary(
            id=row.id, title=row.title, created_at=row.created_at, question_count=len(questions),
            max_total=sum(q.max_points for q in questions), **extra,
        )

    def list_assignments(self, class_id: UUID, user: User) -> list[AssignmentSummary]:
        room = self.classes.require_member(class_id, user)
        assignments = self.db.query(ExamAssignment).filter_by(class_id=class_id)
        ids = assignments.with_entities(ExamAssignment.id)
        submissions = self.db.query(ExamSubmission).filter(ExamSubmission.assignment_id.in_(ids.statement))
        if user.role == "teacher" and room.teacher_id == user.id:
            counts = dict(submissions.with_entities(
                ExamSubmission.assignment_id, func.count(ExamSubmission.id),
            ).group_by(ExamSubmission.assignment_id).all())
            extra = {assignment_id: {"submission_count": count} for assignment_id, count in counts.items()}
            default = {"submission_count": 0}
        else:
            own = submissions.filter_by(user_id=user.id).with_entities(ExamSubmission.assignment_id, ExamSubmission.id)
            extra = {assignment_id: {"submission_id": submission_id} for assignment_id, submission_id in own}
            default = {}
        return [
            self._assignment_summary(row, **extra.get(row.id, default))
            for row in assignments.order_by(ExamAssignment.created_at.desc(), ExamAssignment.id)
        ]

    def create_assignment(self, class_id: UUID, user: User, data: AssignmentIn) -> AssignmentOut:
        self.classes.require_owner(class_id, user)
        row = ExamAssignment(
            class_id=class_id, title=data.title,
            questions=assignment_questions.dump_json(data.questions).decode(),
        )
        self.db.add(row)
        self.db.commit()
        return AssignmentOut(**self._assignment_summary(row, submission_count=0).model_dump(), questions=data.questions)

    def assignment(self, class_id: UUID, assignment_id: UUID, user: User) -> AssignmentOut:
        room = self.classes.require_member(class_id, user)
        row = self._assignment(class_id, assignment_id)
        questions = assignment_questions.validate_json(row.questions)
        if user.role != "teacher" or room.teacher_id != user.id:
            questions = [Question.model_validate(q.model_dump()) for q in questions]
        return AssignmentOut(**self._assignment_summary(row).model_dump(), questions=questions)

    def assignment_for_submission(self, class_id: UUID, assignment_id: UUID, user: User) -> ExamAssignment:
        if user.role != "student":
            raise HTTPException(403, "Chỉ học sinh trong lớp mới có thể nộp bài.")
        self.classes.require_member(class_id, user)
        row = self._assignment(class_id, assignment_id)
        if self.db.query(ExamSubmission.id).filter_by(assignment_id=row.id, user_id=user.id).first():
            raise HTTPException(409, "Bạn đã nộp bài cho đề này.")
        return row

    async def submit(
        self, user: User, uploads: list[ExamUpload], pages: list[ExamPage],
        assignment: ExamAssignment | None = None,
    ) -> SubmissionOut:
        user_id = user.id
        assignment_id, title, questions = None, "Bài thi cá nhân", None
        if assignment is not None:
            assignment_id, title = assignment.id, assignment.title
            questions = assignment_questions.validate_json(assignment.questions)
        self.db.rollback()
        analysis = await analyze_submission(pages, questions)
        row = ExamSubmission(
            user_id=user_id, assignment_id=assignment_id, title=title, analysis=analysis.model_dump_json(),
        )
        self.db.add(row)
        try:
            self.db.flush()
            for position, upload in enumerate(uploads):
                self.db.add(ExamFile(
                    submission_id=row.id, position=position, role=upload.role, name=upload.name,
                    media_type=upload.media_type, content=upload.content,
                ))
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            if assignment_id and self.db.query(ExamSubmission.id).filter_by(
                assignment_id=assignment_id, user_id=user_id,
            ).first():
                raise HTTPException(409, "Bạn đã nộp bài cho đề này.") from None
            raise
        return self._detail(row, show_grading=assignment_id is None)

    def personal_history(self, user: User) -> list[SubmissionSummary]:
        rows = self.db.query(ExamSubmission).filter_by(user_id=user.id, assignment_id=None)
        return [self._summary(row) for row in rows.order_by(ExamSubmission.created_at.desc(), ExamSubmission.id)]

    def classroom_submissions(self, class_id: UUID, assignment_id: UUID, user: User) -> list[SubmissionSummary]:
        self.classes.require_owner(class_id, user)
        self._assignment(class_id, assignment_id)
        rows = (
            self.db.query(ExamSubmission, User.full_name)
            .join(User, User.id == ExamSubmission.user_id)
            .filter(ExamSubmission.assignment_id == assignment_id)
            .order_by(ExamSubmission.created_at.desc(), ExamSubmission.id)
        )
        return [self._summary(row, student_name=name) for row, name in rows]

    def _summary(self, row: ExamSubmission, analysis=None, official=None, student_name=None) -> SubmissionSummary:
        if analysis is None:
            analysis = AnalysisOut.model_validate_json(row.analysis)
        if official is None and row.official:
            official = OfficialOut.model_validate_json(row.official)
        return SubmissionSummary(
            id=row.id, title=row.title, state="finalized" if official else analysis.state,
            kind=analysis.kind, ai_total=analysis.total, max_total=analysis.max_total,
            official_total=official.total if official else None, created_at=row.created_at, student_name=student_name,
        )

    def _detail(self, row: ExamSubmission, *, show_grading: bool) -> SubmissionOut:
        analysis = AnalysisOut.model_validate_json(row.analysis)
        official = OfficialOut.model_validate_json(row.official) if row.official else None
        files = self.db.query(ExamFile.id, ExamFile.role, ExamFile.name, ExamFile.media_type).filter(
            ExamFile.submission_id == row.id,
        ).order_by(ExamFile.position)
        if not show_grading:
            analysis.grades = []
            analysis.pages = []
        return SubmissionOut(
            **self._summary(row, analysis, official).model_dump(),
            revision=row.revision, analysis=analysis, official=official,
            files=[FileOut(id=file.id, role=file.role, name=file.name, media_type=file.media_type) for file in files],
        )

    def _get_submission(self, submission_id: UUID, user: User) -> tuple[ExamSubmission, bool]:
        row = self.db.get(ExamSubmission, submission_id)
        if row is None:
            raise HTTPException(404, "Không tìm thấy bài nộp.")
        if row.assignment_id is None:
            if row.user_id != user.id:
                raise HTTPException(404, "Không tìm thấy bài nộp.")
            return row, True
        assignment = self.db.get(ExamAssignment, row.assignment_id)
        if row.user_id == user.id:
            self.classes.require_member(assignment.class_id, user)
            return row, False
        self.classes.require_owner(assignment.class_id, user)
        return row, True

    def submission(self, submission_id: UUID, user: User) -> SubmissionOut:
        row, show_grading = self._get_submission(submission_id, user)
        return self._detail(row, show_grading=show_grading)

    def file(self, submission_id: UUID, file_id: UUID, user: User) -> ExamFile:
        row, _ = self._get_submission(submission_id, user)
        file = self.db.query(ExamFile).filter_by(id=file_id, submission_id=row.id).first()
        if file is None:
            raise HTTPException(404, "Không tìm thấy tệp của bài nộp.")
        return file

    def _assigned_submission(
        self, class_id: UUID, assignment_id: UUID, submission_id: UUID, user: User,
    ) -> tuple[ExamSubmission, ExamAssignment]:
        self.classes.require_owner(class_id, user)
        assignment = self._assignment(class_id, assignment_id)
        row = self.db.query(ExamSubmission).filter_by(id=submission_id, assignment_id=assignment.id).first()
        if row is None:
            raise HTTPException(404, "Không tìm thấy bài nộp của đề này.")
        if row.official:
            raise HTTPException(409, "Điểm chính thức đã được chốt.")
        return row, assignment

    def _update_result(self, submission_id: UUID, revision: int, **changes) -> SubmissionOut:
        effect = self.db.execute(
            update(ExamSubmission).where(
                ExamSubmission.id == submission_id, ExamSubmission.revision == revision,
                ExamSubmission.official.is_(None),
            ).values(revision=revision + 1, **changes)
        )
        if effect.rowcount != 1:
            self.db.rollback()
            raise HTTPException(409, "Bài nộp đã thay đổi. Hãy mở lại trước khi tiếp tục.")
        self.db.commit()
        return self._detail(self.db.get(ExamSubmission, submission_id), show_grading=True)

    async def regrade(
        self, class_id: UUID, assignment_id: UUID, submission_id: UUID, user: User, revision: int,
    ) -> SubmissionOut:
        row, assignment = self._assigned_submission(class_id, assignment_id, submission_id, user)
        return await self._regrade(row, revision, assignment_questions.validate_json(assignment.questions))

    async def regrade_personal(self, submission_id: UUID, user: User, revision: int) -> SubmissionOut:
        row = self.db.query(ExamSubmission).filter_by(id=submission_id, user_id=user.id, assignment_id=None).first()
        if row is None:
            raise HTTPException(404, "Không tìm thấy bài thi cá nhân.")
        previous = AnalysisOut.model_validate_json(row.analysis)
        if previous.state != "needs_review":
            raise HTTPException(409, "Bài thi đã có điểm.")
        roles = {page.role for page in previous.pages if page.readable}
        can_reuse = {"exam", "answer"} <= roles and all(page.readable for page in previous.pages)
        if not can_reuse and not previous.review_items:
            can_reuse = bool(recoverable_choice_marks(previous.pages))
        return await self._regrade(row, revision, page_readings=previous.pages if can_reuse else None)

    async def _regrade(
        self, row: ExamSubmission, revision: int, questions: list[TeacherQuestion] | None = None,
        *, page_readings: list[PageReading] | None = None,
    ) -> SubmissionOut:
        if row.revision != revision:
            raise HTTPException(409, "Bài nộp đã thay đổi. Hãy mở lại trước khi tiếp tục.")
        submission_id = row.id
        uploads = []
        if page_readings is None:
            uploads = [
                ExamUpload(file.role, file.name, file.media_type, file.content)
                for file in self.db.query(ExamFile).filter_by(submission_id=submission_id).order_by(ExamFile.position)
            ]
        self.db.rollback()
        pages = await run_in_threadpool(render_uploads, uploads) if uploads else []
        analysis = await analyze_submission(pages, questions, page_readings=page_readings)
        return self._update_result(submission_id, revision, analysis=analysis.model_dump_json())

    def finalize(
        self, class_id: UUID, assignment_id: UUID, submission_id: UUID, user: User, data: FinalizeIn,
    ) -> SubmissionOut:
        _, assignment = self._assigned_submission(class_id, assignment_id, submission_id, user)
        questions = assignment_questions.validate_json(assignment.questions)
        scores = {item.id: item for item in data.scores}
        if scores.keys() != {q.id for q in questions} or len(scores) != len(data.scores):
            raise HTTPException(422, "Cần nhập đúng một điểm cho mỗi câu của đề thi.")
        if any(scores[q.id].points > q.max_points for q in questions):
            raise HTTPException(422, "Điểm một câu không được vượt điểm tối đa trong đề.")
        official = OfficialOut(
            total=sum(item.points for item in data.scores), scores=[scores[q.id] for q in questions],
            comment=data.comment.strip(), finalized_at=datetime.utcnow(),
        )
        return self._update_result(submission_id, data.revision, official=official.model_dump_json())
