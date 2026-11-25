"""Learning path (lộ trình) endpoints, nested under /api/subjects."""
import json
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.path import DocumentTopicGroup, TopicLessonResponse
from app.schemas.quiz import QuizWithQuestionsResponse
from app.services.path_service import PathService
from app.services.quiz_service import QuizService
from app.routers.quizzes import _quiz_with_questions_response
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


def get_path_service(db: Session = Depends(get_db)) -> PathService:
    return PathService(db)


def get_quiz_service(db: Session = Depends(get_db)) -> QuizService:
    return QuizService(db)


@router.get("/{subject_id}/path/topics", response_model=list[DocumentTopicGroup])
async def get_topic_progress(
    subject_id: UUID,
    current_user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
):
    """One group per document, each with its own ordered topic list and its
    own independent done/current/locked gating - documents never gate each
    other (see PathService.document_topic_groups)."""
    return await service.document_topic_groups(subject_id, current_user.id)


@router.get("/{subject_id}/path/documents/{document_id}/topics/{topic}/lesson", response_model=TopicLessonResponse)
async def get_topic_lesson(
    subject_id: UUID,
    document_id: UUID,
    topic: str,
    current_user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
):
    """Cached "Học" content for one (document, topic) pair (AI summary +
    source excerpts from that document only), generated on first request and
    reused after that."""
    lesson = await service.get_or_create_lesson(subject_id, current_user.id, document_id, topic)
    return TopicLessonResponse(
        topic=lesson.topic,
        summary=lesson.summary,
        excerpts=json.loads(lesson.excerpts_json),
    )


@router.post("/{subject_id}/path/documents/{document_id}/topics/{topic}/practice", response_model=QuizWithQuestionsResponse)
async def start_topic_practice(
    subject_id: UUID,
    document_id: UUID,
    topic: str,
    current_user: User = Depends(get_current_user),
    path_service: PathService = Depends(get_path_service),
    quiz_service: QuizService = Depends(get_quiz_service),
):
    """Create the auto-generated "Luyện tập" quiz for this (document, topic)
    Lộ trình entry. 403s if the topic is locked (server-side gating, not
    just a UI hide)."""
    quiz = await path_service.start_practice(subject_id, current_user.id, document_id, topic, quiz_service)
    return _quiz_with_questions_response(quiz)
