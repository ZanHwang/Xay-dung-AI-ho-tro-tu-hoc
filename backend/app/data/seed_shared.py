"""Idempotent seeder for the shared question bank.

Inserts the curated seed questions (see app.data.question_bank_seed) into
`shared_quiz_questions` only where the (subject_key, question_text) pair is
absent, so re-running on every backend start is safe and cheap.
"""
import json
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session
from app.models import SharedQuizQuestion
from app.data.question_bank_seed import SEED_QUESTIONS

logger = logging.getLogger(__name__)


def seed_shared_questions(db: Session) -> int:
    """Insert missing seed rows; returns the number of questions added."""
    added = 0
    for (skey, topic, diff, q, options, correct, expl) in SEED_QUESTIONS:
        exists = (
            db.query(SharedQuizQuestion)
            .filter(
                SharedQuizQuestion.subject_key == skey,
                SharedQuizQuestion.question_text == q,
            )
            .first()
        )
        if exists:
            continue
        db.add(SharedQuizQuestion(
            subject_key=skey,
            topic=topic,
            question_text=q,
            options=json.dumps(options),
            correct_answer=correct,
            explanation=expl,
            difficulty=diff,
            created_by=None,
        ))
        added += 1
    if added:
        db.commit()
    logger.info("Shared question bank seed: %d new question(s).", added)
    return added
