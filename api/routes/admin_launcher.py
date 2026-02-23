"""Admin launcher orchestration routes for React UI parity."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin/launcher", tags=["admin", "launcher"])

def _utc_now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


TESTS: list[dict[str, Any]] = [
    {
        "id": "planner-search-contacts",
        "suite_id": "planner-contacts",
        "suite_name": "Planner: Contacts",
        "name": "Search contacts intent routing",
        "kind": "unit",
        "tags": ["planner", "contacts"],
        "enabled": True,
        "file_path": "ui/src/pages/admin/AdminTests.tsx",
        "marker": "unit",
    },
    {
        "id": "planner-search-companies",
        "suite_id": "planner-companies",
        "suite_name": "Planner: Companies",
        "name": "Search companies intent routing",
        "kind": "unit",
        "tags": ["planner", "companies"],
        "enabled": True,
        "file_path": "ui/src/pages/admin/AdminTests.tsx",
        "marker": "unit",
    },
    {
        "id": "planner-salesnav-live",
        "suite_id": "planner-salesnav",
        "suite_name": "Planner: SalesNav",
        "name": "SalesNav query routing",
        "kind": "integration",
        "tags": ["planner", "salesnav", "live"],
        "enabled": True,
        "file_path": "ui/src/pages/admin/AdminTests.tsx",
        "marker": "e2e",
    },
]


@dataclass(slots=True)
class LauncherState:
    startup: dict[str, Any] = field(
        default_factory=lambda: {
            "phase": "ready",
            "ready": False,
            "checks": {},
            "issues": [
                {
                    "code": "bridge_port_conflict",
                    "message": "bridge port appears occupied",
                    "remediation": "stop stale bridge process or change bridge port",
                },
                {
                    "code": "backend_readiness_timeout",
                    "message": "backend probe exceeded timeout",
                    "remediation": "inspect backend logs for startup failures",
                },
            ],
        }
    )
    test_status: dict[str, dict[str, Any]] = field(
        default_factory=lambda: {row["id"]: {"status": "idle", "lastRun": None, "duration": None, "attempt": None} for row in TESTS}
    )
    runs: list[dict[str, Any]] = field(default_factory=list)
    current_run_id: str | None = None
    stop_mode: Literal["run", "after_current", "terminate_workers"] | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


STATE = LauncherState()


class PlanRequest(BaseModel):
    test_ids: list[str] = []
    tags: list[str] = []


class StopRequest(BaseModel):
    mode: Literal["run", "after_current", "terminate_workers"] = "run"


def _apply_plan(test_ids: list[str], tags: list[str]) -> list[dict[str, Any]]:
    selected = TESTS
    if test_ids:
        wanted = set(test_ids)
        selected = [t for t in selected if t["id"] in wanted]
    if tags:
        tag_set = {tag.strip().lower() for tag in tags if tag.strip()}
        selected = [t for t in selected if any(str(tag).lower() in tag_set for tag in t.get("tags", []))]
    return selected


def _simulate_run(run_id: str, planned: list[dict[str, Any]]) -> None:
    started = time.time()
    tests_out: list[dict[str, Any]] = []
    final_status = "passed"

    with STATE.lock:
        for row in planned:
            STATE.test_status[row["id"]].update({"status": "queued", "lastRun": time.time(), "duration": None})

    for idx, row in enumerate(planned):
        with STATE.lock:
            mode = STATE.stop_mode
        if mode in {"terminate_workers", "run"}:
            final_status = "canceled"
            break
        with STATE.lock:
            STATE.test_status[row["id"]].update({"status": "running", "attempt": 1, "lastRun": time.time(), "started_at": time.time()})
        time.sleep(0.12)
        failed = row["kind"] == "integration" and idx % 2 == 0
        status = "failed" if failed else "passed"
        if failed:
            final_status = "failed"
        with STATE.lock:
            STATE.test_status[row["id"]].update({"status": status, "duration": 0.12, "finished_at": time.time()})
            if STATE.stop_mode == "after_current":
                STATE.stop_mode = "run"
        tests_out.append({"id": row["id"], "status": status, "duration_sec": 0.12, "message": "" if not failed else "simulated failure"})

    with STATE.lock:
        if STATE.stop_mode in {"run", "terminate_workers"}:
            final_status = "canceled"
        finished_at = _utc_now_iso()
        duration = time.time() - started
        run_record = next((r for r in STATE.runs if r.get("run_id") == run_id), None)
        if run_record is not None:
            run_record.update(
                {
                    "status": final_status,
                    "finished_at": finished_at,
                    "duration_sec": duration,
                    "tests": tests_out,
                }
            )
        STATE.current_run_id = None
        STATE.stop_mode = None


@router.get("/state")
async def launcher_state() -> dict[str, Any]:
    return STATE.startup


@router.get("/tests")
async def launcher_tests() -> list[dict[str, Any]]:
    return TESTS


@router.get("/status")
async def launcher_status() -> dict[str, dict[str, Any]]:
    with STATE.lock:
        return {k: dict(v) for k, v in STATE.test_status.items()}


@router.post("/preview-plan")
async def launcher_preview_plan(payload: PlanRequest) -> list[dict[str, Any]]:
    planned = _apply_plan(payload.test_ids, payload.tags)
    return [{"order": i + 1, "id": row["id"], "name": row["name"]} for i, row in enumerate(planned)]


@router.post("/run")
async def launcher_run(payload: PlanRequest) -> dict[str, Any]:
    planned = _apply_plan(payload.test_ids, payload.tags)
    if not planned:
        return {"ok": False, "error": "no tests matched current selection"}
    with STATE.lock:
        if STATE.current_run_id is not None:
            return {"ok": False, "error": "run already active"}
        run_id = f"run-{int(time.time() * 1000)}"
        STATE.current_run_id = run_id
        STATE.stop_mode = None
        STATE.runs.insert(
            0,
            {
                "run_id": run_id,
                "status": "running",
                "started_at": _utc_now_iso(),
                "selected_test_ids": [row["id"] for row in planned],
                "selected_tags": payload.tags,
                "tests": [],
                "artifacts": {
                    "events": f"data/launcher_runs/{run_id}/events.ndjson",
                    "stdout": f"data/launcher_runs/{run_id}/stdout.log",
                    "junit": f"data/launcher_runs/{run_id}/results.junit.xml",
                    "json": f"data/launcher_runs/{run_id}/results.json",
                },
            },
        )
    thread = threading.Thread(target=_simulate_run, args=(run_id, planned), daemon=True)
    thread.start()
    return {"ok": True, "run_id": run_id}


@router.post("/stop")
async def launcher_stop(payload: StopRequest) -> dict[str, Any]:
    with STATE.lock:
        STATE.stop_mode = payload.mode
    return {"ok": True, "mode": payload.mode}


@router.get("/runs")
async def launcher_runs() -> list[dict[str, Any]]:
    with STATE.lock:
        return [dict(item) for item in STATE.runs[:30]]


@router.post("/runs/{run_id}/open")
async def launcher_open_run(run_id: str) -> dict[str, Any]:
    return {"ok": True, "run_id": run_id}


@router.get("/runs/{run_id}/artifacts/{kind}")
async def launcher_artifact(run_id: str, kind: Literal["json", "junit", "events", "stdout"]) -> dict[str, Any]:
    with STATE.lock:
        row = next((r for r in STATE.runs if r.get("run_id") == run_id), None)
    if not row:
        return {"ok": False, "run_id": run_id, "kind": kind, "path": None}
    artifacts = row.get("artifacts") or {}
    return {"ok": True, "run_id": run_id, "kind": kind, "path": artifacts.get(kind)}

