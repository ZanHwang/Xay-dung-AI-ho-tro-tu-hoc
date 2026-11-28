from typing import List, Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import and_, case, desc, func
from app.models import Subject, Quiz, QuizQuestion, QuizResult


class ProgressService:
    def __init__(self, db: Session):
        self.db = db

    def _question_counts(self):
        """quiz_id -> number of questions the quiz has. A result that covers
        fewer questions is a due-review / retry-wrong session, not the whole
        quiz."""
        return (
            self.db.query(QuizQuestion.quiz_id, func.count(QuizQuestion.id).label("n"))
            .group_by(QuizQuestion.quiz_id)
            .subquery()
        )

    def _result_rows(self, user_id: UUID, question_counts):
        """One row per submission with the quiz it belongs to."""
        return (
            self.db.query(
                QuizResult.id, QuizResult.quiz_id, Quiz.title, Quiz.subject_id,
                QuizResult.score, QuizResult.correct_count, QuizResult.total_questions,
                QuizResult.created_at, question_counts.c.n,
            )
            .join(Quiz, Quiz.id == QuizResult.quiz_id)
            .outerjoin(question_counts, question_counts.c.quiz_id == QuizResult.quiz_id)
            .filter(QuizResult.user_id == user_id)
        )

    @staticmethod
    def _row(row) -> dict:
        return {
            "id": row.id,
            "quiz_id": row.quiz_id,
            "title": row.title,
            "subject_id": row.subject_id,
            "score": row.score,
            "correct_count": row.correct_count,
            "total_questions": row.total_questions,
            # Answered only part of the quiz: a review of due questions or a
            # retry of the wrong ones.
            "partial": row.n is not None and row.total_questions < row.n,
            "created_at": row.created_at,
        }

    def get_dashboard_data(self, user_id: UUID) -> dict:
        """Get dashboard data for a user."""
        # Count subjects
        total_subjects = (
            self.db.query(Subject)
            .filter(Subject.user_id == user_id)
            .count()
        )

        # One aggregate round trip instead of fetching every QuizResult row
        # just to sum/average/count them in Python - same cost either way
        # for a handful of rows, but scales badly for an account with a long
        # quiz history (the whole table transferred on every dashboard load).
        # Quizzes done / average score count FULL attempts only - a due-review
        # or retry-wrong session answers just a few of a quiz's questions and
        # would otherwise count as a whole quiz (and skew the average).
        # Questions answered still counts every attempt.
        question_counts = self._question_counts()
        is_full = QuizResult.total_questions >= question_counts.c.n
        totals = (
            self.db.query(
                func.coalesce(func.sum(case((is_full, 1), else_=0)), 0),
                func.coalesce(func.sum(QuizResult.total_questions), 0),
                func.coalesce(func.avg(case((is_full, QuizResult.score))), 0),
            )
            .outerjoin(question_counts, question_counts.c.quiz_id == QuizResult.quiz_id)
            .filter(QuizResult.user_id == user_id)
            .one()
        )
        total_quizzes, total_questions, avg_score = totals

        # The 5 quizzes worked on most recently, one row each: its latest
        # submission (so retaking a quiz doesn't fill the whole list).
        latest = (
            self.db.query(QuizResult.quiz_id, func.max(QuizResult.created_at).label("at"))
            .filter(QuizResult.user_id == user_id)
            .group_by(QuizResult.quiz_id)
            .subquery()
        )
        rows = (
            self._result_rows(user_id, question_counts)
            .join(latest, and_(latest.c.quiz_id == QuizResult.quiz_id, latest.c.at == QuizResult.created_at))
            .order_by(desc(QuizResult.created_at), desc(QuizResult.id))
            .limit(10)
            .all()
        )
        recent, seen = [], set()
        for row in rows:  # two submissions with the same timestamp: keep one
            if row.quiz_id not in seen and len(recent) < 5:
                seen.add(row.quiz_id)
                recent.append(self._row(row))

        return {
            "total_subjects": total_subjects,
            "total_quizzes": total_quizzes,
            "total_questions_answered": total_questions,
            "avg_score": round(avg_score, 2),
            "recent_quizzes": recent,
        }

    def get_results(
        self, user_id: UUID, subject_id: Optional[UUID], limit: int, offset: int
    ) -> Tuple[int, List[dict]]:
        """Every submission of the user, newest first, optionally of one
        subject - the "Sổ điểm" page."""
        query = self._result_rows(user_id, self._question_counts())
        if subject_id:
            query = query.filter(Quiz.subject_id == subject_id)
        total = query.count()
        rows = query.order_by(desc(QuizResult.created_at), desc(QuizResult.id)).offset(offset).limit(limit).all()
        return total, [self._row(row) for row in rows]
