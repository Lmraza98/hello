from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.compound_workflow.models import CompoundWorkflowSpec, CreateWorkflowRequest
from services.compound_workflow.orchestrator import get_orchestrator


router = APIRouter(prefix="/api/compound_workflow", tags=["compound-workflow"])


class RunWorkflowRequest(BaseModel):
    spec: CompoundWorkflowSpec
    user_id: str | None = None


@router.post("/create")
async def create_compound_workflow(req: CreateWorkflowRequest) -> dict[str, Any]:
    orchestrator = get_orchestrator()
    workflow_id = await orchestrator.create_workflow(req.spec.model_dump(by_alias=True), user_id=req.user_id)
    return {"ok": True, "workflow_id": workflow_id, "status": "pending"}


@router.post("/run")
async def run_compound_workflow(req: RunWorkflowRequest) -> dict[str, Any]:
    orchestrator = get_orchestrator()
    workflow_id = await orchestrator.create_workflow(req.spec.model_dump(by_alias=True), user_id=req.user_id)
    started = await orchestrator.start_workflow(workflow_id)
    if not started.get("ok"):
        raise HTTPException(status_code=400, detail=started)
    return {
        "ok": True,
        "workflow_id": workflow_id,
        "status": started.get("status", "running"),
        "message": "Compound workflow started in background.",
    }


@router.post("/{workflow_id}/start")
async def start_compound_workflow(workflow_id: str) -> dict[str, Any]:
    orchestrator = get_orchestrator()
    out = await orchestrator.start_workflow(workflow_id)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out)
    return out


@router.post("/{workflow_id}/continue")
async def continue_compound_workflow(workflow_id: str) -> dict[str, Any]:
    orchestrator = get_orchestrator()
    out = await orchestrator.continue_workflow(workflow_id)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out)
    return out


@router.post("/{workflow_id}/cancel")
async def cancel_compound_workflow(workflow_id: str) -> dict[str, Any]:
    orchestrator = get_orchestrator()
    out = await orchestrator.cancel_workflow(workflow_id)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out)
    return out


@router.get("/{workflow_id}/status")
async def get_compound_workflow_status(workflow_id: str) -> dict[str, Any]:
    orchestrator = get_orchestrator()
    status = orchestrator.get_workflow_status(workflow_id)
    if status is None:
        raise HTTPException(status_code=404, detail={"code": "workflow_not_found", "message": workflow_id})
    return {"ok": True, **status}


@router.get("")
async def list_compound_workflows(limit: int = 50, status: str | None = None) -> dict[str, Any]:
    orchestrator = get_orchestrator()
    rows = orchestrator.list_workflows(limit=limit, status=status)
    return {"ok": True, "count": len(rows), "workflows": rows}
