"""Classes (lớp học), ported from tu-hoc-rag-v2.

- A teacher (role="teacher") creates a class; a 6-char join code is
  generated and the teacher auto-enrolls.
- Students join by code.
- The teacher can batch-grade the class's pending essays (see
  EssayService.grade_batch).
"""
import random
import string
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models import ClassRoom, Enrollment, User

_CODE_CHARS = string.ascii_uppercase + string.digits


def _new_code() -> str:
    return "".join(random.choices(_CODE_CHARS, k=6))


class ClassService:
    def __init__(self, db: Session):
        self.db = db

    # -- guards -------------------------------------------------------------

    def require_teacher(self, user: User) -> None:
        if user.role != "teacher":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Chỉ giáo viên mới có thể thực hiện việc này",
            )

    def require_owner(self, class_id: UUID, user: User) -> ClassRoom:
        self.require_teacher(user)
        room = self.db.get(ClassRoom, class_id)
        if room is None or room.teacher_id != user.id:
            raise HTTPException(404, "Không tìm thấy lớp của bạn.")
        return room

    def require_member(self, class_id: UUID, user: User) -> ClassRoom:
        room = self.db.get(ClassRoom, class_id)
        if room is None:
            raise HTTPException(404, "Không tìm thấy lớp.")
        if room.teacher_id != user.id:
            enrolled = self.db.query(Enrollment.id).filter_by(class_id=class_id, user_id=user.id).first()
            if enrolled is None:
                raise HTTPException(404, "Không tìm thấy lớp.")
        return room

    def _members(self, class_id: UUID) -> List[User]:
        return (
            self.db.query(User)
            .join(Enrollment, Enrollment.user_id == User.id)
            .filter(Enrollment.class_id == class_id)
            .all()
        )

    def _out(self, room: ClassRoom) -> dict:
        members = self._members(room.id)
        return {
            "id": room.id,
            "name": room.name,
            "code": room.code,
            "teacher_id": room.teacher_id,
            "students": len(members),
        }

    # -- endpoints ----------------------------------------------------------

    def list_classes(self, user_id: UUID, user: User) -> List[dict]:
        """Classes the user teaches OR is enrolled in."""
        rooms = (
            self.db.query(ClassRoom)
            .filter(
                (ClassRoom.teacher_id == user_id)
                | (
                    self.db.query(Enrollment)
                    .filter(Enrollment.class_id == ClassRoom.id,
                           Enrollment.user_id == user_id)
                    .exists()
                )
            )
            .all()
        )
        return [self._out(r) for r in rooms]

    def create_class(self, user: User, name: str) -> dict:
        self.require_teacher(user)
        name = (name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tên lớp không được trống")
        code = _new_code()
        # keep the code unique (6-char collisions are possible but rare)
        while self.db.query(ClassRoom).filter(ClassRoom.code == code).first():
            code = _new_code()
        room = ClassRoom(name=name, code=code, teacher_id=user.id)
        self.db.add(room)
        self.db.flush()
        # teacher joins their own class
        self.db.add(Enrollment(class_id=room.id, user_id=user.id))
        self.db.commit()
        self.db.refresh(room)
        return self._out(room)

    def join_class(self, user_id: UUID, code: str) -> dict:
        code = (code or "").strip().upper()
        room = self.db.query(ClassRoom).filter(ClassRoom.code == code).first()
        if not room:
            raise HTTPException(status_code=404, detail="Không tìm thấy mã lớp")
        exists = (
            self.db.query(Enrollment)
            .filter(Enrollment.class_id == room.id, Enrollment.user_id == user_id)
            .first()
        )
        if not exists:
            self.db.add(Enrollment(class_id=room.id, user_id=user_id))
            self.db.commit()
        return self._out(room)

    def members(self, class_id: UUID, teacher_id: UUID) -> List[dict]:
        """Members with their emails - only for the class's own teacher."""
        room = (
            self.db.query(ClassRoom)
            .filter(ClassRoom.id == class_id, ClassRoom.teacher_id == teacher_id)
            .first()
        )
        if not room:
            raise HTTPException(status_code=404, detail="Không tìm thấy lớp hoặc không phải lớp của bạn")
        return [
            {"id": m.id, "name": m.full_name, "email": m.email, "role": m.role}
            for m in self._members(class_id)
        ]
