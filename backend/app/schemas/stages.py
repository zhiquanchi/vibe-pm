from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


DeliverableType = Literal["document", "code", "deployment", "other"]
DeliverableContentKind = Literal["text", "link", "file"]


class StageTemplateItem(BaseModel):
    """One stage entry accepted at project creation or when adding a stage."""

    name: str = Field(min_length=1)
    goal: str | None = None
    owner_id: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.planned_start and self.planned_end and self.planned_end < self.planned_start:
            raise ValueError("planned_end must be on or after planned_start")
        return self


class StageCreate(StageTemplateItem):
    pass


class StageUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    goal: str | None = None
    owner_id: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None


class StageStartRequest(BaseModel):
    primary: bool = False


class ReorderRequest(BaseModel):
    stage_ids: list[int] = Field(min_length=1)


class StageCompleteRequest(BaseModel):
    successor_stage_id: int | None = Field(default=None, ge=1)


class StageOwnerRequest(BaseModel):
    owner_id: str = Field(min_length=1)


# --- PRD-05: stage deliverables & acceptance ---


class StageDeliverableCreate(BaseModel):
    name: str = Field(min_length=1)
    type: DeliverableType
    content_kind: DeliverableContentKind = "link"
    text: str | None = None
    link: str | None = None
    file_path: str | None = None
    file_name: str | None = None
    file_size: int | None = Field(default=None, ge=0)
    # Compatibility with the frontend-first PRD-05 contract. It is persisted in
    # file_path so the database remains aligned with the OpenSpec design.
    file_url: str | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("交付物名称不能为空")
        return name


class StageDeliverableUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    type: DeliverableType | None = None
    content_kind: DeliverableContentKind | None = None
    text: str | None = None
    link: str | None = None
    file_path: str | None = None
    file_name: str | None = None
    file_size: int | None = Field(default=None, ge=0)
    file_url: str | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        name = value.strip()
        if not name:
            raise ValueError("交付物名称不能为空")
        return name


class StageAcceptanceSubmit(BaseModel):
    notes: str | None = None
    # Frontend-first contract used ``note``; accept either spelling.
    note: str | None = None

    @model_validator(mode="after")
    def _normalize_notes(self):
        if self.notes is None and self.note is not None:
            self.notes = self.note
        return self


class StageAcceptanceHandle(BaseModel):
    action: Literal["approve", "reject"]
    notes: str | None = None
    note: str | None = None
    rejection_reason: str | None = None

    @model_validator(mode="after")
    def _validate_handle(self):
        if self.notes is None and self.note is not None:
            self.notes = self.note
        if self.action == "reject" and (self.rejection_reason is None or not self.rejection_reason.strip()):
            raise ValueError("驳回阶段验收时必须填写原因")
        return self


class StageReopenRequest(BaseModel):
    reason: str = Field(min_length=1)


# --- PRD-03: filters for the stage task workbench ---


class TaskListFilters(BaseModel):
    """Query filters for the stage task list view."""

    status: str | None = None
    priority: str | None = None
    assignee: str | None = None
    search: str | None = None
    # sort: created_at | planned_date | priority  (prefix with '-' for descending)
    sort: str | None = "created_at"


def validate_stage_items(items: list[StageTemplateItem]) -> list[StageTemplateItem]:
    """Project-level stage list rules: at least one stage, unique names."""
    if not items:
        raise ValueError("项目必须至少保留一个阶段")
    names = [item.name.strip() for item in items]
    if any(not name for name in names):
        raise ValueError("阶段名称不能为空")
    if len(set(names)) != len(names):
        raise ValueError("同一项目内阶段名称不能重复")
    return items
