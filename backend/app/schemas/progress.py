from pydantic import BaseModel
from typing import List


class DashboardResponse(BaseModel):
    total_subjects: int
    total_quizzes: int
    total_questions_answered: int
    avg_score: float
    recent_quizzes: List[dict]
