from typing import List, Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from app.models import Conversation, Message, Subject, MessageRole
from app.schemas.conversation import ConversationCreate, ConversationUpdate
from fastapi import HTTPException, status
import time
from psycopg2 import OperationalError


class ConversationService:
    def __init__(self, db: Session):
        self.db = db

    def get_conversations_by_user(
        self, user_id: UUID, subject_id: Optional[UUID] = None, limit: int = 50, offset: int = 0,
        search: Optional[str] = None,
    ) -> Tuple[List[Conversation], int]:
        """Get all conversations for a user, optionally only those whose
        title contains `search` (case-insensitive)."""
        query = self.db.query(Conversation).filter(Conversation.user_id == user_id)

        if subject_id:
            query = query.filter(Conversation.subject_id == subject_id)
        if search and search.strip():
            pattern = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.filter(Conversation.title.ilike(f"%{pattern}%", escape="\\"))

        total = query.count()
        conversations = (
            query
            .order_by(desc(Conversation.updated_at))
            .offset(offset)
            .limit(limit)
            .all()
        )
        return conversations, total

    def get_conversation_by_id(self, conversation_id: UUID, user_id: UUID) -> Optional[Conversation]:
        """Get a conversation by ID, ensuring user ownership."""
        return (
            self.db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
            .first()
        )

    def create_conversation(self, user_id: UUID, data: ConversationCreate) -> Conversation:
        """Create a new conversation."""
        # Validate subject_id if provided
        if data.subject_id:
            subject = (
                self.db.query(Subject)
                .filter(Subject.id == data.subject_id, Subject.user_id == user_id)
                .first()
            )
            if not subject:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Subject not found"
                )

        title = data.title or f"Cuộc trò chuyện mới"

        conversation = Conversation(
            user_id=user_id,
            subject_id=data.subject_id,
            title=title
        )
        self.db.add(conversation)
        self.db.commit()
        self.db.refresh(conversation)
        return conversation

    def update_conversation(
        self, conversation_id: UUID, user_id: UUID, data: ConversationUpdate
    ) -> Conversation:
        """Update a conversation title."""
        conversation = self.get_conversation_by_id(conversation_id, user_id)
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        conversation.title = data.title
        self.db.commit()
        self.db.refresh(conversation)
        return conversation

    def delete_conversation(self, conversation_id: UUID, user_id: UUID) -> bool:
        """Delete a conversation and its messages."""
        conversation = self.get_conversation_by_id(conversation_id, user_id)
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        self.db.delete(conversation)
        self.db.commit()
        return True

    def get_messages(
        self, conversation_id: UUID, user_id: Optional[UUID], limit: int = 50, offset: int = 0
    ) -> Tuple[List[Message], int]:
        """Get messages for a conversation.
        Note: user_id=None is allowed for internal calls (e.g., chat history for AI context).
        """
        conversation = self.get_conversation_by_id(conversation_id, user_id)
        if not conversation:
            # Allow None user_id for internal calls (e.g., getting chat history for AI)
            if user_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )

        query = self.db.query(Message).filter(Message.conversation_id == conversation_id)
        total = query.count()
        messages = (
            query
            .order_by(Message.created_at)
            .offset(offset)
            .limit(limit)
            .all()
        )
        return messages, total

    def get_recent_messages(
        self, conversation_id: UUID, limit: int = 50
    ) -> List[Message]:
        """Most recent messages for a conversation, returned oldest -> newest.

        Used for AI context and Socratic-state lookups. A plain paged
        get_messages would return the FIRST N rows (the oldest), so in long
        conversations the AI's window would freeze at the start of the chat.
        """
        messages = (
            self.db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(desc(Message.created_at), desc(Message.id))
            .limit(limit)
            .all()
        )
        return list(reversed(messages))

    def create_message(
        self, conversation_id: UUID, user_id: UUID, role: MessageRole, content: str, metadata: Optional[str] = None
    ) -> Message:
        """Create a new message in a conversation."""
        conversation = self.get_conversation_by_id(conversation_id, user_id)
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )

        message = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            message_metadata=metadata
        )
        self.db.add(message)

        # Update conversation's updated_at
        conversation.updated_at = message.created_at

        # Neon's pooler closes idle read-write connections. During a long
        # LLM call the checked-out connection can go idle and get dropped,
        # so the commit below may fail with OperationalError. Roll back,
        # re-register the objects, and retry on a fresh connection.
        for attempt in range(4):
            try:
                self.db.commit()
                break
            except OperationalError:
                if attempt == 3:
                    raise
                self.db.rollback()
                # Re-sync both objects so the next commit re-issues the INSERT
                # (message) and the UPDATE (conversation.updated_at).
                self.db.add(message)
                conversation.updated_at = message.created_at
                time.sleep(1.0 + attempt)
        self.db.refresh(message)
        return message
    
    def get_conversation_with_last_message(self, conversation: Conversation) -> dict:
        """Get conversation with its last message."""
        last_message = (
            self.db.query(Message)
            .filter(Message.conversation_id == conversation.id)
            .order_by(desc(Message.created_at))
            .first()
        )

        # Real message count for the list view, so a conversation pulled from
        # the server shows "N tin nhắn" instead of a stale 0.
        message_count = (
            self.db.query(func.count(Message.id))
            .filter(Message.conversation_id == conversation.id)
            .scalar()
        ) or 0

        return {
            "id": conversation.id,
            "user_id": conversation.user_id,
            "subject_id": conversation.subject_id,
            "topic": conversation.topic,
            "title": conversation.title,
            "created_at": conversation.created_at,
            # Some rows (written before the onupdate default landed, or via a
            # pooler retry) have updated_at NULL. Coalesce to created_at so the
            # API contract (non-null datetime) always holds.
            "updated_at": conversation.updated_at or conversation.created_at,
            "last_message": last_message.content if last_message else None,
            "message_count": message_count,
        }

    def get_conversations_with_last_message(self, conversations: List[Conversation]) -> List[dict]:
        """Batched version of get_conversation_with_last_message - 2 round
        trips total for N conversations (1 GROUP BY for counts, 1 DISTINCT ON
        for each one's latest message), instead of 2 round trips PER
        conversation in a loop. That N+1 (the Tutor sidebar's conversation
        list calling the per-item method once per row) was a real
        contributor to the whole app feeling slow on load."""
        if not conversations:
            return []
        conv_ids = [c.id for c in conversations]
        counts = dict(
            self.db.query(Message.conversation_id, func.count(Message.id))
            .filter(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
            .all()
        )
        # DISTINCT ON (Postgres): one row per conversation_id, the first
        # under the ORDER BY - which must start with the same column(s) as
        # distinct() for this to mean "latest message per conversation".
        last_messages = dict(
            self.db.query(Message.conversation_id, Message.content)
            .filter(Message.conversation_id.in_(conv_ids))
            .order_by(Message.conversation_id, desc(Message.created_at))
            .distinct(Message.conversation_id)
            .all()
        )
        return [
            {
                "id": c.id,
                "user_id": c.user_id,
                "subject_id": c.subject_id,
                "topic": c.topic,
                "title": c.title,
                "created_at": c.created_at,
                "updated_at": c.updated_at or c.created_at,
                "last_message": last_messages.get(c.id),
                "message_count": counts.get(c.id, 0),
            }
            for c in conversations
        ]
