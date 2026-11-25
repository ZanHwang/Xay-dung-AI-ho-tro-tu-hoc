from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID


class TopicProgress(BaseModel):
    """Progress on one topic within one document's own Lộ trình group."""
    topic: str
    state: str  # done | current | locked
    best_percent: Optional[int] = None
    # Score of the MOST RECENT attempt scoped to this topic (vs best_percent,
    # the highest ever) - lets the frontend flag "done but slipped recently"
    # even when the topic's best score still clears the threshold.
    recent_percent: Optional[int] = None


class DocumentTopicGroup(BaseModel):
    """One document's own topic list + progress - see
    PathService.document_topic_groups. Documents never gate each other."""
    document_id: UUID
    document_name: str
    topics: List[TopicProgress]


class TopicExcerpt(BaseModel):
    document_name: str
    page: Optional[str] = None
    content: str


class TopicLessonResponse(BaseModel):
    """Cached "Học" content for one topic - see TopicLesson / PathService.get_or_create_lesson."""
    topic: str
    summary: str
    excerpts: List[TopicExcerpt]
