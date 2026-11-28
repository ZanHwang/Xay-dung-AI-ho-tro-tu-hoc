"""Learning path (lộ trình) endpoints, nested under /api/subjects."""
import json
from uuid import UUID
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.path import ContinueTopicResponse, DocumentTopicGroup, TopicLessonResponse
from app.schemas.quiz import QuizWithQuestionsResponse
from app.schemas.conversation import ChatRequest, ChatResponse, MessageResponse
from app.services.path_service import PathService
from app.services.quiz_service import QuizService
from app.services.chat_service import ChatService
from app.routers.quizzes import _quiz_with_questions_response
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


def get_path_service(db: Session = Depends(get_db)) -> PathService:
    return PathService(db)


def get_quiz_service(db: Session = Depends(get_db)) -> QuizService:
    return QuizService(db)


def get_chat_service(db: Session = Depends(get_db)) -> ChatService:
    return ChatService(db)


@router.get("/path/continue", response_model=ContinueTopicResponse)
async def get_continue_topic(
    current_user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
):
    """The topic "Học tiếp" offers across all subjects, a few other roads,
    and why there is nothing to continue (see PathService.continue_topic).
    Async: it may start a background topic backfill on the event loop."""
    return service.continue_topic(current_user.id)


@router.post("/{subject_id}/path/documents/{document_id}/visit", status_code=status.HTTP_204_NO_CONTENT)
def mark_document_studied(
    subject_id: UUID,
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
):
    """Called when the user opens a "Học" lesson of this document."""
    service.mark_studied(subject_id, current_user.id, document_id)


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


@router.get("/{subject_id}/path/documents/{document_id}/topics/{topic}/chat", response_model=list[MessageResponse])
async def get_topic_chat_history(
    subject_id: UUID,
    document_id: UUID,
    topic: str,
    current_user: User = Depends(get_current_user),
    service: PathService = Depends(get_path_service),
):
    """Past "Hỏi thêm AI" Q&A for this (document, topic), oldest first - empty
    if nothing has been asked yet."""
    messages = service.get_topic_chat_history(subject_id, current_user.id, document_id, topic)
    return [MessageResponse.model_validate(m) for m in messages]


class AskTopicContent(BaseModel):
    content: str = Field(..., min_length=1)


@router.post("/{subject_id}/path/documents/{document_id}/topics/{topic}/ask", response_model=ChatResponse)
async def ask_about_topic(
    subject_id: UUID,
    document_id: UUID,
    topic: str,
    data: AskTopicContent,
    current_user: User = Depends(get_current_user),
    path_service: PathService = Depends(get_path_service),
    chat_service: ChatService = Depends(get_chat_service),
):
    """Ask AI about this (document, topic) - reuses the SAME conversation
    across every visit (PathService.get_or_create_topic_conversation, tagged
    by document_id+topic) instead of starting a new one each time "Học" is
    reopened. Delegates to the ordinary chat pipeline (ChatService.
    process_chat) once the right conversation_id is resolved - same RAG/math
    behavior as the regular Tutor chat, just pre-scoped to this one document."""
    conversation = path_service.get_or_create_topic_conversation(
        subject_id, current_user.id, document_id, topic
    )
    request = ChatRequest(
        conversation_id=conversation.id,
        content=data.content,
        mode="rag",
        subject_id=subject_id,
        document_ids=[document_id],
    )
    _, _, ai_msg, sources, new_conversation = await chat_service.process_chat(current_user.id, request)
    return ChatResponse(
        message=MessageResponse.model_validate(ai_msg),
        sources=sources,
        new_conversation=new_conversation,
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
