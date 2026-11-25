from pydantic import BaseModel, Field
from typing import Any, List, Optional
from uuid import UUID
from datetime import datetime


class EssayGradeIn(BaseModel):
    """Submit an essay for AI grading against a barem (rubric)."""
    prompt: str = Field(..., min_length=1)
    # [{criterion, max}] or a multi-line string ("Ý 1 - 2đ\\nÝ 2 - 3đ").
    rubric: Any
    essay: str = Field(..., min_length=1)
    subject_id: Optional[UUID] = None
    class_id: Optional[UUID] = None


class EssayScoreOut(BaseModel):
    criterion: str
    score: float
    max: float
    quote: str = ""
    feedback: str = ""


class EssayGradeOut(BaseModel):
    essay_id: UUID
    scores: List[EssayScoreOut]
    total: float
    max_total: float
    overall: str
    mode: str  # llm | fallback


class EssayOut(BaseModel):
    id: UUID
    subject_id: Optional[UUID] = None
    class_id: Optional[UUID] = None
    prompt: str
    rubric: Any
    essay: str
    total: Optional[float] = None
    max_total: Optional[float] = None
    feedback: Any = None
    status: str
    created_at: datetime


class EssayListOut(BaseModel):
    total: int
    essays: List[EssayOut]


class BatchGradeIn(BaseModel):
    """Teacher: grade every PENDING essay in a class with one barem + prompt."""
    prompt: str
    rubric: Any


class BatchGradeOut(BaseModel):
    graded: int
    total: int
    average: float


class PendingEssayOut(BaseModel):
    id: UUID
    student: str
    prompt: str
    essay: str
    status: str
    created_at: datetime


class PendingListOut(BaseModel):
    total: int
    essays: List[PendingEssayOut]
