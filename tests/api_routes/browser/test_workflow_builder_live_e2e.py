from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

import pytest


def _request(base_url: str, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url=url, method=method, data=data)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed: HTTP {exc.code} {body}") from exc


def _request_best_effort(base_url: str, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    try:
        return _request(base_url, method, path, payload)
    except Exception:
        return None


def _pick_first_href(rows: list[dict[str, Any]]) -> str:
    for row in rows:
        href = str(row.get("href") or "").strip()
        if not href:
            continue
        parsed = urllib.parse.urlparse(href)
        if parsed.path and parsed.path != "/":
            first = parsed.path.split("/")[1] if len(parsed.path.split("/")) > 1 else ""
            if first:
                return f"/{first}/"
    return "/"


@dataclass
class _LiveCtx:
    tab_id: str = ""
    refs: list[dict[str, Any]] | None = None
    href_pattern: str = "/"
    boxes: list[dict[str, Any]] | None = None


@pytest.fixture
def base_url() -> str:
    return os.getenv("WORKFLOW_BUILDER_LIVE_BASE_URL", "http://127.0.0.1:8000")


@pytest.fixture
def preferred_tab_id() -> str:
    return os.getenv("WORKFLOW_BUILDER_LIVE_TAB_ID", "").strip()


@pytest.fixture
def seed_url() -> str:
    # Public page with stable link-rich content for observation/annotation.
    return os.getenv("WORKFLOW_BUILDER_LIVE_SEED_URL", "https://news.ycombinator.com/").strip()


@pytest.fixture
def auto_cleanup_enabled() -> bool:
    raw = os.getenv("WORKFLOW_BUILDER_LIVE_AUTO_CLEANUP", "1").strip().lower()
    return raw in {"1", "true", "yes", "on"}


@pytest.fixture(autouse=True)
def _cleanup_after_test(base_url: str, auto_cleanup_enabled: bool):
    yield
    if not auto_cleanup_enabled:
        return
    _request_best_effort(base_url, "POST", "/api/browser/shutdown", {})
    _request_best_effort(base_url, "POST", "/api/admin/launcher/stop", {"mode": "terminate_workers"})


def _run_tabs(base_url: str, preferred_tab_id: str, ctx: _LiveCtx) -> _LiveCtx:
    tabs = _request(base_url, "GET", "/api/browser/tabs")
    tab_rows = tabs.get("tabs") if isinstance(tabs, dict) else None
    assert isinstance(tab_rows, list) and tab_rows, "no tabs available from /api/browser/tabs"
    tab_id = preferred_tab_id or str(tab_rows[0].get("id") or "")
    assert tab_id, "could not determine tab_id"
    ctx.tab_id = tab_id
    return ctx


def _run_observation_pack(base_url: str, preferred_tab_id: str, seed_url: str, ctx: _LiveCtx) -> _LiveCtx:
    tabs = _request(base_url, "GET", "/api/browser/tabs")
    tab_rows = tabs.get("tabs") if isinstance(tabs, dict) else None
    assert isinstance(tab_rows, list) and tab_rows, "no tabs available from /api/browser/tabs"

    candidate_tab_ids: list[str] = []
    if preferred_tab_id:
        candidate_tab_ids.append(preferred_tab_id)
    candidate_tab_ids.extend(
        [str(row.get("id") or "") for row in tab_rows if isinstance(row, dict) and str(row.get("id") or "").strip()]
    )
    # Keep order but dedupe.
    seen: set[str] = set()
    ordered_tab_ids: list[str] = []
    for tab_id in candidate_tab_ids:
        if tab_id and tab_id not in seen:
            seen.add(tab_id)
            ordered_tab_ids.append(tab_id)

    best_refs: list[dict[str, Any]] = []
    best_tab_id = ""
    best_obs: dict[str, Any] | None = None
    for tab_id in ordered_tab_ids:
        obs = _request(
            base_url,
            "POST",
            "/api/browser/workflows/observation-pack",
            {"tab_id": tab_id, "include_screenshot": False, "include_semantic_nodes": True},
        )
        observation = obs.get("observation") if isinstance(obs, dict) else None
        if not isinstance(observation, dict):
            continue
        dom = observation.get("dom") if isinstance(observation.get("dom"), dict) else {}
        refs = dom.get("role_refs") if isinstance(dom.get("role_refs"), list) else []
        typed_refs = [r for r in refs if isinstance(r, dict)]
        if len(typed_refs) > len(best_refs):
            best_refs = typed_refs
            best_tab_id = tab_id
            best_obs = observation
        if typed_refs:
            ctx.tab_id = tab_id
            ctx.refs = typed_refs
            ctx.href_pattern = _pick_first_href(typed_refs)
            return ctx

    # No suitable tab state found; self-heal by navigating a tab to seed_url.
    target_tab_id = best_tab_id or (ordered_tab_ids[0] if ordered_tab_ids else "")
    if target_tab_id and seed_url:
        nav = _request(
            base_url,
            "POST",
            "/api/browser/navigate",
            {"url": seed_url, "tab_id": target_tab_id, "timeout_ms": 45000},
        )
        _request(base_url, "POST", "/api/browser/wait", {"tab_id": target_tab_id, "ms": 1800})
        obs = _request(
            base_url,
            "POST",
            "/api/browser/workflows/observation-pack",
            {"tab_id": target_tab_id, "include_screenshot": False, "include_semantic_nodes": True},
        )
        observation = obs.get("observation") if isinstance(obs, dict) else None
        dom = observation.get("dom") if isinstance(observation, dict) and isinstance(observation.get("dom"), dict) else {}
        refs = dom.get("role_refs") if isinstance(dom.get("role_refs"), list) else []
        typed_refs = [r for r in refs if isinstance(r, dict)]
        if typed_refs:
            ctx.tab_id = str(nav.get("tab_id") or target_tab_id)
            ctx.refs = typed_refs
            ctx.href_pattern = _pick_first_href(typed_refs)
            return ctx

    preview = str(best_obs.get("url") or "") if isinstance(best_obs, dict) else ""
    pytest.skip(
        "workflow-builder live precondition not met after auto-navigation: no role_refs. "
        f"seed_url={seed_url or 'n/a'} tab={target_tab_id or 'n/a'} url={preview or 'n/a'}"
    )
    return ctx


def _run_validate_candidate(base_url: str, preferred_tab_id: str, seed_url: str, ctx: _LiveCtx) -> _LiveCtx:
    ctx = _run_observation_pack(base_url, preferred_tab_id, seed_url, ctx)
    val = _request(
        base_url,
        "POST",
        "/api/browser/workflows/validate-candidate",
        {
            "tab_id": ctx.tab_id,
            "href_contains": [ctx.href_pattern] if ctx.href_pattern else [],
            "min_items": 1,
            "max_items": 200,
            "required_fields": ["name", "url"],
        },
    )
    candidate_validation = val.get("candidate_validation") if isinstance(val, dict) else None
    assert isinstance(candidate_validation, dict), "validate-candidate missing candidate_validation"
    assert isinstance(candidate_validation.get("fit_score"), (int, float)), "fit_score missing"
    return ctx


def _run_annotate_candidate(base_url: str, preferred_tab_id: str, seed_url: str, ctx: _LiveCtx) -> _LiveCtx:
    ctx = _run_validate_candidate(base_url, preferred_tab_id, seed_url, ctx)
    ann = _request(
        base_url,
        "POST",
        "/api/browser/workflows/annotate-candidate",
        {
            "tab_id": ctx.tab_id,
            "href_contains": [ctx.href_pattern] if ctx.href_pattern else [],
            "max_boxes": 40,
            "include_screenshot": True,
        },
    )
    annotation = ann.get("annotation") if isinstance(ann, dict) else None
    boxes = annotation.get("boxes") if isinstance(annotation, dict) and isinstance(annotation.get("boxes"), list) else []
    if not boxes:
        pytest.skip("annotate-candidate returned zero boxes for current page state; open a list-like page with candidates.")
    ctx.boxes = [b for b in boxes if isinstance(b, dict)]
    return ctx


def _run_synthesize_from_feedback(base_url: str, preferred_tab_id: str, seed_url: str, ctx: _LiveCtx) -> _LiveCtx:
    ctx = _run_annotate_candidate(base_url, preferred_tab_id, seed_url, ctx)
    assert ctx.boxes, "missing annotation boxes for synthesis"
    include_box_id = str((ctx.boxes[0] if isinstance(ctx.boxes[0], dict) else {}).get("box_id") or "")
    assert include_box_id, "first annotation box has no box_id"
    exclude_box_id = ""
    if len(ctx.boxes) > 1 and isinstance(ctx.boxes[1], dict):
        exclude_box_id = str(ctx.boxes[1].get("box_id") or "")
    syn = _request(
        base_url,
        "POST",
        "/api/browser/workflows/synthesize-from-feedback",
        {
            "tab_id": ctx.tab_id,
            "boxes": ctx.boxes,
            "include_box_ids": [include_box_id],
            "exclude_box_ids": [exclude_box_id] if exclude_box_id else [],
            "fallback_href_contains": [ctx.href_pattern] if ctx.href_pattern else [],
            "required_fields": ["name", "url"],
            "min_items": 1,
            "max_items": 200,
        },
    )
    assert isinstance(syn.get("suggested_candidate"), dict), "synthesize-from-feedback missing suggested_candidate"
    return ctx


def _run_tasks(base_url: str, preferred_tab_id: str, seed_url: str, ctx: _LiveCtx) -> _LiveCtx:
    ctx = _run_synthesize_from_feedback(base_url, preferred_tab_id, seed_url, ctx)
    tasks = _request(base_url, "GET", "/api/browser/workflows/tasks?include_finished=true&limit=20")
    rows = tasks.get("tasks") if isinstance(tasks, dict) else None
    assert isinstance(rows, list), "tasks endpoint missing task rows"
    return ctx


@pytest.mark.live
def test_live_tabs(base_url: str, preferred_tab_id: str):
    _run_tabs(base_url, preferred_tab_id, _LiveCtx())


@pytest.mark.live
def test_live_observation_pack(base_url: str, preferred_tab_id: str, seed_url: str):
    _run_observation_pack(base_url, preferred_tab_id, seed_url, _LiveCtx())


@pytest.mark.live
def test_live_validate_candidate(base_url: str, preferred_tab_id: str, seed_url: str):
    _run_validate_candidate(base_url, preferred_tab_id, seed_url, _LiveCtx())


@pytest.mark.live
def test_live_annotate_candidate(base_url: str, preferred_tab_id: str, seed_url: str):
    _run_annotate_candidate(base_url, preferred_tab_id, seed_url, _LiveCtx())


@pytest.mark.live
def test_live_synthesize_from_feedback(base_url: str, preferred_tab_id: str, seed_url: str):
    _run_synthesize_from_feedback(base_url, preferred_tab_id, seed_url, _LiveCtx())


@pytest.mark.live
def test_live_tasks(base_url: str, preferred_tab_id: str, seed_url: str):
    _run_tasks(base_url, preferred_tab_id, seed_url, _LiveCtx())
