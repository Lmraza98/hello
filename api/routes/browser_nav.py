"""Browser navigation API.

This module is intentionally thin: it exposes FastAPI routes and delegates all
browser work to a backend implementation selected by `BROWSER_GATEWAY_MODE`.

Backends live under `services/browser_backends/`.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.browser_backends.factory import get_browser_backend
from services.browser_workflows.task_manager import workflow_task_manager


router = APIRouter(prefix="/api/browser", tags=["browser"])


class BrowserNavigateRequest(BaseModel):
    url: str
    tab_id: str | None = None
    timeout_ms: int | None = Field(default=None, ge=1000, le=120000)


class BrowserSnapshotRequest(BaseModel):
    tab_id: str | None = None
    mode: str | None = Field(default=None, description="snapshot mode: role or ai")


class BrowserActRequest(BaseModel):
    ref: str | int | None = None
    action: str
    value: str | None = None
    tab_id: str | None = None


class BrowserFindRefRequest(BaseModel):
    text: str
    role: str | None = None
    tab_id: str | None = None
    timeout_ms: int = Field(default=8000, ge=0, le=30000)
    poll_ms: int = Field(default=400, ge=100, le=2000)


class BrowserWaitRequest(BaseModel):
    ms: int = Field(default=1000, ge=0, le=120000)
    tab_id: str | None = None


class BrowserScreenshotRequest(BaseModel):
    tab_id: str | None = None
    full_page: bool | None = None


async def _run_browser_task(
    *,
    operation: str,
    stage: str,
    diagnostics: dict[str, Any] | None,
    runner,
) -> Any:
    task_id = await workflow_task_manager.start_inline(
        stage=stage,
        progress_pct=10,
        diagnostics={"task_type": "browser_automation", "operation": operation, **(diagnostics or {})},
    )
    try:
        out = await runner()
        await workflow_task_manager.finish_inline(
            task_id,
            stage="finished",
            progress_pct=100,
            result=out if isinstance(out, dict) else {"result": out},
        )
        if isinstance(out, dict):
            payload = dict(out)
            payload.setdefault("task_id", task_id)
            payload.setdefault("task_status", "finished")
            return payload
        return {"ok": True, "task_id": task_id, "task_status": "finished", "result": out}
    except Exception as exc:
        await workflow_task_manager.fail_inline(
            task_id,
            code="browser_task_failed",
            message=str(exc),
            retry_suggestion="Retry the task, or open the Tasks page and continue manually in the live browser tab.",
            stage="failed",
            progress_pct=100,
        )
        raise


def _website_from_url(url: str | None) -> str:
    raw = str(url or "").strip()
    if not raw:
        return "default"
    try:
        host = urlparse(raw).netloc.strip().lower()
    except Exception:
        host = ""
    return host or "default"


@router.get("/health")
async def browser_health() -> Any:
    return await get_browser_backend().health()


@router.get("/tabs")
async def browser_tabs() -> Any:
    return await get_browser_backend().tabs()


@router.post("/navigate")
async def browser_navigate(req: BrowserNavigateRequest) -> Any:
    return await _run_browser_task(
        operation="browser_navigate",
        stage="navigating",
        diagnostics={
            "goal": f"Navigate to {req.url}",
            "tab_id": req.tab_id,
            "url": req.url,
            "timeout_ms": req.timeout_ms,
            "website": _website_from_url(req.url),
        },
        runner=lambda: get_browser_backend().navigate(url=req.url, tab_id=req.tab_id, timeout_ms=req.timeout_ms),
    )


@router.post("/snapshot")
async def browser_snapshot(req: BrowserSnapshotRequest) -> Any:
    return await _run_browser_task(
        operation="browser_snapshot",
        stage="snapshot",
        diagnostics={"goal": "Capture page snapshot", "tab_id": req.tab_id, "mode": req.mode},
        runner=lambda: get_browser_backend().snapshot(tab_id=req.tab_id, mode=req.mode),
    )


@router.post("/find_ref")
async def browser_find_ref(req: BrowserFindRefRequest) -> Any:
    return await _run_browser_task(
        operation="browser_find_ref",
        stage="find_ref",
        diagnostics={"goal": f"Find page element: {req.text}", "tab_id": req.tab_id, "text": req.text, "role": req.role},
        runner=lambda: get_browser_backend().find_ref(
            text=req.text,
            role=req.role,
            tab_id=req.tab_id,
            timeout_ms=req.timeout_ms,
            poll_ms=req.poll_ms,
        ),
    )


@router.post("/act")
async def browser_act(req: BrowserActRequest) -> Any:
    return await _run_browser_task(
        operation="browser_act",
        stage="acting",
        diagnostics={
            "goal": f"Perform browser action: {req.action}",
            "tab_id": req.tab_id,
            "action": req.action,
        },
        runner=lambda: get_browser_backend().act(
            action=req.action,
            ref=req.ref,
            value=req.value,
            tab_id=req.tab_id,
        ),
    )


@router.post("/wait")
async def browser_wait(req: BrowserWaitRequest) -> Any:
    return await _run_browser_task(
        operation="browser_wait",
        stage="waiting",
        diagnostics={"goal": f"Wait {req.ms}ms", "tab_id": req.tab_id, "wait_ms": req.ms},
        runner=lambda: get_browser_backend().wait(ms=req.ms, tab_id=req.tab_id),
    )


@router.post("/screenshot")
async def browser_screenshot(req: BrowserScreenshotRequest) -> Any:
    return await _run_browser_task(
        operation="browser_screenshot",
        stage="screenshot",
        diagnostics={"goal": "Capture screenshot", "tab_id": req.tab_id, "full_page": req.full_page},
        runner=lambda: get_browser_backend().screenshot(tab_id=req.tab_id, full_page=req.full_page),
    )
