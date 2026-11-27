from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime


class SubjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    color: str = Field(default="#6366f1", pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str = Field(default="book", max_length=50)
    learning_goal: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None


class SubjectCreate(SubjectBase):
    pass


class SubjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: Optional[str] = Field(None, max_length=50)
    learning_goal: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None


class SubjectStats(BaseModel):
    total_documents: int = 0
    total_quizzes: int = 0
    last_activity: Optional[datetime] = None


class SubjectResponse(SubjectBase):
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    stats: Optional[SubjectStats] = None

    class Config:
        from_attributes = True


class SubjectListResponse(BaseModel):
    total: int
    subjects: List[SubjectResponse]


class SubjectNamesResponse(BaseModel):
    names: List[str]
