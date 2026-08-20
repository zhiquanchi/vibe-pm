from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CopilotChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)
    links: list[dict[str, str]] | None = None


class CopilotChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[CopilotChatMessage] = Field(default_factory=list)
