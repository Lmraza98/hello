"""Generic workflow endpoints for skill-driven browser automation.

These routes expose reusable workflow recipes (search/extract, list sub-items)
that work for any website skill by providing:
- task name (skill task)
- generic workflow parameters
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.routes._helpers import COMMON_ERROR_RESPONSES
from services.browser_workflows.recipes import (
    async_workflow_runtime_ms,
    classify_workflow_runtime,
    list_sub_items,
    search_and_extract,
    sync_workflow_timeout_ms,
)
from services.browser_workflows.task_manager import workflow_task_manager

router = APIRouter(prefix="/api/browser/workflows", tags=["browser-workflows"])


def _env_enabled(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name, str(default)).strip().lower())
    return raw in {"1", "true", "yes", "y", "on"}


def _website_for_task(task: str | None) -> str:
    t = (task or "").strip().lower()
    if "salesnav" in t or "linkedin" in t:
        return "linkedin.com"
    if t:
        return t.split("_", 1)[0]
    return "default"


async def _run_sync_task(*, operation: str, diagnostics: dict[str, Any], runner) -> Any:
    task_id = await workflow_task_manager.start_inline(
        stage="running",
        progress_pct=10,
        diagnostics={"task_type": "browser_workflow_sync", "operation": operation, **diagnostics},
    )
    try:
        result = await runner()
        result_payload = result if isinstance(result, dict) else {"result": result}
        await workflow_task_manager.finish_inline(
            task_id,
            stage="finished",
            progress_pct=100,
            result=result_payload,
        )
        if isinstance(result, dict):
            out = dict(result)
            out.setdefault("task_id", task_id)
            out.setdefault("task_status", "finished")
            return out
        return {"ok": True, "task_id": task_id, "task_status": "finished", "result": result}
    except asyncio.TimeoutError:
        await workflow_task_manager.fail_inline(
            task_id,
            code="workflow_timeout",
            message=f"Workflow timed out after {sync_workflow_timeout_ms()}ms.",
            retry_suggestion="Retry with a smaller limit or fewer filters.",
            stage="failed",
        )
        return {
            "ok": False,
            "status": "failed",
            "task_id": task_id,
            "task_status": "failed",
            "error": {
                "code": "workflow_timeout",
                "message": f"Workflow timed out after {sync_workflow_timeout_ms()}ms.",
                "retry_suggestion": "Retry with a smaller limit or fewer filters.",
            },
        }
    except Exception as exc:
        await workflow_task_manager.fail_inline(
            task_id,
            code="workflow_failed",
            message=str(exc),
            retry_suggestion="Retry as a short task or continue manually in the open browser tab.",
            stage="failed",
        )
        raise


class SearchAndExtractRequest(BaseModel):
    task: str = Field(description="Skill task name (e.g. salesnav_search_account)")
    query: str = Field(description="Search query/keywords to enter")
    # Accept any JSON values; we coerce into string values at runtime (models often emit [] for empty filters).
    filters: dict[str, Any] | None = Field(default=None, description="Optional filters by name -> value")
    click_target: str | None = Field(default=None, description="Optional item name to click/navigate to after extraction")
    extract_type: str | None = Field(
        default=None,
        description="Extraction kind (optional; auto-detected from skill when omitted)",
    )
    tab_id: str | None = None
    limit: int = Field(default=25, ge=1, le=200)
    wait_ms: int = Field(default=1500, ge=0, le=30_000)


class ListSubItemsRequest(BaseModel):
    task: str = Field(description="Skill task name for the sub-items view (e.g. salesnav_list_employees)")
    tab_id: str | None = None
    parent_query: str | None = Field(default=None, description="Optional parent name to search/click before listing sub-items")
    parent_task: str | None = Field(default=None, description="Optional parent task used to find the parent (e.g. salesnav_search_account)")
    parent_filters: dict[str, Any] | None = Field(default=None, description="Optional filters for the parent search step")
    entrypoint_action: str = Field(default="entrypoint", description="Action name to open the sub-items page (skill Action Hint)")
    extract_type: str = Field(default="lead", description="Extraction kind for sub-items (lead, person, ...)")
    limit: int = Field(default=100, ge=1, le=200)
    wait_ms: int = Field(default=1200, ge=0, le=30_000)


@router.post("/search-and-extract", responses=COMMON_ERROR_RESPONSES)
async def browser_search_and_extract(req: SearchAndExtractRequest) -> Any:
    try:
        def _resolve_first_string(value: Any) -> str | None:
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and item.strip():
                        return item.strip()
            return None

        def _coerce_filters(raw: dict[str, Any] | None, *, preserve_structured: bool = False) -> dict[str, Any] | None:
            if not isinstance(raw, dict) or not raw:
                return None
            out: dict[str, Any] = {}
            for k, v in raw.items():
                key = str(k or "").strip()
                if not key:
                    continue
                if v is None:
                    continue
                if isinstance(v, list) and len(v) == 0:
                    continue
                if preserve_structured:
                    if isinstance(v, list):
                        cleaned_list = [str(item).strip() for item in v if str(item).strip()]
                        if cleaned_list:
                            out[key] = cleaned_list
                        continue
                    if isinstance(v, dict):
                        continue
                s = _resolve_first_string(v)
                if s is None:
                    # Accept scalars (bool/number) as strings, ignore dicts/objects.
                    if isinstance(v, (int, float, bool)):
                        s = str(v)
                    else:
                        continue
                if s.strip():
                    out[key] = s.strip()
            return out or None

        preserve_structured_filters = str(req.task or "").strip().lower().startswith("salesnav_")
        filters = _coerce_filters(req.filters, preserve_structured=preserve_structured_filters)
        runtime = classify_workflow_runtime(query=req.query, filters=filters, limit=req.limit, task=req.task)

        async_enabled = _env_enabled("BROWSER_WORKFLOW_ASYNC_ENABLED", default=True)
        if async_enabled and bool(runtime.get("is_long")):
            timeout_ms = async_workflow_runtime_ms()

            async def _job(progress_cb):
                return await search_and_extract(
                    task=req.task,
                    query=req.query,
                    filter_values=filters,
                    click_target=req.click_target,
                    extract_type=req.extract_type,
                    tab_id=req.tab_id,
                    limit=req.limit,
                    wait_ms=req.wait_ms,
                    progress_cb=progress_cb,
                )

            task_id = await workflow_task_manager.submit(
                coro_factory=_job,
                timeout_ms=timeout_ms,
                diagnostics={
                    "task_type": "browser_workflow_async",
                    "operation": "browser_search_and_extract",
                    "website": _website_for_task(req.task),
                    "runtime": runtime,
                    "task": req.task,
                    "goal": req.query.strip() if isinstance(req.query, str) else "",
                    "limit": req.limit,
                    "tab_id": req.tab_id,
                },
            )
            return {
                "ok": True,
                "status": "pending",
                "task_id": task_id,
                "progress_pct": 0,
                "stage": "pending",
                "runtime_class": runtime,
                "note": f"Long task running in background. Check status with task_id={task_id}.",
            }

        return await _run_sync_task(
            operation="browser_search_and_extract",
            diagnostics={
                "task": req.task,
                "goal": req.query.strip() if isinstance(req.query, str) else "",
                "limit": req.limit,
                "tab_id": req.tab_id,
                "runtime": runtime,
            },
            runner=lambda: asyncio.wait_for(
                search_and_extract(
                    task=req.task,
                    query=req.query,
                    filter_values=filters,
                    click_target=req.click_target,
                    extract_type=req.extract_type,
                    tab_id=req.tab_id,
                    limit=req.limit,
                    wait_ms=req.wait_ms,
                    progress_cb=None,
                ),
                timeout=max(1, int(sync_workflow_timeout_ms())) / 1000.0,
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/list-sub-items", responses=COMMON_ERROR_RESPONSES)
async def browser_list_sub_items(req: ListSubItemsRequest) -> Any:
    try:
        def _resolve_first_string(value: Any) -> str | None:
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and item.strip():
                        return item.strip()
            return None

        def _coerce_filters(raw: dict[str, Any] | None, *, preserve_structured: bool = False) -> dict[str, Any] | None:
            if not isinstance(raw, dict) or not raw:
                return None
            out: dict[str, Any] = {}
            for k, v in raw.items():
                key = str(k or "").strip()
                if not key:
                    continue
                if v is None:
                    continue
                if isinstance(v, list) and len(v) == 0:
                    continue
                if preserve_structured:
                    if isinstance(v, list):
                        cleaned_list = [str(item).strip() for item in v if str(item).strip()]
                        if cleaned_list:
                            out[key] = cleaned_list
                        continue
                    if isinstance(v, dict):
                        continue
                s = _resolve_first_string(v)
                if s is None:
                    if isinstance(v, (int, float, bool)):
                        s = str(v)
                    else:
                        continue
                if s.strip():
                    out[key] = s.strip()
            return out or None

        preserve_structured_filters = str(req.parent_task or req.task or "").strip().lower().startswith("salesnav_")
        parent_filters = _coerce_filters(req.parent_filters, preserve_structured=preserve_structured_filters)
        runtime = classify_workflow_runtime(
            query=req.parent_query or "",
            filters=parent_filters,
            limit=req.limit,
            task=req.task,
        )
        async_enabled = _env_enabled("BROWSER_WORKFLOW_ASYNC_ENABLED", default=True)
        if async_enabled and bool(runtime.get("is_long")):
            timeout_ms = async_workflow_runtime_ms()

            async def _job(progress_cb):
                return await list_sub_items(
                    task=req.task,
                    tab_id=req.tab_id,
                    parent_query=req.parent_query,
                    parent_task=req.parent_task,
                    parent_filter_values=parent_filters,
                    entrypoint_action=req.entrypoint_action,
                    extract_type=req.extract_type,
                    limit=req.limit,
                    wait_ms=req.wait_ms,
                    progress_cb=progress_cb,
                )

            task_id = await workflow_task_manager.submit(
                coro_factory=_job,
                timeout_ms=timeout_ms,
                diagnostics={
                    "task_type": "browser_workflow_async",
                    "operation": "browser_list_sub_items",
                    "website": _website_for_task(req.task),
                    "runtime": runtime,
                    "task": req.task,
                    "goal": (req.parent_query or req.task or "").strip(),
                    "limit": req.limit,
                    "tab_id": req.tab_id,
                },
            )
            return {
                "ok": True,
                "status": "pending",
                "task_id": task_id,
                "progress_pct": 0,
                "stage": "pending",
                "runtime_class": runtime,
                "note": f"Long task running in background. Check status with task_id={task_id}.",
            }

        return await _run_sync_task(
            operation="browser_list_sub_items",
            diagnostics={
                "task": req.task,
                "goal": (req.parent_query or req.task or "").strip(),
                "limit": req.limit,
                "tab_id": req.tab_id,
                "runtime": runtime,
            },
            runner=lambda: asyncio.wait_for(
                list_sub_items(
                    task=req.task,
                    tab_id=req.tab_id,
                    parent_query=req.parent_query,
                    parent_task=req.parent_task,
                    parent_filter_values=parent_filters,
                    entrypoint_action=req.entrypoint_action,
                    extract_type=req.extract_type,
                    limit=req.limit,
                    wait_ms=req.wait_ms,
                    progress_cb=None,
                ),
                timeout=max(1, int(sync_workflow_timeout_ms())) / 1000.0,
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/status/{task_id}", responses=COMMON_ERROR_RESPONSES)
async def browser_workflow_status(task_id: str) -> Any:
    task = await workflow_task_manager.get(task_id)
    if task is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "task_not_found", "message": f"Unknown workflow task_id: {task_id}"},
        )
    return task


@router.get("/tasks", responses=COMMON_ERROR_RESPONSES)
async def browser_workflow_tasks(
    include_finished: bool = True,
    limit: int = 200,
) -> Any:
    rows = await workflow_task_manager.list(include_finished=bool(include_finished), limit=limit)
    return {
        "ok": True,
        "count": len(rows),
        "tasks": rows,
    }
