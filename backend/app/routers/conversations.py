from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from app.database import get_db
from app.schemas.conversation import (
    ConversationCreate, ConversationUpdate, ConversationResponse,
    ConversationListResponse, MessageResponse, MessageListResponse,
    ChatRequest, ChatResponse
)
from app.services.conversation_service import ConversationService
from app.services.chat_service import ChatService
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


def get_conversation_service(db: Session = Depends(get_db)) -> ConversationService:
    return ConversationService(db)


def get_chat_service(db: Session = Depends(get_db)) -> ChatService:
    return ChatService(db)


@router.get("/", response_model=ConversationListResponse)
def get_conversations(
    subject_id: Optional[UUID] = Query(None, description="Filter by subject"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service)
):
    """
    Get all conversations for the current user.
    """
    conversations, total = service.get_conversations_by_user(
        current_user.id, subject_id, limit, offset
    )

    conversation_responses = service.get_conversations_with_last_message(conversations)

    return ConversationListResponse(total=total, conversations=conversation_responses)


@router.post("/", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def create_conversation(
    data: ConversationCreate,
    current_user: User = Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service)
):
    """
    Create a new conversation.
    """
    conversation = service.create_conversation(current_user.id, data)
    return service.get_conversation_with_last_message(conversation)


@router.get("/{conversation_id}", response_model=ConversationResponse)
def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service)
):
    """
    Get a specific conversation.
    """
    conversation = service.get_conversation_by_id(conversation_id, current_user.id)
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
    return service.get_conversation_with_last_message(conversation)


@router.put("/{conversation_id}", response_model=ConversationResponse)
def update_conversation(
    conversation_id: UUID,
    data: ConversationUpdate,
    current_user: User = Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service)
):
    """
    Update conversation title.
    """
    conversation = service.update_conversation(conversation_id, current_user.id, data)
    return service.get_conversation_with_last_message(conversation)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service)
):
    """
    Delete a conversation and all its messages.
    """
    service.delete_conversation(conversation_id, current_user.id)
    return None


@router.get("/{conversation_id}/messages", response_model=MessageListResponse)
def get_messages(
    conversation_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service)
):
    """
    Get messages for a conversation.
    """
    messages, total = service.get_messages(
        conversation_id, current_user.id, limit, offset
    )
    return MessageListResponse(total=total, messages=messages)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service)
):
    """
    Send a message and get AI response.
    """
    conversation, user_msg, ai_msg, sources, new_conversation = await service.process_chat(
        current_user.id, request
    )

    return ChatResponse(
        message=MessageResponse.model_validate(ai_msg),
        sources=sources,
        new_conversation=new_conversation
    )
