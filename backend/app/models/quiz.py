import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class QuizDifficulty(str, enum.Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Nullable: a review quiz ("Ôn câu đến hạn") can pull due questions from
    # several subjects at once, so it isn't scoped to just one.
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    difficulty = Column(Enum(QuizDifficulty), default=QuizDifficulty.MEDIUM)
    # Where the quiz's questions came from: "llm" (topic knowledge),
    # "document" (RAG from files), "weakness" (review of weak topics) or
    # "wrong" (retry of previously failed questions). Nullable - old rows
    # predate this column.
    source = Column(String(20), nullable=True, default="llm")
    # Exact topic string this quiz was scoped to at creation (one of the
    # subject's suggested_topics, or NULL for "all knowledge"/non-topic-scoped
    # quizzes) - used to compute per-topic progress for the Lộ trình feature.
    topic = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User")
    subject = relationship("Subject", back_populates="quizzes")
    document = relationship("Document")
    questions = relationship("QuizQuestion", back_populates="quiz", cascade="all, delete-orphan")
    results = relationship("QuizResult", back_populates="quiz", cascade="all, delete-orphan")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quiz_id = Column(UUID(as_uuid=True), ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    options = Column(Text, nullable=False)  # JSON array of options
    correct_answer = Column(Integer, nullable=False)  # Index of correct option
    explanation = Column(Text, nullable=True)
    # This question's own topic (one of the subject's suggested_topics, or
    # NULL). Copied from the SharedQuizQuestion it came from, or AI-classified
    # for freshly-generated "Tổng hợp" (all-knowledge) questions - see
    # QuizService.create_next_quiz. Lets per-question wrong answers (and the
    # existing Review spaced-repetition schedule) be attributed to a topic
    # even inside a mixed-topic quiz, unlike Quiz.topic which is only set for
    # single-topic quizzes.
    topic = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    quiz = relationship("Quiz", back_populates="questions")
    answers = relationship("QuizAnswer", back_populates="question", cascade="all, delete-orphan")
