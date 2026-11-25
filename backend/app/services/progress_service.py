from uuid import UUID
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc, func
from app.models import Subject, QuizResult


class ProgressService:
    def __init__(self, db: Session):
        self.db = db

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
        totals = (
            self.db.query(
                func.count(QuizResult.id),
                func.coalesce(func.sum(QuizResult.total_questions), 0),
                func.coalesce(func.avg(QuizResult.score), 0),
            )
            .filter(QuizResult.user_id == user_id)
            .one()
        )
        total_quizzes, total_questions, avg_score = totals

        # Get recent quizzes. joinedload(.quiz) so reading r.quiz.title below
        # doesn't lazy-load the related Quiz row one at a time (5 extra round
        # trips for 5 recent quizzes, on the dashboard - the landing page).
        recent_quizzes = (
            self.db.query(QuizResult)
            .options(joinedload(QuizResult.quiz))
            .filter(QuizResult.user_id == user_id)
            .order_by(desc(QuizResult.created_at))
            .limit(5)
            .all()
        )

        return {
            "total_subjects": total_subjects,
            "total_quizzes": total_quizzes,
            "total_questions_answered": total_questions,
            "avg_score": round(avg_score, 2),
            "recent_quizzes": [
                {
                    "id": r.id,
                    "quiz_id": r.quiz_id,
                    "title": r.quiz.title if r.quiz else None,
                    "score": r.score,
                    "correct_count": r.correct_count,
                    "total_questions": r.total_questions,
                    "created_at": r.created_at
                }
                for r in recent_quizzes
            ],
        }
