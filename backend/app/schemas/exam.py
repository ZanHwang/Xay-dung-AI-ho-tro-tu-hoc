from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

QuestionId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=48)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12000)]
Points = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
PositivePoints = Annotated[Decimal, Field(gt=0, le=100, max_digits=5, decimal_places=2)]
FileRole = Literal["exam", "answer", "official"]


class Criterion(BaseModel):
    label: Text
    max_points: PositivePoints


class QuestionDraft(BaseModel):
    id: QuestionId
    prompt: Text
    max_points: PositivePoints | None = None
    options: dict[str, Text] = Field(default_factory=dict, max_length=12)
    allows_multiple_options: bool = False

    @model_validator(mode="after")
    def check_options(self):
        if self.options and (
            len(self.options) < 2 or any(len(key) != 1 or key not in "ABCDEFGHIJKL" for key in self.options)
        ):
            raise ValueError("Phương án trắc nghiệm phải dùng nhãn A–L.")
        return self


class Question(QuestionDraft):
    max_points: PositivePoints


class GradingKey(BaseModel):
    id: QuestionId
    correct_options: list[str] = Field(default_factory=list, max_length=12)
    rubric: list[Criterion] = Field(default_factory=list, max_length=12)
    solution: Text

    def validate_for(self, question: Question) -> None:
        if question.options:
            correct = set(self.correct_options)
            if not correct or correct - question.options.keys() or len(correct) != len(self.correct_options) or self.rubric:
                raise ValueError(f"Đáp án câu {question.id} không khớp các phương án.")
        elif self.correct_options or sum(item.max_points for item in self.rubric) != question.max_points:
            raise ValueError(f"Tổng barem câu {question.id} phải bằng điểm tối đa.")


class TeacherQuestion(Question):
    correct_options: list[str] = Field(default_factory=list, max_length=12)
    rubric: list[Criterion] = Field(default_factory=list, max_length=12)
    solution: Text

    def grading_key(self) -> GradingKey:
        return GradingKey.model_validate(self.model_dump())

    @model_validator(mode="after")
    def check_key(self):
        self.grading_key().validate_for(self)
        return self


class AssignmentIn(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    questions: list[TeacherQuestion] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_questions(self):
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError("Mỗi câu hỏi cần một mã riêng.")
        return self


class AssignmentSummary(BaseModel):
    id: UUID
    title: str
    question_count: int
    max_total: Decimal
    created_at: datetime
    submission_id: UUID | None = None
    submission_count: int | None = None


class AssignmentOut(AssignmentSummary):
    questions: list[Question | TeacherQuestion]


class RecognizedAnswer(BaseModel):
    id: QuestionId
    status: Literal["answered", "blank", "unreadable"]
    text: str = Field(default="", max_length=16000)
    selected_options: list[str] = Field(default_factory=list, max_length=12)
    evidence: str = Field(default="", max_length=2000)


class ObservedChoice(BaseModel):
    label: QuestionId
    selected_options: list[Literal["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]] = Field(
        max_length=12,
    )
    option_text: dict[str, Text] = Field(default_factory=dict, max_length=12)
    letter_only: bool = False


class PageReading(BaseModel):
    role: FileRole
    file: str
    page: int
    readable: bool
    text: str
    choices: list[ObservedChoice] = Field(default_factory=list, max_length=50)


class CriterionScore(BaseModel):
    label: str
    points: Points
    max_points: PositivePoints
    quote: str = ""
    feedback: str = ""


class QuestionGrade(BaseModel):
    id: QuestionId
    points: Points
    max_points: PositivePoints
    correct_options: list[str] = Field(default_factory=list)
    feedback: str
    correction: str
    source: Literal["teacher", "official", "ai"]
    criteria: list[CriterionScore] = Field(default_factory=list)


class QuestionReview(BaseModel):
    id: QuestionId
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class AnalysisOut(BaseModel):
    state: Literal["graded", "needs_review"] = "needs_review"
    kind: Literal["multiple_choice", "written", "mixed"] | None = None
    reason: str = ""
    max_total: Decimal | None = None
    total: Decimal | None = None
    questions: list[Question] = Field(default_factory=list)
    answers: list[RecognizedAnswer] = Field(default_factory=list)
    pages: list[PageReading] = Field(default_factory=list)
    grades: list[QuestionGrade] = Field(default_factory=list)
    review_items: list[QuestionReview] = Field(default_factory=list)


class FileOut(BaseModel):
    id: UUID
    role: FileRole
    name: str
    media_type: str


class OfficialQuestionScore(BaseModel):
    id: QuestionId
    points: Points


class FinalizeIn(BaseModel):
    revision: int = Field(ge=1)
    scores: list[OfficialQuestionScore] = Field(min_length=1, max_length=50)
    comment: str = Field(default="", max_length=8000)


class OfficialOut(BaseModel):
    total: Decimal
    scores: list[OfficialQuestionScore]
    comment: str
    finalized_at: datetime


class SubmissionSummary(BaseModel):
    id: UUID
    title: str
    state: Literal["graded", "needs_review", "finalized"]
    kind: Literal["multiple_choice", "written", "mixed"] | None
    ai_total: Decimal | None
    max_total: Decimal | None
    official_total: Decimal | None
    created_at: datetime
    student_name: str | None = None


class SubmissionOut(SubmissionSummary):
    revision: int
    analysis: AnalysisOut
    official: OfficialOut | None
    files: list[FileOut]
