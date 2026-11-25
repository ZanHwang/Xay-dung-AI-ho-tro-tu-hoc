import uuid
from datetime import datetime
from sqlalchemy import Column, Float, DateTime, ForeignKey, Integer, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class QuizResult(Base):
    __tablename__ = "quiz_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    quiz_id = Column(UUID(as_uuid=True), ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    score = Column(Float, nullable=False)  # Percentage 0-100
    total_questions = Column(Integer, nullable=False)
    correct_count = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="quiz_results")
    quiz = relationship("Quiz", back_populates="results")
    answers = relationship("QuizAnswer", back_populates="quiz_result", cascade="all, delete-orphan")


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quiz_result_id = Column(UUID(as_uuid=True), ForeignKey("quiz_results.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(UUID(as_uuid=True), ForeignKey("quiz_questions.id", ondelete="CASCADE"), nullable=False)
    selected_answer = Column(Integer, nullable=True)  # Index of selected option
    is_correct = Column(Boolean, nullable=False)
    time_spent = Column(Integer, nullable=True)  # seconds
    used_hint = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    quiz_result = relationship("QuizResult", back_populates="answers")
    question = relationship("QuizQuestion", back_populates="answers")
