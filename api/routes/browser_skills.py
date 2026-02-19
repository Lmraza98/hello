"""API routes for markdown-backed browser website skills."""

from __future__ import annotations

import datetime as dt
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.web_automation.browser.skills.store import (
    append_repair_note,
    delete_skill,
    get_skill,
    list_skills,
    match_skill,
    update_skill_frontmatter,
    upsert_skill,
)
from services.web_automation.browser.workflows.regression import run_skill_regression_suite

router = APIRouter(prefix="/api/browser/skills", tags=["browser-skills"])


class BrowserSkillUpsertRequest(BaseModel):
    content: str = Field(min_length=1)


class BrowserSkillMatchRequest(BaseModel):
    url: str | None = None
    task: str | None = None
    query: str | None = None
    observation: dict[str, Any] | None = None


class BrowserSkillRepairRequest(BaseModel):
    issue: str = Field(min_length=1)
    context: dict[str, Any] | None = None
    action: str | None = None
    role: str | None = None
    text: str | None = None


class BrowserSkillRegressionRunRequest(BaseModel):
    tab_id: str | None = None
    limit_tests: int | None = Field(default=None, ge=1, le=50)


class BrowserSkillPromoteRequest(BaseModel):
    tab_id: str | None = None
    limit_tests: int | None = Field(default=None, ge=1, le=50)
    require_zero_failures: bool = True
    dry_run: bool = False


@router.get("")
def list_browser_skills(url: str | None = None, task: str | None = None, query: str | None = None):
    skills = list_skills()
    best = match_skill(url=url, task=task, query=query) if (url or task or query) else None
    return {"skills": skills, "best_match": best}


@router.post("/match")
def match_browser_skill(req: BrowserSkillMatchRequest):
    matched = match_skill(url=req.url, task=req.task, query=req.query, observation=req.observation)
    return {"match": matched}


@router.get("/{skill_id}")
def get_browser_skill(skill_id: str):
    skill = get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail={"code": "skill_not_found", "message": f"Unknown skill: {skill_id}"})
    return skill


@router.put("/{skill_id}")
def put_browser_skill(skill_id: str, req: BrowserSkillUpsertRequest):
    try:
        skill = upsert_skill(skill_id, req.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_skill", "message": str(exc)}) from exc
    return {"ok": True, "skill": skill}


@router.delete("/{skill_id}")
def remove_browser_skill(skill_id: str):
    deleted = delete_skill(skill_id)
    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "skill_not_found", "message": f"Unknown skill: {skill_id}"})
    return {"ok": True}


@router.post("/{skill_id}/repair")
def repair_browser_skill(skill_id: str, req: BrowserSkillRepairRequest):
    try:
        skill = append_repair_note(
            skill_id,
            req.issue,
            context=req.context,
            action=req.action,
            role=req.role,
            text=req.text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"code": "skill_not_found", "message": str(exc)}) from exc
    return {"ok": True, "skill": skill}


@router.post("/{skill_id}/regression-run")
async def run_browser_skill_regression(skill_id: str, req: BrowserSkillRegressionRunRequest):
    result = await run_skill_regression_suite(
        skill_id=skill_id,
        tab_id=req.tab_id,
        limit_tests=req.limit_tests,
    )
    if not result.get("ok"):
        error = result.get("error") if isinstance(result.get("error"), dict) else {}
        code = str(error.get("code") or "regression_failed")
        message = str(error.get("message") or "Failed to run skill regression.")
        status = 404 if code == "skill_not_found" else 400
        raise HTTPException(status_code=status, detail={"code": code, "message": message})
    return result


@router.post("/{skill_id}/promote")
async def promote_browser_skill(skill_id: str, req: BrowserSkillPromoteRequest):
    result = await run_skill_regression_suite(
        skill_id=skill_id,
        tab_id=req.tab_id,
        limit_tests=req.limit_tests,
    )
    if not result.get("ok"):
        error = result.get("error") if isinstance(result.get("error"), dict) else {}
        code = str(error.get("code") or "promotion_failed")
        message = str(error.get("message") or "Failed to run regression suite for promotion.")
        status = 404 if code == "skill_not_found" else 400
        raise HTTPException(status_code=status, detail={"code": code, "message": message})

    gate = result.get("promotion_gate") if isinstance(result.get("promotion_gate"), dict) else {}
    ready = bool(gate.get("ready_for_promotion"))
    if bool(req.require_zero_failures) and not ready:
        return {
            "ok": False,
            "skill_id": skill_id,
            "promoted": False,
            "gate": gate,
            "regression": result,
            "message": "Promotion blocked: regression gate failed.",
        }

    if bool(req.dry_run):
        return {
            "ok": True,
            "skill_id": skill_id,
            "promoted": False,
            "dry_run": True,
            "gate": gate,
            "regression": result,
            "message": "Dry run completed. No skill metadata was updated.",
        }

    now = dt.datetime.now(tz=dt.timezone.utc).isoformat()
    updates = {
        "qa_status": "ready" if ready else "blocked",
        "last_regression_at": now,
        "last_regression_total": int(result.get("total") or 0),
        "last_regression_passes": int(result.get("passes") or 0),
        "last_regression_failures": int(result.get("failures") or 0),
    }
    skill = update_skill_frontmatter(skill_id, updates)
    return {
        "ok": True,
        "skill_id": skill_id,
        "promoted": ready,
        "gate": gate,
        "regression": result,
        "skill": skill,
    }
