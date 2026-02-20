from __future__ import annotations

from typing import Any
from pydantic import BaseModel


class LangGraphRunStatus(BaseModel):
    id: str
    graph_id: str
    status: str
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    input: dict[str, Any] = {}
    output: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class LangGraphRunList(BaseModel):
    count: int
    runs: list[LangGraphRunStatus]
