from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import config
from services.leadforge.store import (
    charge_run_credits,
    ensure_leadforge_tables,
    get_credit_summary,
    list_run_evidence,
    list_run_leads,
    persist_run_summary,
)

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


class CreateLeadResearchRunRequest(BaseModel):
    prompt: str
    options: dict[str, Any] | None = None
    user_id: str | None = None


@router.post("/runs")
async def create_run(req: CreateRunRequest) -> dict[str, Any]:
    engine = get_engine()
    try:
        run_id = engine.create_run(req.graph_id, req.input)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    return {"ok": True, "run_id": run_id, "status": "pending"}


@router.post("/runs/lead-research")
async def create_lead_research_run(req: CreateLeadResearchRunRequest) -> dict[str, Any]:
    engine = get_engine()
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail={"error": "prompt_required"})
    ensure_leadforge_tables()
    user_id = (req.user_id or config.LEADFORGE_DEFAULT_USER_ID).strip() or config.LEADFORGE_DEFAULT_USER_ID
    credits = get_credit_summary(user_id=user_id, monthly_limit=config.LEADFORGE_FREE_LEADS_PER_MONTH)
    if int(credits.get('remaining', 0)) <= 0:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "credits_exhausted",
                "message": "No lead credits remaining this month.",
                "credits": credits,
            },
        )
    options = dict(req.options or {})
    requested = int(options.get('max_results') or 30)
    options['max_results'] = max(1, min(requested, int(credits.get('remaining', 0))))
    try:
        run_id = engine.create_run(
            "lead_research",
            {"prompt": prompt, "options": options, "user_id": user_id},
        )
        persist_run_summary(
            run_id=run_id,
            prompt=prompt,
            criteria={"raw_prompt": prompt},
            status="pending",
            user_id=user_id,
        )
        out = await engine.start_run(run_id)
        if not out.get("ok"):
            raise HTTPException(status_code=400, detail=out)
        return {
            "ok": True,
            "run_id": run_id,
            "status": out.get("status", "running"),
            "credits": credits,
            "options": {"max_results": options.get('max_results')},
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc


@router.post("/runs/{run_id}/start")
async def start_run(run_id: str) -> dict[str, Any]:
    engine = get_engine()
    out = await engine.start_run(run_id)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out)
    return out


@router.get("/runs/{run_id}/lead-results")
async def run_lead_results(run_id: str) -> dict[str, Any]:
    run = state_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail={"error": "run_not_found"})
    rows = list_run_leads(run_id)
    try:
        credit_summary = charge_run_credits(run_id, monthly_limit=config.LEADFORGE_FREE_LEADS_PER_MONTH)
    except ValueError:
        credit_summary = get_credit_summary(monthly_limit=config.LEADFORGE_FREE_LEADS_PER_MONTH)
    return {
        "run_id": run_id,
        "total": len(rows),
        "items": rows,
        "summary": {
            "status": run.get("status"),
            "graph_id": run.get("graph_id"),
            "created_at": run.get("created_at"),
            "completed_at": run.get("completed_at"),
            "credits": credit_summary,
        },
    }


@router.get("/runs/{run_id}/evidence")
async def run_lead_evidence(run_id: str) -> dict[str, Any]:
    run = state_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail={"error": "run_not_found"})
    rows = list_run_evidence(run_id)
    return {
        "run_id": run_id,
        "count": len(rows),
        "items": rows,
    }


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
