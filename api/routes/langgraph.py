from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.langgraph.engine import get_engine
from services.langgraph import state_store


router = APIRouter(prefix="/api/langgraph", tags=["langgraph"])


class CreateRunRequest(BaseModel):
    graph_id: str
    input: dict[str, Any]
    user_id: str | None = None


class RunStatusResponse(BaseModel):
    id: str
    graph_id: str
    status: str
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    progress: dict[str, Any] | None = None
    output: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


@router.post("/runs")
async def create_run(req: CreateRunRequest) -> dict[str, Any]:
    engine = get_engine()
    try:
        run_id = engine.create_run(req.graph_id, req.input)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    return {"ok": True, "run_id": run_id, "status": "pending"}


@router.post("/runs/{run_id}/start")
async def start_run(run_id: str) -> dict[str, Any]:
    engine = get_engine()
    out = await engine.start_run(run_id)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out)
    return out


@router.post("/runs/{run_id}/continue")
async def continue_run(run_id: str) -> dict[str, Any]:
    engine = get_engine()
    out = await engine.continue_run(run_id)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out)
    return out


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict[str, Any]:
    engine = get_engine()
    out = await engine.cancel_run(run_id)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out)
    return out


@router.get("/runs/{run_id}/status", response_model=RunStatusResponse)
async def run_status(run_id: str) -> dict[str, Any]:
    run = state_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail={"error": "run_not_found"})
    checkpoint = state_store.get_latest_checkpoint(run_id)
    progress = None
    if checkpoint:
        progress = checkpoint.get("state", {}).get("progress")
    return {
        "id": run["id"],
        "graph_id": run["graph_id"],
        "status": run["status"],
        "created_at": run["created_at"],
        "started_at": run["started_at"],
        "completed_at": run["completed_at"],
        "progress": progress,
        "output": run.get("output"),
        "error": run.get("error"),
    }


@router.get("/runs")
async def list_runs(limit: int = 50, status: str | None = None) -> dict[str, Any]:
    rows = state_store.list_runs(limit=limit, status=status)
    return {"ok": True, "count": len(rows), "runs": rows}
