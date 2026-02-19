from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


PhaseType = Literal["search", "enrich", "verify", "filter", "aggregate"]


class WorkflowConstraints(BaseModel):
    max_results: int = Field(default=10, ge=1, le=500)
    max_runtime_minutes: int = Field(default=60, ge=1, le=360)
    max_browser_calls: int = Field(default=250, ge=1, le=5000)
    concurrency: int = Field(default=3, ge=1, le=10)


class WorkflowOperation(BaseModel):
    tool: str
    task: str
    base_params: dict[str, Any] = Field(default_factory=dict)


class WorkflowIteration(BaseModel):
    over: str
    as_: str = Field(alias="as")
    max_items: int = Field(default=100, ge=1, le=2000)
    concurrency: int = Field(default=3, ge=1, le=10)

    model_config = {"populate_by_name": True}


class WorkflowCheckpoint(BaseModel):
    enabled: bool = False
    message: str = "Continue to next phase?"
    auto_continue_if: str | None = None


class WorkflowPostProcess(BaseModel):
    filter: str | None = None
    sort_by: str | None = None
    limit: int | None = Field(default=None, ge=1, le=5000)


class WorkflowPhase(BaseModel):
    id: str
    name: str
    type: PhaseType
    operation: WorkflowOperation
    iteration: WorkflowIteration | None = None
    param_templates: dict[str, Any] = Field(default_factory=dict)
    post_process: WorkflowPostProcess | None = None
    checkpoint: WorkflowCheckpoint | None = None
    depends_on: list[str] = Field(default_factory=list)


class CompoundWorkflowSpec(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    created_at: str | None = None
    constraints: WorkflowConstraints = Field(default_factory=WorkflowConstraints)
    phases: list[WorkflowPhase] = Field(default_factory=list)
    original_query: str = ""


class CreateWorkflowRequest(BaseModel):
    spec: CompoundWorkflowSpec
    user_id: str | None = None


class StartWorkflowRequest(BaseModel):
    workflow_id: str

