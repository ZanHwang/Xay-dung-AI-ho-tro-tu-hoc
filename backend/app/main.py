from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.database import engine, Base

# Import routers here
from app.routers import (
    auth, subjects, conversations, documents, quizzes, progress, reading,
    path, essays, classes, exams,
)

# Seed the shared question bank (idempotent - only inserts missing rows).
def _seed_shared_bank() -> None:
    from app.data.seed_shared import seed_shared_questions
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as session:
        seed_shared_questions(session)

# Create database tables + seed. Tolerant: a transient DB outage (e.g. flaky
# DNS to the cloud DB) must not crash the process - requests that need the DB
# will surface a clear error instead.
#
# One-off ALTER/DROP migrations that used to run here (adding columns the
# current models already declare, dropping tables no model references anymore
# - weaknesses/progress/topics/user_progress/chapters/lessons/path_proposals)
# have all been applied to the project's own database already and were
# removed - create_all() alone builds the current schema correctly on a
# fresh database (e.g. a teammate's first run).
def _startup_db_setup() -> None:
    try:
        Base.metadata.create_all(
            bind=engine,
            tables=[table for table in Base.metadata.sorted_tables if not table.info.get("explicit_install")],
        )
        _seed_shared_bank()
    except Exception as exc:  # noqa: BLE001 - startup must stay alive
        import logging
        logging.getLogger(__name__).warning(
            "DB setup skipped at startup (will retry on first request): %s", exc
        )

_startup_db_setup()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Auto-recover documents orphaned by a server restart mid-pipeline - see
    # DocumentService.recover_stuck_documents for why this is needed and why
    # it is always safe to run on every boot.
    import logging
    try:
        from app.services.document_service import recover_stuck_documents
        count = await recover_stuck_documents()
        if count:
            logging.getLogger(__name__).info(
                "Re-queued %d stuck document(s) for processing on startup", count
            )
    except Exception as exc:  # noqa: BLE001 - startup must stay alive
        logging.getLogger(__name__).warning(
            "Stuck-document recovery skipped at startup: %s", exc
        )
    yield


app = FastAPI(
    title="AI Tutor Backend",
    description="AI Gia Sư Hỗ Trợ Học Tập Tiếng Việt",
    version="1.0.0",
    lifespan=_lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Next.js default
        "http://localhost:5173",  # Vite/Vinext default
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "AI Tutor API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from app.utils.health import get_health_status
    return await get_health_status()


@app.get("/health/db")
async def health_database():
    """Database health check."""
    from app.utils.health import check_database
    return await check_database()


# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(subjects.router, prefix="/api/subjects", tags=["Subjects"])
# Learning path (lộ trình) is nested under subjects: /api/subjects/{id}/path/...
app.include_router(path.router, prefix="/api/subjects", tags=["Learning Path"])
app.include_router(conversations.router, prefix="/api/conversations", tags=["Conversations"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(quizzes.router, prefix="/api/quizzes", tags=["Quizzes"])
app.include_router(progress.router, prefix="/api/progress", tags=["Progress"])
app.include_router(reading.router, prefix="/api/reading", tags=["Reading"])
app.include_router(essays.router, prefix="/api/essays", tags=["Essays"])
app.include_router(classes.router, prefix="/api/classes", tags=["Classes"])
app.include_router(exams.router, prefix="/api", tags=["Exam Grading"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
