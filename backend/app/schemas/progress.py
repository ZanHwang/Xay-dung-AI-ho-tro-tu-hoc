from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID


class ResultRow(BaseModel):
    """One quiz submission, as listed on Hôm nay and the "Sổ điểm" page."""
    id: UUID
    quiz_id: UUID
    title: Optional[str] = None
    subject_id: Optional[UUID] = None
    score: float
    correct_count: int
    total_questions: int
    # Only part of the quiz was answered (due-review or retry-wrong session).
    partial: bool = False
    created_at: datetime


class DashboardResponse(BaseModel):
    total_subjects: int
    total_quizzes: int
    total_questions_answered: int
    avg_score: float
    recent_quizzes: List[ResultRow]


class ResultListResponse(BaseModel):
    total: int
    results: List[ResultRow]
