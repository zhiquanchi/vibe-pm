from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ScopeChangeCommand(BaseModel):
    type: Literal["add_task", "remove_task", "change_points"]
    task_id: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    story_points: int | None = Field(default=None, ge=1)
    points_delta: float | None = None
    reason: str | None = None
    created_by: str = "current-user"

    @model_validator(mode="after")
    def validate_command(self):
        if self.type == "add_task" and not self.title:
            raise ValueError("title is required when adding a task")
        if self.type in {"remove_task", "change_points"} and self.task_id is None:
            raise ValueError("task_id is required for this scope change")
        if self.type == "change_points" and self.story_points is None and self.points_delta is None:
            raise ValueError("story_points or points_delta is required when changing points")
        return self

