"""API routes for markdown-backed browser website skills."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.browser_skills.store import (
    append_repair_note,
    delete_skill,
    get_skill,
    list_skills,
    match_skill,
    upsert_skill,
)

router = APIRouter(prefix="/api/browser/skills", tags=["browser-skills"])


class BrowserSkillUpsertRequest(BaseModel):
    content: str = Field(min_length=1)


class BrowserSkillMatchRequest(BaseModel):
    url: str | None = None
    task: str | None = None
    query: str | None = None


class BrowserSkillRepairRequest(BaseModel):
    issue: str = Field(min_length=1)
    context: dict[str, Any] | None = None
    action: str | None = None
    role: str | None = None
    text: str | None = None


@router.get("")
def list_browser_skills(url: str | None = None, task: str | None = None, query: str | None = None):
    skills = list_skills()
    best = match_skill(url=url, task=task, query=query) if (url or task or query) else None
    return {"skills": skills, "best_match": best}


@router.post("/match")
def match_browser_skill(req: BrowserSkillMatchRequest):
    matched = match_skill(url=req.url, task=req.task, query=req.query)
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

