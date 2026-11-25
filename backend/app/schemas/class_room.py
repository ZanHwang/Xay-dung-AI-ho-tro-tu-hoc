from pydantic import BaseModel, Field
from typing import List
from uuid import UUID
from datetime import datetime


class ClassCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class ClassJoin(BaseModel):
    code: str = Field(..., min_length=4, max_length=10)


class ClassOut(BaseModel):
    id: UUID
    name: str
    code: str
    teacher_id: UUID
    students: int = 0


class ClassMemberOut(BaseModel):
    id: UUID
    name: str
    email: str
    role: str


class TeacherGuardError(BaseModel):
    detail: str
