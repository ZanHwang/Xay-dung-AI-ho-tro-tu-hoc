from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from app.database import get_db
from typing import Optional
from app.schemas.subject import (
    SubjectCreate, SubjectUpdate, SubjectResponse, SubjectListResponse, SubjectStats,
    SubjectNamesResponse,
)
from app.services.subject_service import SubjectService
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


def get_subject_service(db: Session = Depends(get_db)) -> SubjectService:
    return SubjectService(db)


@router.get("/", response_model=SubjectListResponse)
def get_subjects(
    current_user: User = Depends(get_current_user),
    service: SubjectService = Depends(get_subject_service)
):
    """
    Get all subjects for the current user.
    """
    subjects = service.get_subjects_by_user(current_user.id)

    # Batched: 2 round trips total for every subject's stats, instead of 3
    # PER subject (get_subject_stats called in a loop) - that used to make
    # loading the subjects list alone take 1 + 3*N round trips to Neon.
    stats_by_id = service.get_stats_for_subjects([s.id for s in subjects])
    subject_responses = []
    for subject in subjects:
        subject_data = SubjectResponse.model_validate(subject)
        subject_data.stats = SubjectStats(**stats_by_id[subject.id])
        subject_responses.append(subject_data)

    return SubjectListResponse(total=len(subject_responses), subjects=subject_responses)


@router.get("/known-names/", response_model=SubjectNamesResponse)
def get_known_subject_names(
    q: Optional[str] = Query(None, description="Filter (contains, case-insensitive)"),
    current_user: User = Depends(get_current_user),
    service: SubjectService = Depends(get_subject_service)
):
    """
    Subject names that already exist (across every user) - lets someone
    naming a new subject reuse an existing name instead of a slightly
    different spelling, so they land on the SAME shared question bank (see
    SubjectService.get_known_names). Must be registered before `/{subject_id}`
    so "known-names" isn't parsed as a subject id.
    """
    return SubjectNamesResponse(names=service.get_known_names(q))


@router.post("/", response_model=SubjectResponse, status_code=status.HTTP_201_CREATED)
def create_subject(
    subject_data: SubjectCreate,
    current_user: User = Depends(get_current_user),
    service: SubjectService = Depends(get_subject_service)
):
    """
    Create a new subject.
    """
    subject = service.create_subject(current_user.id, subject_data)
    return subject


@router.get("/{subject_id}", response_model=SubjectResponse)
def get_subject(
    subject_id: UUID,
    current_user: User = Depends(get_current_user),
    service: SubjectService = Depends(get_subject_service)
):
    """
    Get a specific subject with details.
    """
    subject = service.get_subject_by_id(subject_id, current_user.id)
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found"
        )

    stats = service.get_subject_stats(subject_id, current_user.id)
    response = SubjectResponse.model_validate(subject)
    response.stats = SubjectStats(**stats)
    return response


@router.put("/{subject_id}", response_model=SubjectResponse)
def update_subject(
    subject_id: UUID,
    subject_data: SubjectUpdate,
    current_user: User = Depends(get_current_user),
    service: SubjectService = Depends(get_subject_service)
):
    """
    Update a subject.
    """
    subject = service.update_subject(subject_id, current_user.id, subject_data)
    stats = service.get_subject_stats(subject_id, current_user.id)
    response = SubjectResponse.model_validate(subject)
    response.stats = SubjectStats(**stats)
    return response


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject(
    subject_id: UUID,
    current_user: User = Depends(get_current_user),
    service: SubjectService = Depends(get_subject_service)
):
    """
    Delete a subject.
    """
    service.delete_subject(subject_id, current_user.id)
    return None


@router.get("/{subject_id}/stats", response_model=SubjectStats)
def get_subject_stats(
    subject_id: UUID,
    current_user: User = Depends(get_current_user),
    service: SubjectService = Depends(get_subject_service)
):
    """
    Get statistics for a specific subject.
    """
    stats = service.get_subject_stats(subject_id, current_user.id)
    return SubjectStats(**stats)
