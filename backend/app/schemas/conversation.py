from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from app.models.message import MessageRole


class ConversationBase(BaseModel):
    subject_id: Optional[UUID] = None
    title: Optional[str] = None


class ConversationCreate(ConversationBase):
    pass


class ConversationUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)


class ConversationResponse(ConversationBase):
    id: UUID
    user_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    last_message: Optional[str] = None
    message_count: int = 0

    class Config:
        from_attributes = True


class ConversationListResponse(BaseModel):
    total: int
    conversations: List[ConversationResponse]


class MessageBase(BaseModel):
    content: str = Field(..., min_length=1)


class MessageCreate(MessageBase):
    pass


class MessageResponse(MessageBase):
    id: UUID
    conversation_id: UUID
    role: MessageRole
    message_metadata: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class MessageListResponse(BaseModel):
    total: int
    messages: List[MessageResponse]


class ChatRequest(BaseModel):
    conversation_id: Optional[UUID] = None
    content: str = Field(..., min_length=1)
    mode: str = Field(default="chat")  # chat, rag
    document_ids: Optional[List[UUID]] = None
    subject_id: Optional[UUID] = None


class ChatResponse(BaseModel):
    message: MessageResponse
    sources: Optional[List[dict]] = None
    new_conversation: bool = False
