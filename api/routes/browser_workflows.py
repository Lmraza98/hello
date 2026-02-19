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
from services.web_automation.browser.workflows.recipes import (
    async_workflow_runtime_ms,
    classify_workflow_runtime,
    list_sub_items,
    search_and_extract,
    sync_workflow_timeout_ms,
)
from services.web_automation.browser.workflows.builder import (
    build_annotation_artifacts,
    build_observation_pack,
    synthesize_candidate_from_feedback,
    synthesize_href_pattern_from_feedback,
    validate_extraction_candidate,
)
from services.web_automation.browser.core.workflow import BrowserWorkflow
from services.web_automation.browser.workflows.task_manager import workflow_task_manager

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


class ObservationPackRequest(BaseModel):
    tab_id: str | None = None
    include_screenshot: bool = Field(default=True)
    include_semantic_nodes: bool = Field(default=True)
    semantic_node_limit: int = Field(default=220, ge=20, le=500)


class ValidateCandidateRequest(BaseModel):
    tab_id: str | None = None
    href_contains: list[str] = Field(default_factory=list)
    label_contains_any: list[str] = Field(default_factory=list)
    exclude_label_contains_any: list[str] = Field(default_factory=list)
    role_allowlist: list[str] = Field(default_factory=list)
    must_be_within_roles: list[str] = Field(default_factory=list)
    exclude_within_roles: list[str] = Field(default_factory=list)
    container_hint_contains: list[str] = Field(default_factory=list)
    exclude_container_hint_contains: list[str] = Field(default_factory=list)
    min_items: int = Field(default=1, ge=0, le=500)
    max_items: int = Field(default=200, ge=1, le=1000)
    required_fields: list[str] = Field(default_factory=lambda: ["name", "url"])
    base_domain: str | None = None


class AnnotateCandidateRequest(BaseModel):
    tab_id: str | None = None
    href_contains: list[str] = Field(default_factory=list)
    max_boxes: int = Field(default=40, ge=1, le=120)
    include_screenshot: bool = Field(default=True)


class FeedbackSynthesisRequest(BaseModel):
    tab_id: str | None = None
    boxes: list[dict[str, Any]] = Field(default_factory=list, description="Annotation artifacts returned by annotate-candidate")
    include_box_ids: list[str] = Field(default_factory=list, description="User-confirmed positive boxes")
    exclude_box_ids: list[str] = Field(default_factory=list, description="User-confirmed negative boxes")
    fallback_href_contains: list[str] = Field(default_factory=list)
    required_fields: list[str] = Field(default_factory=lambda: ["name", "url"])
    min_items: int = Field(default=1, ge=0, le=500)
    max_items: int = Field(default=200, ge=1, le=1000)
    base_domain: str | None = None


def _validation_rows_from_observation(observation: dict[str, Any]) -> list[dict[str, Any]]:
    dom = observation.get("dom") if isinstance(observation, dict) else {}
    role_refs = dom.get("role_refs") if isinstance(dom, dict) else []
    semantic_nodes = dom.get("semantic_nodes") if isinstance(dom, dict) else []
    rows: list[dict[str, Any]] = []

    if isinstance(role_refs, list):
        for row in role_refs:
            if not isinstance(row, dict):
                continue
            rows.append(
                {
                    "href": row.get("href") or row.get("url") or "",
                    "label": row.get("label") or row.get("text") or "",
                    "role": row.get("role") or "",
                    "landmark_role": row.get("landmark_role") or "",
                    "container_hint": row.get("container_hint") or "",
                }
            )

    if isinstance(semantic_nodes, list):
        for row in semantic_nodes:
            if not isinstance(row, dict):
                continue
            href = row.get("href") or row.get("url") or ""
            if not href:
                continue
            rows.append(
                {
                    "href": href,
                    "label": row.get("label") or row.get("text") or "",
                    "role": row.get("role") or row.get("tag") or "",
                    "landmark_role": row.get("landmark_role") or "",
                    "container_hint": row.get("container_hint") or "",
                }
            )
    return rows


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


@router.post("/observation-pack", responses=COMMON_ERROR_RESPONSES)
async def browser_observation_pack(req: ObservationPackRequest) -> Any:
    try:
        wf = BrowserWorkflow(tab_id=req.tab_id)
        observation = await build_observation_pack(
            wf,
            include_screenshot=bool(req.include_screenshot),
            include_semantic_nodes=bool(req.include_semantic_nodes),
            semantic_node_limit=req.semantic_node_limit,
        )
        return {
            "ok": True,
            "tab_id": wf.tab_id,
            "observation": observation,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/validate-candidate", responses=COMMON_ERROR_RESPONSES)
async def browser_validate_candidate(req: ValidateCandidateRequest) -> Any:
    try:
        wf = BrowserWorkflow(tab_id=req.tab_id)
        observation = await build_observation_pack(
            wf,
            include_screenshot=False,
            include_semantic_nodes=True,
            semantic_node_limit=220,
        )
        refs = _validation_rows_from_observation(observation if isinstance(observation, dict) else {})
        domain = str(observation.get("domain") or "")
        validation = validate_extraction_candidate(
            refs,
            href_contains=req.href_contains,
            label_contains_any=req.label_contains_any,
            exclude_label_contains_any=req.exclude_label_contains_any,
            role_allowlist=req.role_allowlist,
            must_be_within_roles=req.must_be_within_roles,
            exclude_within_roles=req.exclude_within_roles,
            container_hint_contains=req.container_hint_contains,
            exclude_container_hint_contains=req.exclude_container_hint_contains,
            min_items=req.min_items,
            max_items=req.max_items,
            required_fields=req.required_fields,
            base_domain=(req.base_domain or domain or None),
        )
        return {
            "ok": True,
            "tab_id": wf.tab_id,
            "candidate_validation": validation,
            "observation_summary": {
                "url": observation.get("url"),
                "domain": observation.get("domain"),
                "page_mode": observation.get("page_mode"),
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/annotate-candidate", responses=COMMON_ERROR_RESPONSES)
async def browser_annotate_candidate(req: AnnotateCandidateRequest) -> Any:
    try:
        wf = BrowserWorkflow(tab_id=req.tab_id)
        artifacts = await build_annotation_artifacts(
            wf,
            href_contains=req.href_contains,
            max_boxes=req.max_boxes,
            include_screenshot=bool(req.include_screenshot),
        )
        return {
            "ok": True,
            "tab_id": wf.tab_id,
            "annotation": artifacts,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/synthesize-from-feedback", responses=COMMON_ERROR_RESPONSES)
async def browser_synthesize_from_feedback(req: FeedbackSynthesisRequest) -> Any:
    try:
        include_ids = {str(x) for x in req.include_box_ids}
        exclude_ids = {str(x) for x in req.exclude_box_ids}
        include_hrefs: list[str] = []
        exclude_hrefs: list[str] = []
        include_boxes: list[dict[str, Any]] = []
        exclude_boxes: list[dict[str, Any]] = []
        for row in req.boxes:
            if not isinstance(row, dict):
                continue
            box_id = str(row.get("box_id") or "")
            href = str(row.get("href") or "").strip()
            if not box_id or not href:
                if not box_id:
                    continue
            if box_id in include_ids:
                if href:
                    include_hrefs.append(href)
                include_boxes.append(row)
            if box_id in exclude_ids:
                if href:
                    exclude_hrefs.append(href)
                exclude_boxes.append(row)

        suggested_pattern = synthesize_href_pattern_from_feedback(
            include_hrefs=include_hrefs,
            exclude_hrefs=exclude_hrefs,
            fallback_patterns=req.fallback_href_contains,
        )
        suggested_candidate = synthesize_candidate_from_feedback(
            include_boxes=include_boxes,
            exclude_boxes=exclude_boxes,
            fallback_patterns=req.fallback_href_contains,
        )

        wf = BrowserWorkflow(tab_id=req.tab_id)
        observation = await build_observation_pack(
            wf,
            include_screenshot=False,
            include_semantic_nodes=True,
            semantic_node_limit=220,
        )
        refs = _validation_rows_from_observation(observation if isinstance(observation, dict) else {})
        domain = str(observation.get("domain") or "")
        validation = validate_extraction_candidate(
            refs,
            href_contains=suggested_candidate.get("href_contains") if isinstance(suggested_candidate, dict) else ([suggested_pattern] if suggested_pattern else []),
            label_contains_any=suggested_candidate.get("label_contains_any") if isinstance(suggested_candidate, dict) else [],
            exclude_label_contains_any=suggested_candidate.get("exclude_label_contains_any") if isinstance(suggested_candidate, dict) else [],
            role_allowlist=suggested_candidate.get("role_allowlist") if isinstance(suggested_candidate, dict) else [],
            must_be_within_roles=suggested_candidate.get("must_be_within_roles") if isinstance(suggested_candidate, dict) else [],
            exclude_within_roles=suggested_candidate.get("exclude_within_roles") if isinstance(suggested_candidate, dict) else [],
            container_hint_contains=suggested_candidate.get("container_hint_contains") if isinstance(suggested_candidate, dict) else [],
            exclude_container_hint_contains=suggested_candidate.get("exclude_container_hint_contains") if isinstance(suggested_candidate, dict) else [],
            min_items=req.min_items,
            max_items=req.max_items,
            required_fields=req.required_fields,
            base_domain=(req.base_domain or domain or None),
        )
        return {
            "ok": True,
            "tab_id": wf.tab_id,
            "suggested_href_contains": [suggested_pattern] if suggested_pattern else [],
            "suggested_candidate": suggested_candidate,
            "feedback_stats": {
                "include_count": len(include_hrefs),
                "exclude_count": len(exclude_hrefs),
            },
            "candidate_validation": validation,
            "observation_summary": {
                "url": observation.get("url"),
                "domain": observation.get("domain"),
                "page_mode": observation.get("page_mode"),
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
