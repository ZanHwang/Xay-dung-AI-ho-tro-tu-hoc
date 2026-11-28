from uuid import UUID
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import case, desc, func
from app.models import Subject, QuizQuestion, QuizResult


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
        # Quizzes done / average score count FULL attempts only - a due-review
        # or retry-wrong session answers just a few of a quiz's questions and
        # would otherwise count as a whole quiz (and skew the average).
        # Questions answered still counts every attempt.
        question_counts = (
            self.db.query(QuizQuestion.quiz_id, func.count(QuizQuestion.id).label("n"))
            .group_by(QuizQuestion.quiz_id)
            .subquery()
        )
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
