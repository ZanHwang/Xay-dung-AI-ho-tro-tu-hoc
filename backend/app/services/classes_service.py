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

    def _require_teacher(self, user: User) -> None:
        if user.role != "teacher":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Chỉ giáo viên mới có thể thực hiện việc này",
            )

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
        self._require_teacher(user)
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
        return {"id": room.id, "name": room.name, "code": room.code}

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
        return {"id": room.id, "name": room.name, "code": room.code}

    def members(self, class_id: UUID) -> List[dict]:
        room = self.db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
        if not room:
            raise HTTPException(status_code=404, detail="Không tìm thấy lớp")
        return [
            {"id": m.id, "name": m.full_name, "email": m.email, "role": m.role}
            for m in self._members(class_id)
        ]
