from pydantic import BaseModel
from uuid import UUID
from typing import List, Optional


class DueQuizSummary(BaseModel):
    quiz_id: UUID
    title: str
    subject_id: Optional[UUID] = None
    due_count: int


class DueQuizzesResponse(BaseModel):
    total: int
    quizzes: List[DueQuizSummary]
