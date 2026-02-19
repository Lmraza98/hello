"""Live end-to-end validator for Browser Workflow Builder endpoints.

Runs a deterministic API flow against a running backend:
1) tabs
2) observation-pack
3) validate-candidate
4) annotate-candidate
5) synthesize-from-feedback
6) tasks
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


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


def _pick_first_href(rows: list[dict[str, Any]]) -> str:
    for row in rows:
        href = str(row.get("href") or "").strip()
        if href:
            parsed = urllib.parse.urlparse(href)
            if parsed.path and parsed.path != "/":
                first = parsed.path.split("/")[1] if len(parsed.path.split("/")) > 1 else ""
                if first:
                    return f"/{first}/"
    return "/"


def main() -> int:
    parser = argparse.ArgumentParser(description="Live e2e validator for workflow builder endpoints")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--tab-id", default="", help="Optional tab id to target")
    args = parser.parse_args()

    print("== Workflow Builder Live E2E ==")

    tabs = _request(args.base_url, "GET", "/api/browser/tabs")
    tab_rows = tabs.get("tabs") if isinstance(tabs, dict) else None
    if not isinstance(tab_rows, list) or not tab_rows:
        print("FAIL: no tabs available from /api/browser/tabs")
        return 1
    tab_id = args.tab_id or str(tab_rows[0].get("id") or "")
    if not tab_id:
        print("FAIL: could not determine tab_id")
        return 1
    print(f"PASS: using tab_id={tab_id}")

    obs = _request(
        args.base_url,
        "POST",
        "/api/browser/workflows/observation-pack",
        {"tab_id": tab_id, "include_screenshot": False, "include_semantic_nodes": True},
    )
    observation = obs.get("observation") if isinstance(obs, dict) else None
    if not isinstance(observation, dict):
        print("FAIL: observation-pack did not return observation")
        return 1
    dom = observation.get("dom") if isinstance(observation.get("dom"), dict) else {}
    refs = dom.get("role_refs") if isinstance(dom.get("role_refs"), list) else []
    if not refs:
        print("FAIL: observation-pack returned no role_refs")
        return 1
    href_pattern = _pick_first_href([r for r in refs if isinstance(r, dict)])
    print(f"PASS: observation-pack refs={len(refs)} href_pattern={href_pattern}")

    val = _request(
        args.base_url,
        "POST",
        "/api/browser/workflows/validate-candidate",
        {
            "tab_id": tab_id,
            "href_contains": [href_pattern] if href_pattern else [],
            "min_items": 1,
            "max_items": 200,
            "required_fields": ["name", "url"],
        },
    )
    candidate_validation = val.get("candidate_validation") if isinstance(val, dict) else None
    if not isinstance(candidate_validation, dict):
        print("FAIL: validate-candidate missing candidate_validation")
        return 1
    print(
        "PASS: validate-candidate "
        f"ok={candidate_validation.get('ok')} "
        f"count={(candidate_validation.get('metrics') or {}).get('count')} "
        f"fit_score={candidate_validation.get('fit_score')}"
    )

    ann = _request(
        args.base_url,
        "POST",
        "/api/browser/workflows/annotate-candidate",
        {
            "tab_id": tab_id,
            "href_contains": [href_pattern] if href_pattern else [],
            "max_boxes": 40,
            "include_screenshot": True,
        },
    )
    annotation = ann.get("annotation") if isinstance(ann, dict) else None
    boxes = annotation.get("boxes") if isinstance(annotation, dict) and isinstance(annotation.get("boxes"), list) else []
    if not boxes:
        print("FAIL: annotate-candidate returned zero boxes")
        return 1
    print(f"PASS: annotate-candidate boxes={len(boxes)}")

    include_box_id = str((boxes[0] if isinstance(boxes[0], dict) else {}).get("box_id") or "")
    if not include_box_id:
        print("FAIL: first annotation box has no box_id")
        return 1
    exclude_box_id = ""
    if len(boxes) > 1 and isinstance(boxes[1], dict):
        exclude_box_id = str(boxes[1].get("box_id") or "")

    syn = _request(
        args.base_url,
        "POST",
        "/api/browser/workflows/synthesize-from-feedback",
        {
            "tab_id": tab_id,
            "boxes": boxes,
            "include_box_ids": [include_box_id],
            "exclude_box_ids": [exclude_box_id] if exclude_box_id else [],
            "fallback_href_contains": [href_pattern] if href_pattern else [],
            "required_fields": ["name", "url"],
            "min_items": 1,
            "max_items": 200,
        },
    )
    if not isinstance(syn.get("suggested_candidate"), dict):
        print("FAIL: synthesize-from-feedback missing suggested_candidate")
        return 1
    print(f"PASS: synthesize-from-feedback suggested={syn.get('suggested_href_contains')}")

    tasks = _request(args.base_url, "GET", "/api/browser/workflows/tasks?include_finished=true&limit=20")
    rows = tasks.get("tasks") if isinstance(tasks, dict) else None
    if not isinstance(rows, list):
        print("FAIL: tasks endpoint missing task rows")
        return 1
    print(f"PASS: tasks rows={len(rows)}")
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
