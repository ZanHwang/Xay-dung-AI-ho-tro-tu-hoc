from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from app.models.quiz import QuizDifficulty


class QuizBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    difficulty: QuizDifficulty = QuizDifficulty.MEDIUM


class QuizCreate(BaseModel):
    subject_id: UUID
    document_id: Optional[UUID] = None
    # BƯỚC 6: "quiz từ file" - generate questions from these documents via RAG.
    # When set, takes priority over document_id; use all ready subject docs
    # for a whole-subject quiz, or a single id for one specific file.
    document_ids: Optional[List[UUID]] = None
    num_questions: int = Field(default=10, ge=1, le=50)
    difficulty: QuizDifficulty = QuizDifficulty.MEDIUM


class QuizQuestionBase(BaseModel):
    question_text: str
    options: List[str]
    correct_answer: int
    explanation: Optional[str] = None
    # This question's own topic (see QuizQuestion.topic) - lets the frontend
    # offer "Xem lại kiến thức" on a wrong answer even inside a mixed-topic
    # ("Tổng hợp") quiz. None when no topic could be attributed.
    topic: Optional[str] = None


class QuizQuestionCreate(QuizQuestionBase):
    pass


class QuizQuestionResponse(QuizQuestionBase):
    id: UUID
    quiz_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class QuizResponse(QuizBase):
    id: UUID
    user_id: UUID
    subject_id: Optional[UUID] = None
    document_id: Optional[UUID] = None
    source: Optional[str] = None  # llm | document | wrong
    created_at: datetime
    total_questions: Optional[int] = None

    class Config:
        from_attributes = True


class QuizWithQuestionsResponse(QuizResponse):
    questions: List[QuizQuestionResponse] = []

    class Config:
        from_attributes = True


class QuizListResponse(BaseModel):
    total: int
    quizzes: List[QuizResponse]


class QuizWithQuestionsListResponse(BaseModel):
    total: int
    quizzes: List[QuizWithQuestionsResponse]


class QuizAnswer(BaseModel):
    question_id: UUID
    selected_answer: int


class QuizSubmit(BaseModel):
    answers: List[QuizAnswer]
    time_spent: Optional[int] = None  # Total time in seconds


class QuizAnswerResponse(BaseModel):
    question_id: UUID
    selected_answer: Optional[int]
    is_correct: bool
    correct_answer: int
    explanation: Optional[str] = None
    time_spent: Optional[int] = None
    used_hint: bool = False

    class Config:
        from_attributes = True


class QuizResultResponse(BaseModel):
    id: UUID
    quiz_id: UUID
    score: float
    total_questions: int
    correct_count: int
    created_at: datetime
    answers: List[QuizAnswerResponse] = []

    class Config:
        from_attributes = True


class QuizResultListResponse(BaseModel):
    total: int
    results: List[QuizResultResponse]


class QuizGenerateResponse(BaseModel):
    quiz: QuizWithQuestionsResponse
    message: str = "Quiz created successfully"


# ---------------------------------------------------------------------------
# Simple subject-scoped quiz: shared bank + verified AI + dedup
# ---------------------------------------------------------------------------

class QuizCreateNext(BaseModel):
    subject_id: UUID
    topic: Optional[str] = None
    all_knowledge: bool = False
    num_questions: int = Field(default=5, ge=1, le=50)
    difficulty: QuizDifficulty = QuizDifficulty.MEDIUM
    # Set when `topic` was picked from one specific document's own topic
    # chip group (see quiz-create-dialog.tsx) - narrows RAG context to that
    # document and records Quiz.document_id so Lộ trình can track progress.
    document_id: Optional[UUID] = None


class SuggestedTopicsResponse(BaseModel):
    subject_id: UUID
    topics: List[str] = []
