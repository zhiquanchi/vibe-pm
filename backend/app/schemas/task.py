from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


StoryPoints = Literal[1, 2, 3, 5, 8, 13]
TaskStatus = Literal["todo", "in_progress", "in_review", "done"]
Priority = Literal["P0", "P1", "P2", "P3"]


class TaskCreateRequest(BaseModel):
    project_id: int = 1
    sprint_id: int | None = None
    title: str = Field(min_length=1)
    description: str | None = None
    status: TaskStatus = "todo"
    story_points: StoryPoints
    priority: Priority = "P2"
    assignee: str | None = None
    position: int | None = Field(default=None, ge=0)
    reason: str | None = None
    created_by: str = "current-user"


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    status: TaskStatus | None = None
    story_points: StoryPoints | None = None
    priority: Priority | None = None
    assignee: str | None = None
    sprint_id: int | None = None
    position: int | None = Field(default=None, ge=0)
    reason: str | None = None
    created_by: str = "current-user"


class TaskResponse(BaseModel):
    id: int
    project_id: int
    sprint_id: int | None
    title: str
    description: str | None
    status: TaskStatus
    story_points: float
    priority: Priority
    assignee: str | None
    position: int
    created_at: datetime | str
    updated_at: datetime | str
    completed_at: datetime | str | None = None
