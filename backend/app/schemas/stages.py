from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, model_validator


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
