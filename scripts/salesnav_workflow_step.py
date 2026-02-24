from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from services.web_automation.browser.core.workflow import BrowserWorkflow

PREFIX = "[launcher-step-json] "


def _request(base_url: str, method: str, path: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url=url, method=method, data=data)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed: HTTP {exc.code} {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {path} failed: {exc}") from exc


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _save_state(path: Path, state: dict[str, Any]) -> None:
    _save_json(path, state)


def _extract_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    items = payload.get("items")
    if isinstance(items, list):
        return [row for row in items if isinstance(row, dict)]
    result = payload.get("result")
    if isinstance(result, dict):
        rows = result.get("items")
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def _extract_employee_entrypoints_from_observation(payload: dict[str, Any]) -> list[dict[str, Any]]:
    observation = payload.get("observation") if isinstance(payload, dict) else {}
    dom = observation.get("dom") if isinstance(observation, dict) else {}
    role_refs = dom.get("role_refs") if isinstance(dom, dict) else []
    semantic_nodes = dom.get("semantic_nodes") if isinstance(dom, dict) else []
    candidates: list[dict[str, Any]] = []

    def _ingest(rows: list[Any], source: str) -> None:
        for row in rows:
            if not isinstance(row, dict):
                continue
            href = str(row.get("href") or row.get("url") or "").strip()
            label = " ".join(str(row.get("label") or row.get("text") or "").split()).strip()
            role = str(row.get("role") or row.get("tag") or "").strip()
            if not href:
                continue
            lower_href = href.lower()
            lower_label = label.lower()
            if "/sales/search/people" not in lower_href and "/sales/lead/" not in lower_href:
                if not any(token in lower_label for token in ("employee", "people", "team", "lead")):
                    continue
            candidates.append(
                {
                    "href": href,
                    "label": label,
                    "role": role,
                    "source": source,
                }
            )

    _ingest(role_refs if isinstance(role_refs, list) else [], "role_ref")
    _ingest(semantic_nodes if isinstance(semantic_nodes, list) else [], "semantic_node")

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for row in candidates:
        key = f"{str(row.get('href') or '').split('?', 1)[0]}|{str(row.get('label') or '').lower()}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def _poll_task(base_url: str, task_id: str, timeout_sec: int = 180) -> dict[str, Any]:
    started = time.time()
    while True:
        row = _request(base_url, "GET", f"/api/browser/workflows/status/{urllib.parse.quote(task_id)}")
        status = str(row.get("status") or "").lower()
        if status in {"finished", "failed"}:
            return row
        if time.time() - started > timeout_sec:
            raise RuntimeError(f"task {task_id} timed out after {timeout_sec}s")
        time.sleep(1.0)


def _pick_screenshot_base64(observation_payload: dict[str, Any]) -> str:
    obs = observation_payload.get("observation") if isinstance(observation_payload, dict) else {}
    if not isinstance(obs, dict):
        return ""
    candidates: list[str] = []
    direct = obs.get("screenshot_base64")
    if isinstance(direct, str) and direct.strip():
        candidates.append(direct.strip())
    capture = obs.get("capture")
    if isinstance(capture, dict):
        cshot = capture.get("screenshot_base64")
        if isinstance(cshot, str) and cshot.strip():
            candidates.append(cshot.strip())
    for value in candidates:
        if value:
            return value
    return ""


def _pick_direct_screenshot_base64(payload: dict[str, Any]) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("image", "screenshot_base64", "base64"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _capture_step_screenshot(*, base_url: str, tab_id: str, artifacts_dir: Path, filename: str) -> str:
    tab = str(tab_id or "").strip()
    if not tab:
        return ""
    req = {"tab_id": tab, "full_page": False}
    resp = _request(base_url, "POST", "/api/browser/screenshot", req, timeout=45)
    shot_b64 = _pick_direct_screenshot_base64(resp if isinstance(resp, dict) else {})
    if not shot_b64:
        return ""
    out_path = artifacts_dir / filename
    out_path.write_bytes(base64.b64decode(shot_b64))
    return str(out_path)


def _emit_structured(payload: dict[str, Any]) -> None:
    print(PREFIX + json.dumps(payload, ensure_ascii=True), flush=True)


def _sha(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run_step(*, step: str, base_url: str, state_file: Path, artifacts_dir: Path, limit: int) -> None:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    state = _load_state(state_file)
    tool_call: dict[str, Any] = {}
    tool_response: dict[str, Any] = {}
    outputs: dict[str, Any] = {}
    artifact_rows: list[dict[str, Any]] = []

    if step == "open_or_reuse_tab":
        tool_call = {"method": "GET", "path": "/api/browser/tabs"}
        tabs = _request(base_url, "GET", "/api/browser/tabs")
        tab_rows = tabs.get("tabs") if isinstance(tabs, dict) else []
        if not isinstance(tab_rows, list) or not tab_rows:
            raise RuntimeError("no browser tabs available")
        tab_id = str((tab_rows[0] or {}).get("id") or "").strip()
        if not tab_id:
            raise RuntimeError("unable to resolve tab id")
        state["tab_id"] = tab_id
        seed_url = os.getenv("WORKFLOW_BUILDER_LIVE_SEED_URL", "https://www.linkedin.com/sales/search/company").strip()
        nav_call = {"method": "POST", "path": "/api/browser/navigate", "tab_id": tab_id, "url": seed_url}
        nav_resp = _request(base_url, "POST", "/api/browser/navigate", {"tab_id": tab_id, "url": seed_url, "timeout_ms": 45000})
        step_shot = _capture_step_screenshot(
            base_url=base_url,
            tab_id=tab_id,
            artifacts_dir=artifacts_dir,
            filename="open_or_reuse_tab_screenshot.jpg",
        )
        tool_response = {"tabs_count": len(tab_rows), "navigate": nav_resp}
        outputs = {"tab_id": tab_id, "seed_url": seed_url, "tool_calls": [tool_call, nav_call], "screenshot": step_shot or None}
        if step_shot:
            artifact_rows.append({"type": "screenshot", "path": step_shot})

    elif step == "navigate_and_collect":
        tab_id = str(state.get("tab_id") or "").strip()
        if not tab_id:
            raise RuntimeError("state missing tab_id; run open_or_reuse_tab first")
        query = os.getenv("SALESNAV_WORKFLOW_QUERY", "graphics card companies on sales navigator").strip()
        req = {
            "task": "salesnav_search_account",
            "query": query,
            "tab_id": tab_id,
            "limit": limit,
            "wait_ms": 3500,
        }
        tool_call = {"method": "POST", "path": "/api/browser/workflows/search-and-extract", "payload": req}
        resp = _request(base_url, "POST", "/api/browser/workflows/search-and-extract", req, timeout=90)
        status = str(resp.get("status") or "").lower()
        if status == "pending" and resp.get("task_id"):
            task_id = str(resp.get("task_id"))
            polled = _poll_task(base_url, task_id)
            if str(polled.get("status") or "").lower() != "finished":
                raise RuntimeError(f"workflow task failed: {polled}")
            final_result = polled.get("result") if isinstance(polled.get("result"), dict) else {}
            tool_response = {"initial": resp, "task": polled}
            collected = final_result if isinstance(final_result, dict) else {}
        else:
            tool_response = resp if isinstance(resp, dict) else {}
            collected = resp if isinstance(resp, dict) else {}

        items = _extract_items(collected)
        state["search_result"] = collected
        state["items"] = items
        step_shot = _capture_step_screenshot(
            base_url=base_url,
            tab_id=tab_id,
            artifacts_dir=artifacts_dir,
            filename="navigate_and_collect_screenshot.jpg",
        )
        outputs = {"query": query, "count": len(items), "tab_id": tab_id, "screenshot": step_shot or None}
        _save_json(artifacts_dir / "search_result.json", {"result": collected, "items": items})
        artifact_rows.append({"type": "json", "path": str(artifacts_dir / "search_result.json")})
        if step_shot:
            artifact_rows.append({"type": "screenshot", "path": step_shot})

    elif step == "navigate_account_profile":
        tab_id = str(state.get("tab_id") or "").strip()
        if not tab_id:
            raise RuntimeError("state missing tab_id; run open_or_reuse_tab first")
        account_url = os.getenv(
            "SALESNAV_WORKFLOW_ACCOUNT_URL",
            "https://www.linkedin.com/sales/company/125222?_ntb=yRQdLouQQXqs3hHn%2B7%2FG5Q%3D%3D",
        ).strip()
        if not account_url:
            raise RuntimeError("missing SALESNAV_WORKFLOW_ACCOUNT_URL")
        req = {"tab_id": tab_id, "url": account_url, "timeout_ms": 45000}
        tool_call = {"method": "POST", "path": "/api/browser/navigate", "payload": req}
        nav_resp = _request(base_url, "POST", "/api/browser/navigate", req, timeout=90)
        state["account_profile_url"] = str((nav_resp.get("url") if isinstance(nav_resp, dict) else "") or account_url)
        tool_response = nav_resp if isinstance(nav_resp, dict) else {"raw": nav_resp}
        step_shot = _capture_step_screenshot(
            base_url=base_url,
            tab_id=tab_id,
            artifacts_dir=artifacts_dir,
            filename="navigate_account_profile_screenshot.jpg",
        )
        outputs = {
            "tab_id": tab_id,
            "account_profile_url": state["account_profile_url"],
            "screenshot": step_shot or None,
        }
        if step_shot:
            artifact_rows.append({"type": "screenshot", "path": step_shot})

    elif step == "extract_account_profile":
        tab_id = str(state.get("tab_id") or "").strip()
        if not tab_id:
            raise RuntimeError("state missing tab_id; run open_or_reuse_tab first")
        req = {"tab_id": tab_id, "limit": 1}
        tool_call = {"method": "POST", "path": "/api/salesnav/browser/extract-companies", "payload": req}
        resp = _request(base_url, "POST", "/api/salesnav/browser/extract-companies", req, timeout=90)
        companies = resp.get("companies") if isinstance(resp, dict) else []
        if not isinstance(companies, list):
            companies = []
        company = companies[0] if companies and isinstance(companies[0], dict) else {}
        if not company:
            raise RuntimeError("account profile extraction returned no company row")
        state["account_profile"] = company
        _save_json(artifacts_dir / "account_profile.json", {"company": company, "raw": resp})
        artifact_rows.append({"type": "json", "path": str(artifacts_dir / "account_profile.json")})
        tool_response = {"count": len(companies), "ok": bool(resp.get("ok")) if isinstance(resp, dict) else True}
        outputs = {
            "company_name": str(company.get("company_name") or company.get("name") or "").strip(),
            "sales_nav_url": str(company.get("sales_nav_url") or company.get("linkedin_url") or "").strip(),
            "industry": str(company.get("industry") or "").strip(),
            "website": str(company.get("website") or "").strip(),
            "tab_id": tab_id,
        }

    elif step == "capture_account_employee_entrypoints":
        tab_id = str(state.get("tab_id") or "").strip()
        if not tab_id:
            raise RuntimeError("state missing tab_id; run open_or_reuse_tab first")
        req = {"tab_id": tab_id, "include_screenshot": False, "include_semantic_nodes": True}
        tool_call = {"method": "POST", "path": "/api/browser/workflows/observation-pack", "payload": req}
        observation = _request(base_url, "POST", "/api/browser/workflows/observation-pack", req, timeout=90)
        entrypoints = _extract_employee_entrypoints_from_observation(observation if isinstance(observation, dict) else {})
        state["account_employee_entrypoints"] = entrypoints
        _save_json(artifacts_dir / "account_employee_entrypoints.json", {"entrypoints": entrypoints})
        artifact_rows.append({"type": "json", "path": str(artifacts_dir / "account_employee_entrypoints.json")})
        tool_response = {"entrypoints_count": len(entrypoints)}
        outputs = {"tab_id": tab_id, "entrypoints_count": len(entrypoints), "entrypoints": entrypoints[:8]}

    elif step == "assert_account_profile_required_fields":
        company = state.get("account_profile") if isinstance(state.get("account_profile"), dict) else {}
        name = str(company.get("company_name") or company.get("name") or "").strip()
        sales_nav_url = str(company.get("sales_nav_url") or company.get("linkedin_url") or "").strip()
        entrypoints = state.get("account_employee_entrypoints") if isinstance(state.get("account_employee_entrypoints"), list) else []
        missing: list[str] = []
        if not name:
            missing.append("company_name")
        if not sales_nav_url:
            missing.append("sales_nav_url")
        elif "/sales/company/" not in sales_nav_url.lower():
            missing.append("sales_nav_url_not_sales_company")
        if not entrypoints:
            missing.append("employee_entrypoint")
        tool_call = {"op": "assert_account_profile_required_fields"}
        tool_response = {"missing": missing}
        outputs = {
            "company_name": name,
            "sales_nav_url": sales_nav_url,
            "employee_entrypoints_count": len(entrypoints),
            "missing_count": len(missing),
        }
        if missing:
            raise RuntimeError(f"account profile assertions failed: {', '.join(missing)}")

    elif step == "dismiss_notifications_overlay":
        tab_id = str(state.get("tab_id") or "").strip()
        if not tab_id:
            raise RuntimeError("state missing tab_id; run open_or_reuse_tab first")
        tool_call = {"op": "dismiss_common_overlays", "tab_id": tab_id, "max_passes": 3}
        wf = BrowserWorkflow(tab_id=tab_id)
        dismissed = asyncio.run(wf.dismiss_common_overlays(max_passes=3))
        tool_response = dismissed if isinstance(dismissed, dict) else {"result": dismissed}
        step_shot = _capture_step_screenshot(
            base_url=base_url,
            tab_id=tab_id,
            artifacts_dir=artifacts_dir,
            filename="dismiss_notifications_overlay_screenshot.jpg",
        )
        outputs = {
            "tab_id": tab_id,
            "dismiss_result": tool_response,
            "screenshot": step_shot or None,
        }
        if step_shot:
            artifact_rows.append({"type": "screenshot", "path": step_shot})

    elif step == "capture_observation":
        tab_id = str(state.get("tab_id") or "").strip()
        if not tab_id:
            raise RuntimeError("state missing tab_id; run open_or_reuse_tab first")
        req = {"tab_id": tab_id, "include_screenshot": True, "include_semantic_nodes": True}
        tool_call = {"method": "POST", "path": "/api/browser/workflows/observation-pack", "payload": req}
        obs = _request(base_url, "POST", "/api/browser/workflows/observation-pack", req, timeout=90)
        tool_response = {"ok": bool(obs.get("ok")), "tab_id": obs.get("tab_id")}
        shot_b64 = _pick_screenshot_base64(obs)
        if not shot_b64:
            fallback_req = {"tab_id": tab_id, "full_page": False}
            fallback_call = {"method": "POST", "path": "/api/browser/screenshot", "payload": fallback_req}
            fallback_resp = _request(base_url, "POST", "/api/browser/screenshot", fallback_req, timeout=45)
            tool_response["fallback_screenshot"] = {
                "ok": bool(fallback_resp),
                "keys": sorted(list(fallback_resp.keys())) if isinstance(fallback_resp, dict) else [],
            }
            tool_call = {"primary": tool_call, "fallback": fallback_call}
            shot_b64 = _pick_direct_screenshot_base64(fallback_resp if isinstance(fallback_resp, dict) else {})
        image_path_str = ""
        if shot_b64:
            image_path = artifacts_dir / "observation_screenshot.jpg"
            image_path.write_bytes(base64.b64decode(shot_b64))
            image_path_str = str(image_path)
            state["observation_screenshot"] = image_path_str
            artifact_rows.append({"type": "screenshot", "path": str(image_path)})
        _save_json(artifacts_dir / "observation_pack.json", obs if isinstance(obs, dict) else {"raw": obs})
        artifact_rows.append({"type": "json", "path": str(artifacts_dir / "observation_pack.json")})
        outputs = {"tab_id": tab_id, "has_screenshot": bool(shot_b64), "screenshot": image_path_str or None}

    elif step == "assert_min_count_5":
        items = state.get("items") if isinstance(state.get("items"), list) else []
        count = len(items)
        outputs = {"count": count, "limit": limit}
        if count < limit:
            raise RuntimeError(f"expected at least {limit} companies, observed {count}")
        tool_call = {"op": "assert_min_count_5", "expected": limit}
        tool_response = {"observed": count}

    elif step == "assert_required_fields":
        items = state.get("items") if isinstance(state.get("items"), list) else []
        missing: list[dict[str, Any]] = []
        for idx, row in enumerate(items):
            if not isinstance(row, dict):
                missing.append({"index": idx, "error": "item_not_object"})
                continue
            name = str(row.get("name") or row.get("company_name") or "").strip()
            url = str(row.get("url") or row.get("sales_nav_url") or row.get("linkedin_url") or "").strip()
            if not name or not url:
                missing.append({"index": idx, "name": bool(name), "url": bool(url)})
        outputs = {"items_checked": len(items), "missing_count": len(missing)}
        tool_call = {"op": "assert_required_fields", "required": ["name", "url"]}
        tool_response = {"missing": missing[:20]}
        if missing:
            _save_json(artifacts_dir / "missing_fields.json", {"missing": missing})
            artifact_rows.append({"type": "json", "path": str(artifacts_dir / "missing_fields.json")})
            raise RuntimeError(f"missing required fields in {len(missing)} row(s)")

    elif step == "persist_summary":
        items = state.get("items") if isinstance(state.get("items"), list) else []
        summary = {
            "tab_id": state.get("tab_id"),
            "count": len(items),
            "sample_names": [
                str((row.get("name") or row.get("company_name") or "")).strip()
                for row in items[:5]
                if isinstance(row, dict)
            ],
            "screenshot": state.get("observation_screenshot"),
        }
        _save_json(artifacts_dir / "workflow_summary.json", summary)
        artifact_rows.append({"type": "json", "path": str(artifacts_dir / "workflow_summary.json")})
        tool_call = {"op": "persist_summary"}
        tool_response = {"ok": True}
        outputs = summary

    elif step == "persist_aggregate_summary":
        items = state.get("items") if isinstance(state.get("items"), list) else []
        summary = {
            "scope": "salesnav.aggregate",
            "tab_id": state.get("tab_id"),
            "company_items_count": len(items),
            "company_items_sample_names": [
                str((row.get("name") or row.get("company_name") or "")).strip()
                for row in items[:5]
                if isinstance(row, dict)
            ],
            "observation_screenshot": state.get("observation_screenshot"),
        }
        _save_json(artifacts_dir / "workflow_summary.json", summary)
        artifact_rows.append({"type": "json", "path": str(artifacts_dir / "workflow_summary.json")})
        tool_call = {"op": "persist_aggregate_summary"}
        tool_response = {"ok": True}
        outputs = summary

    else:
        raise RuntimeError(f"unknown step: {step}")

    _save_state(state_file, state)
    structured = {
        "step": step,
        "inputs": {"state_file": str(state_file), "artifacts_dir": str(artifacts_dir), "limit": limit},
        "tool_call": tool_call,
        "tool_response": tool_response,
        "outputs": outputs,
        "normalized_output_hash": _sha(outputs),
        "artifacts": artifact_rows,
    }
    _emit_structured(structured)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one SalesNav workflow DAG step")
    parser.add_argument("--step", required=True)
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--artifacts-dir", required=True)
    parser.add_argument("--base-url", default=os.getenv("WORKFLOW_BUILDER_LIVE_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    try:
        run_step(
            step=str(args.step).strip(),
            base_url=str(args.base_url).strip(),
            state_file=Path(args.state_file),
            artifacts_dir=Path(args.artifacts_dir),
            limit=max(1, int(args.limit)),
        )
        return 0
    except Exception as exc:
        error_payload = {"step": str(args.step), "error": str(exc)}
        _emit_structured({"outputs": {}, "error_trace": str(exc), "tool_response": error_payload})
        print(f"[workflow-step-error] {exc}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
