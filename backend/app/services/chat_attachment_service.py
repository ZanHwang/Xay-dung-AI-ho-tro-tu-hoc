"""AI Tutor chat attachments (images / PDFs) kept in shared storage so a
conversation shows its attachments on every device, not just the one that
sent them."""
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import ChatAttachment
from app.services.storage import storage, chat_attachment_key

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_MESSAGE = 4


def _sniff_media_type(data: bytes) -> Optional[str]:
    """The real file type from its leading bytes - never trust the name."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class ChatAttachmentService:
    def __init__(self, db: Session):
        self.db = db

    async def upload(self, user_id: UUID, file: UploadFile) -> ChatAttachment:
        data = await file.read(MAX_ATTACHMENT_BYTES + 1)
        if not data or len(data) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(413, "Tệp đính kèm phải từ 1 byte đến 10 MB.")
        media_type = _sniff_media_type(data)
        if media_type is None:
            raise HTTPException(422, "Chỉ nhận ảnh JPG/PNG/WebP hoặc tài liệu PDF.")
        name = "".join(c for c in (file.filename or "tep-dinh-kem") if c.isprintable())[:255] or "tep-dinh-kem"
        attachment = ChatAttachment(user_id=user_id, name=name, media_type=media_type, size=len(data))
        self.db.add(attachment)
        self.db.flush()
        await storage.put(chat_attachment_key(user_id, attachment.id), data, media_type)
        self.db.commit()
        self.db.refresh(attachment)
        return attachment

    def owned(self, attachment_id: UUID, user_id: UUID) -> ChatAttachment:
        attachment = (
            self.db.query(ChatAttachment)
            .filter(ChatAttachment.id == attachment_id, ChatAttachment.user_id == user_id)
            .first()
        )
        if attachment is None:
            raise HTTPException(404, "Không tìm thấy tệp đính kèm.")
        return attachment

    async def content(self, attachment_id: UUID, user_id: UUID) -> tuple[ChatAttachment, bytes]:
        attachment = self.owned(attachment_id, user_id)
        data = await storage.try_get(chat_attachment_key(user_id, attachment.id))
        if data is None:
            raise HTTPException(410, "Tệp đính kèm không còn trên máy chủ.")
        return attachment, data

    async def delete(self, attachment_id: UUID, user_id: UUID) -> None:
        attachment = self.owned(attachment_id, user_id)
        await storage.delete_prefix(chat_attachment_key(user_id, attachment.id))
        self.db.delete(attachment)
        self.db.commit()

    def attach_to_conversation(
        self, attachment_ids: List[UUID], user_id: UUID, conversation_id: UUID
    ) -> List[dict]:
        """Link the user's own attachments to the conversation and return the
        list to record in the user message's metadata (unknown ids dropped)."""
        if len(attachment_ids) > MAX_ATTACHMENTS_PER_MESSAGE:
            raise HTTPException(422, f"Mỗi tin nhắn tối đa {MAX_ATTACHMENTS_PER_MESSAGE} tệp.")
        rows = (
            self.db.query(ChatAttachment)
            .filter(ChatAttachment.id.in_(attachment_ids), ChatAttachment.user_id == user_id)
            .all()
        )
        by_id = {row.id: row for row in rows}
        out = []
        for attachment_id in attachment_ids:
            row = by_id.get(attachment_id)
            if row is None:
                continue
            row.conversation_id = conversation_id
            out.append({"id": str(row.id), "name": row.name, "type": row.media_type, "size": row.size})
        return out

    async def purge_conversation(self, conversation_id: UUID, user_id: UUID) -> None:
        """Remove a conversation's attachments from storage + DB (called before
        the conversation itself is deleted)."""
        rows = (
            self.db.query(ChatAttachment)
            .filter(ChatAttachment.conversation_id == conversation_id, ChatAttachment.user_id == user_id)
            .all()
        )
        for row in rows:
            await storage.delete_prefix(chat_attachment_key(user_id, row.id))
            self.db.delete(row)
