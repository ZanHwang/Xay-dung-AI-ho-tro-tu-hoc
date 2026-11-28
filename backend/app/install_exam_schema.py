"""Install the exam tables on a database explicitly selected by the operator."""

import os

from sqlalchemy import create_engine

from app.database import Base
from app.models.exam import ExamAssignment, ExamFile, ExamSubmission


def install_exam_schema(bind) -> None:
    Base.metadata.create_all(
        bind, tables=[ExamAssignment.__table__, ExamSubmission.__table__, ExamFile.__table__]
    )


if __name__ == "__main__":
    url = os.environ.get("EXAM_SCHEMA_DATABASE_URL")
    if not url:
        raise SystemExit("Set EXAM_SCHEMA_DATABASE_URL to the approved target database.")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            install_exam_schema(connection)
    finally:
        engine.dispose()
