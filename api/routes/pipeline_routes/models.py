"""Response models for pipeline route modules."""

from typing import Optional

from pydantic import BaseModel, Field


class PipelineOutputLine(BaseModel):
    time: str
    text: str


class PipelineStatusResponse(BaseModel):
    running: bool
    output: list[PipelineOutputLine] = Field(default_factory=list)
    started_at: Optional[str] = None


class PipelineStartedResponse(BaseModel):
    started: bool


class PipelineStoppedResponse(BaseModel):
    stopped: bool

