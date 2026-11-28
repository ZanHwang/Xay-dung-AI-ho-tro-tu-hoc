from typing import List, Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from app.models import Conversation, Message, Subject, MessageRole
from app.schemas.conversation import ChatRequest, ChatResponse, MessageResponse
from app.services.conversation_service import ConversationService
from app.ai.orchestrator import ai_orchestrator
from app.config import settings
from fastapi import HTTPException, status
import json

class ChatService:
    def __init__(self, db: Session):
        self.db = db
        self.conversation_service = ConversationService(db)

    async def process_chat(
        self, user_id: UUID, request: ChatRequest
    ) -> Tuple[Conversation, Message, Message, List[dict], bool]:
        """
        Process a chat request:
        1. Create or use existing conversation
        2. Save user message
        3. Call AI Orchestrator
        4. Save AI response
        5. Return results
        """
        conversation = None
        new_conversation = False

        if request.conversation_id:
            conversation = self.conversation_service.get_conversation_by_id(
                request.conversation_id, user_id
            )
        if conversation is None:
            from app.schemas.conversation import ConversationCreate
            conversation = self.conversation_service.create_conversation(
                user_id,
                ConversationCreate(
                    subject_id=request.subject_id,
                    title=None
                )
            )
            new_conversation = True

        # Save user message
        user_message = self.conversation_service.create_message(
            conversation.id,
            user_id,
            MessageRole.USER,
            request.content
        )

        # Get conversation history for context (the last N messages BEFORE this
        # user message - what the AI must remember between turns)
        history = self._get_history_for_context(conversation.id, user_message.id)

        # A Lộ trình "Học" conversation carries its topic as context for the
        # AI only - the stored user message stays exactly what the user typed.
        ai_message_text = (
            f"[Đang học chủ đề: {conversation.topic}] {request.content}"
            if conversation.topic else request.content
        )

        # Process with AI Orchestrator
        ai_result = await ai_orchestrator.process_request(
            user_id=user_id,
            message=ai_message_text,
            mode=request.mode,
            conversation_history=history,
            document_ids=request.document_ids
        )

        ai_content = ai_result["content"]
        sources = ai_result.get("sources") or []

        # Save AI response
        meta = {"sources": sources, "mode": ai_result.get("mode")}
        ai_message = self.conversation_service.create_message(
            conversation.id,
            user_id,
            MessageRole.ASSISTANT,
            ai_content,
            metadata=json.dumps(meta)
        )

        return conversation, user_message, ai_message, sources, new_conversation

    def _get_history_for_context(
        self, conversation_id: UUID, exclude_message_id: UUID
    ) -> List[dict]:
        """Get conversation history formatted for AI context.

        Takes the most recent `settings.ask_memory_messages` messages that
        came BEFORE the current user message (tunable via ASK_MEMORY_MESSAGES
        in .env, default 30). Each entry also carries the parsed message
        metadata so the Socratic tutor can resume a persisted plan.
        """
        limit = max(1, settings.ask_memory_messages)
        recent = self.conversation_service.get_recent_messages(conversation_id, limit + 1)
        # The user message just saved is the newest row; it becomes the
        # "current question", so drop it instead of echoing it as context.
        context_messages = [m for m in recent if m.id != exclude_message_id]
        if len(context_messages) > limit:
            context_messages = context_messages[-limit:]
        result = []
        for msg in context_messages:
            entry = {
                "role": msg.role.value,
                "content": msg.content
            }
            # Attach parsed metadata (ask_state lives here for the Socratic tutor)
            if msg.message_metadata:
                try:
                    entry["metadata"] = json.loads(msg.message_metadata)
                except (ValueError, TypeError):
                    entry["metadata"] = {}
            result.append(entry)
        return result

    def get_conversation_history(
        self, conversation_id: UUID, user_id: UUID, limit: int = 50, offset: int = 0
    ) -> Tuple[List[Message], int]:
        """Get conversation history."""
        return self.conversation_service.get_messages(
            conversation_id, user_id, limit, offset
        )
