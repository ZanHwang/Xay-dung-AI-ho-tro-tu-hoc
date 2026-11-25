from pydantic import BaseModel
from uuid import UUID
from datetime import date


class ReviewDueQuestion(BaseModel):
    question_id: UUID
    question_text: str
    options: str  # JSON array of choice strings (quiz_questions.options)
    due_date: date
    interval_days: int


class ReviewDueResponse(BaseModel):
    total: int
    questions: list
