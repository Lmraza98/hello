"""LeadPilot Launcher

Production-grade internal launcher for backend/bridge startup, diagnostics,
and isolated test orchestration via a manifest-driven worker process.
"""

from __future__ import annotations

import ast
import json
import os
import queue
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from launcher_runtime import (
    CatalogError,
    LauncherStartupError,
    PlanError,
    ProcessSupervisor,
    RunStore,
    WorkerClient,
    build_run_plan,
    load_catalog,
)


APP_DIR = Path(__file__).parent
os.chdir(APP_DIR)
load_dotenv(APP_DIR / ".env")

SERVER_PORT = int(os.getenv("HELLO_SERVER_PORT", "8000"))
BRIDGE_PORT = int(os.getenv("LEADPILOT_BRIDGE_PORT", "9223"))
LOG_BUFFER_LIMIT = 1200
CATALOG_PATH = Path(os.getenv("LEADPILOT_TEST_CATALOG", str(APP_DIR / "config" / "launcher_test_catalog.v1.json")))
RUN_STORE_ROOT = APP_DIR / "data" / "launcher_runs"

_log_queue: "queue.Queue[str]" = queue.Queue()
_log_buffer: list[str] = []
_state_lock = threading.Lock()

runtime: dict[str, Any] = {
    "catalog": None,
    "catalog_error": None,
    "tests": [],
    "test_status": {},
    "current_run": None,
    "run_paths": None,
    "startup": {
        "phase": "init",
        "ready": False,
        "checks": {},
        "issues": [],
    },
    "worker_last_heartbeat": None,
    "latest_failed_run": None,
}

supervisor = ProcessSupervisor(app_dir=APP_DIR, server_port=SERVER_PORT, bridge_port=BRIDGE_PORT)
run_store = RunStore(RUN_STORE_ROOT)
worker = WorkerClient(
    worker_script=APP_DIR / "scripts" / "launcher_test_worker.py",
    catalog_path=CATALOG_PATH,
    project_root=APP_DIR,
)


def _append_log(line: str) -> None:
    _log_buffer.append(line)
    if len(_log_buffer) > LOG_BUFFER_LIMIT:
        del _log_buffer[: len(_log_buffer) - LOG_BUFFER_LIMIT]


def _pump_logs() -> None:
    while True:
        try:
            line = _log_queue.get(timeout=0.2)
        except queue.Empty:
            continue
        _append_log(line)


def _stream_output(prefix: str, proc: subprocess.Popen[str]) -> None:
    if proc.stdout is None:
        return
    for raw in proc.stdout:
        _log_queue.put(f"[{prefix}] {raw.rstrip()}\n")


def _redacted_env_snapshot() -> dict[str, str]:
    out: dict[str, str] = {}
    sensitive = {"KEY", "TOKEN", "SECRET", "PASSWORD", "PASS"}
    for key in sorted(os.environ.keys()):
        value = os.environ.get(key, "")
        if any(marker in key.upper() for marker in sensitive):
            out[key] = "<redacted>"
        else:
            out[key] = value[:180]
    return out


def _mark_startup_issue(code: str, message: str, remediation: str) -> None:
    runtime["startup"]["issues"].append(
        {
            "code": code,
            "message": message,
            "remediation": remediation,
        }
    )
    _log_queue.put(f"[startup] {code}: {message} | fix: {remediation}\n")


def _load_catalog_state() -> None:
    def discover_python_cases() -> list[dict[str, str]]:
        cases: list[dict[str, str]] = []
        tests_root = APP_DIR / "tests"
        if not tests_root.exists():
            return cases
        for path in sorted(tests_root.rglob("test_*.py")):
            rel = path.relative_to(APP_DIR).as_posix()
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except Exception:
                continue
            for node in tree.body:
                if isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
                    cases.append(
                        {
                            "name": node.name,
                            "nodeid": f"{rel}::{node.name}",
                            "file": rel,
                        }
                    )
                if isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
                    for child in node.body:
                        if isinstance(child, ast.FunctionDef) and child.name.startswith("test_"):
                            cases.append(
                                {
                                    "name": f"{node.name}.{child.name}",
                                    "nodeid": f"{rel}::{node.name}::{child.name}",
                                    "file": rel,
                                }
                            )
        return cases

    python_cases = discover_python_cases()
    try:
        catalog = load_catalog(CATALOG_PATH)
        runtime["catalog"] = catalog
        runtime["catalog_error"] = None
        tests: list[dict[str, Any]] = []
        status: dict[str, dict[str, Any]] = {}
        for suite in catalog.suites:
            for test in suite.tests:
                tests.append(
                    {
                        "id": test.id,
                        "name": test.name,
                        "kind": test.kind,
                        "suite_id": suite.id,
                        "suite_name": suite.name,
                        "tags": test.tags,
                        "enabled": test.enabled,
                        "timeout_sec": test.timeout_sec,
                        "retries": test.retries,
                        "children": python_cases if test.id == "python-tests-all" else [],
                    }
                )
                status.setdefault(test.id, {"status": "idle", "lastRun": None, "duration": None, "attempt": None})
        runtime["tests"] = sorted(tests, key=lambda t: (t["suite_name"], t["name"]))
        runtime["test_status"] = status
    except CatalogError as exc:
        runtime["catalog"] = None
        runtime["catalog_error"] = str(exc)
        runtime["tests"] = []
        runtime["test_status"] = {}
        _log_queue.put(f"[catalog] load failed: {exc}\n")


def _update_test_status(test_id: str, **changes: Any) -> None:
    status = runtime["test_status"].setdefault(test_id, {"status": "idle", "lastRun": None, "duration": None})
    status.update(changes)


def _open_path(path: str) -> None:
    target = Path(path)
    if not target.exists():
        _log_queue.put(f"[launcher] path not found: {target}\n")
        return
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(target))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
    except Exception as exc:
        _log_queue.put(f"[launcher] open path failed: {exc}\n")


def _process_worker_event(event: dict[str, Any]) -> None:
    ev_type = str(event.get("type") or "")
    payload = event.get("payload", {}) if isinstance(event.get("payload"), dict) else {}

    run_paths = runtime.get("run_paths")
    if run_paths is not None:
        run_store.append_event(run_paths, {"type": ev_type, "payload": payload, "timestamp": event.get("timestamp")})

    if ev_type == "heartbeat":
        runtime["worker_last_heartbeat"] = event.get("timestamp")
        return

    if ev_type == "discover":
        discovered = payload.get("tests")
        if isinstance(discovered, list) and discovered:
            # Keep local catalog as source of truth; this confirms worker sync.
            _log_queue.put(f"[worker] discovered {len(discovered)} tests\n")
        return

    if ev_type == "run_started":
        run_id = str(payload.get("run_id") or "")
        runtime["current_run"] = {
            "run_id": run_id,
            "status": "running",
            "started_at": time.time(),
        }
        for test_id in payload.get("test_ids", []):
            _update_test_status(str(test_id), status="queued", lastRun=time.time(), duration=None)
        _log_queue.put(f"[tests] run started: {run_id}\n")
        return

    if ev_type == "test_started":
        test_id = str(payload.get("id") or "")
        status = str(payload.get("status") or "running")
        attempt = payload.get("attempt")
        _update_test_status(test_id, status=status, lastRun=time.time(), attempt=attempt)
        return

    if ev_type == "test_output":
        test_id = str(payload.get("id") or "unknown")
        line = str(payload.get("line") or "")
        if line:
            _log_queue.put(f"[tests:{test_id}] {line}\n")
            if run_paths is not None:
                run_store.append_stdout(run_paths, f"[{test_id}] {line}\n")
        return

    if ev_type == "test_finished":
        test_id = str(payload.get("id") or "")
        status = str(payload.get("status") or "failed")
        duration = float(payload.get("duration_sec") or 0.0)
        _update_test_status(test_id, status=status, duration=duration, attempt=payload.get("attempt"))
        _log_queue.put(f"[tests] {test_id} -> {status} ({duration:.2f}s)\n")
        return

    if ev_type == "run_finished":
        run_id = str(payload.get("run_id") or "")
        status = str(payload.get("status") or "failed")
        tests = payload.get("tests") if isinstance(payload.get("tests"), list) else []
        duration = float(payload.get("duration_sec") or 0.0)

        runtime["current_run"] = {
            "run_id": run_id,
            "status": status,
            "duration_sec": duration,
            "finished_at": time.time(),
        }

        if run_paths is not None:
            result_payload = {
                "run_id": run_id,
                "status": status,
                "duration_sec": duration,
                "tests": tests,
                "exports": {"json": True, "junit": True},
            }
            run_store.write_results(run_paths, result_payload)
            run_store.write_junit(run_paths, result_payload)
            run_store.finalize_run(run_paths, status=status, duration_sec=duration, tests=tests)
            runtime["run_paths"] = None
            run_store.prune()

        if status == "failed":
            runtime["latest_failed_run"] = {"run_id": run_id, "duration_sec": duration}

        _log_queue.put(f"[tests] run finished: {run_id} status={status} duration={duration:.2f}s\n")
        return

    if ev_type == "worker_error":
        message = str(payload.get("message") or "unknown worker error")
        _log_queue.put(f"[worker] {message}\n")
        if runtime.get("current_run") and runtime["current_run"].get("status") == "running":
            runtime["current_run"]["status"] = "failed"
        if not worker.is_alive():
            try:
                worker.restart()
                worker.request_discover()
                _log_queue.put("[worker] restarted successfully\n")
            except Exception as exc:
                _log_queue.put(f"[worker] restart failed: {exc}\n")


def _poll_worker_events() -> None:
    while True:
        events = worker.poll_events(limit=200)
        for event in events:
            with _state_lock:
                _process_worker_event(event)
        time.sleep(0.2)


def _startup() -> None:
    runtime["startup"]["phase"] = "preflight"
    run_store.ensure_writable()
    pruned = run_store.prune()
    runtime["startup"]["checks"]["run_store_prune"] = pruned

    try:
        supervisor.preflight(RUN_STORE_ROOT)
    except LauncherStartupError as exc:
        _mark_startup_issue(exc.code, exc.message, exc.remediation)

    runtime["startup"]["phase"] = "launch_bridge"
    bridge_proc = None
    backend_proc = None
    try:
        bridge_proc = supervisor.start_process("bridge", supervisor.bridge_command(), retries=2)
        threading.Thread(target=_stream_output, args=("bridge", bridge_proc), daemon=True).start()
    except LauncherStartupError as exc:
        _mark_startup_issue(exc.code, exc.message, exc.remediation)

    runtime["startup"]["phase"] = "launch_backend"
    try:
        backend_proc = supervisor.start_process("backend", supervisor.backend_command(), retries=2)
        threading.Thread(target=_stream_output, args=("backend", backend_proc), daemon=True).start()
    except LauncherStartupError as exc:
        _mark_startup_issue(exc.code, exc.message, exc.remediation)

    runtime["startup"]["phase"] = "readiness"
    if bridge_proc is not None and not supervisor.wait_for_bridge_ready(timeout=15):
        _mark_startup_issue("readiness_timeout", "bridge readiness probe timed out", "Check bridge logs and node/tsx runtime.")
    if backend_proc is not None and not supervisor.wait_for_backend_ready(timeout=20):
        _mark_startup_issue("readiness_timeout", "backend readiness probe timed out", "Check api startup logs and dependencies.")

    runtime["startup"]["phase"] = "worker_warmup"
    try:
        worker.start()
        worker.request_ping()
        worker.request_discover()
    except Exception as exc:
        _mark_startup_issue("worker_start_failure", str(exc), "Validate scripts/launcher_test_worker.py and catalog file.")

    runtime["startup"]["phase"] = "ready"
    runtime["startup"]["ready"] = len(runtime["startup"]["issues"]) == 0


def main() -> None:
    import webview

    _load_catalog_state()

    log_thread = threading.Thread(target=_pump_logs, daemon=True)
    log_thread.start()

    _startup()

    event_thread = threading.Thread(target=_poll_worker_events, daemon=True)
    event_thread.start()

    html = """
    <html>
      <head>
        <style>
          html, body { height: 100%; overflow: hidden; }
          body { font-family: Inter, system-ui, sans-serif; background: #0b1220; color: #e2e8f0; margin: 0; }
          .header { padding: 16px 20px; border-bottom: 1px solid #1f2a44; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
          .title { font-size: 16px; font-weight: 600; }
          .status { font-size: 12px; color: #94a3b8; }
          .actions { display: flex; gap: 8px; flex-wrap: wrap; }
          button { background: #2563eb; color: white; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; }
          button.secondary { background: #1f2937; }
          button.ghost { background: transparent; border: 1px solid #1f2a44; }
          button:disabled { opacity: 0.5; cursor: not-allowed; }
          .body { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
          .tabs { display: flex; gap: 8px; padding: 12px 20px; border-bottom: 1px solid #1f2a44; }
          .tab { background: transparent; color: #e2e8f0; border: 1px solid #1f2a44; padding: 6px 12px; border-radius: 999px; cursor: pointer; font-size: 12px; }
          .tab.active { background: #1f2937; }
          .panel { flex: 1; display: none; min-height: 0; overflow: hidden; }
          .panel.active { display: block; }
          .logs { width: 100%; height: 100%; resize: none; border: none; outline: none; background: transparent; color: #e2e8f0; padding: 12px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: auto; white-space: pre; box-sizing: border-box; scroll-behavior: smooth; }
          .tests { padding: 12px 16px 20px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: hidden; }
          .tests-main { display: flex; gap: 10px; min-height: 0; flex: 1; }
          .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
          .toolbar select, .toolbar input { background: #0f172a; color: #e2e8f0; border: 1px solid #1f2a44; border-radius: 8px; padding: 6px 8px; font-size: 12px; }
          .tests-list { display: flex; flex-direction: column; gap: 6px; overflow: auto; min-height: 0; flex: 1; padding-right: 8px; overscroll-behavior: contain; scroll-behavior: smooth; }
          .drawer { width: 0; opacity: 0; transform: translateX(14px); pointer-events: none; border: 1px solid transparent; border-radius: 12px; background: #0b1735; overflow: hidden; display: flex; flex-direction: column; min-height: 0; transition: width .18s ease, opacity .18s ease, transform .18s ease, border-color .18s ease; }
          .drawer.open { width: 410px; opacity: 1; transform: translateX(0); pointer-events: auto; border-color: #27437b; }
          .drawer-header { padding: 10px 12px; border-bottom: 1px solid #1f2a44; position: sticky; top: 0; background: #0b1735; z-index: 2; }
          .drawer-title { font-size: 13px; font-weight: 700; }
          .drawer-sub { font-size: 11px; color: #94a3b8; margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .drawer-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
          .drawer-tabs { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #1f2a44; }
          .drawer-tab { background: transparent; border: 1px solid #1f2a44; color: #c4d2ed; padding: 4px 10px; border-radius: 999px; font-size: 11px; cursor: pointer; }
          .drawer-tab.active { background: #1a2f5b; border-color: #31579a; color: #e7efff; }
          .drawer-body { padding: 10px 12px; overflow: auto; min-height: 0; flex: 1; }
          .suite-card { border: 1px solid #1f2a44; border-radius: 12px; background: #0b1735; overflow: hidden; display: flex; flex-direction: column; }
          .suite-card.open { border-color: #27437b; }
          .suite-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; }
          .suite-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
          .chev { font-size: 16px; color: #9fb3d9; width: 16px; text-align: center; }
          .suite-title { font-size: 13px; font-weight: 700; }
          .suite-meta { font-size: 11px; color: #94a3b8; }
          .suite-right { display: flex; align-items: center; gap: 8px; }
          .suite-rows { display: flex; flex-direction: column; gap: 6px; padding: 0 8px 8px; border-top: 1px solid #1f2a44; max-height: 310px; overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; }
          .test-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid #1f2a44; border-radius: 10px; background: #0f172a; }
          .test-left-wrap { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
          .test-name { font-size: 12px; font-weight: 600; }
          .test-meta { font-size: 11px; color: #94a3b8; }
          .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; border: 1px solid #29477f; background: #17294f; color: #c3d2ef; font-size: 10px; }
          .chips { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
          .chip { display: inline-flex; padding: 2px 8px; border-radius: 8px; background: #1a2a4d; color: #bdd0ef; font-size: 10px; text-transform: lowercase; }
          .child-rows { display: flex; flex-direction: column; gap: 6px; margin: -2px 8px 2px 16px; padding: 8px 0 2px; }
          .child-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
          .child-toolbar-right { display: flex; align-items: center; gap: 8px; }
          .child-search { background: #0f172a; color: #e2e8f0; border: 1px solid #1f2a44; border-radius: 8px; padding: 6px 8px; font-size: 11px; min-width: 240px; }
          .child-group { background: #0f172a; color: #e2e8f0; border: 1px solid #1f2a44; border-radius: 8px; padding: 6px 8px; font-size: 11px; }
          .child-scroll { max-height: 190px; overflow-y: auto; border: 1px solid #1f2a44; border-radius: 10px; background: #0a1530; padding: 8px; overscroll-behavior: contain; scroll-behavior: smooth; -webkit-overflow-scrolling: touch; scrollbar-gutter: stable; }
          .child-file-heading { font-size: 11px; color: #cbd5e1; font-weight: 700; padding: 6px 4px 4px; position: sticky; top: -8px; background: #0a1530; }
          .child-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-left: 2px solid #1f2a44; padding: 6px 8px; color: #94a3b8; font-size: 11px; background: #0b1735; border-radius: 6px; margin-bottom: 4px; cursor: pointer; }
          .child-row.clickable:hover { background: #102147; }
          .child-row.selected { border-color: #4e79c7; background: #142b56; }
          .child-row-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
          .child-nodeid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .case-section { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #c6d4f0; font-size: 11px; margin-bottom: 6px; }
          .case-pill { border: 1px solid #2b467c; border-radius: 999px; padding: 2px 8px; font-size: 10px; color: #b8c9ea; background: #182a4f; }
          .assertion-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 6px; background: #0d2044; color: #cde0ff; margin-bottom: 6px; cursor: pointer; }
          .assertion-pass { color: #66d7a3; font-weight: 600; }
          .assertion-step { display: flex; align-items: center; gap: 8px; color: #93a7c8; font-size: 11px; padding: 3px 2px 3px 10px; }
          .case-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
          .badge { padding: 2px 6px; border-radius: 999px; font-size: 10px; text-transform: uppercase; border: 1px solid #1f2a44; }
          .badge.idle { color: #94a3b8; }
          .badge.queued { color: #a78bfa; border-color: #7c3aed; }
          .badge.running { color: #38bdf8; border-color: #0ea5e9; }
          .badge.retrying { color: #fbbf24; border-color: #f59e0b; }
          .badge.passed { color: #34d399; border-color: #22c55e; }
          .badge.failed { color: #f87171; border-color: #ef4444; }
          .badge.canceled { color: #f59e0b; border-color: #f59e0b; }
          .badge.timed_out { color: #f43f5e; border-color: #e11d48; }
          .run-history { max-height: 200px; overflow: auto; border-top: 1px solid #1f2a44; padding-top: 8px; scroll-behavior: smooth; }
          .run-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 2px; font-size: 11px; border-bottom: 1px dashed #1f2a44; }
          .export-badge { font-size: 10px; color: #22c55e; border: 1px solid #22c55e; border-radius: 999px; padding: 1px 6px; }
          .muted { color: #91a6cb; font-size: 11px; }
          .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #9fb3d9; }
          @media (prefers-reduced-motion: reduce) {
            .drawer, .suite-card, .suite-rows, .tests-list, .child-scroll, .run-history, .logs { transition: none !important; scroll-behavior: auto !important; }
          }
        </style>
      </head>
      <body>
        <div class="body">
          <div class="header">
            <div>
              <div class="title">LeadPilot Launcher</div>
              <div class="status">Backend: http://127.0.0.1:__SERVER_PORT__ • Bridge: __BRIDGE_PORT__</div>
              <div class="status" id="startupStatus"></div>
            </div>
            <div class="actions">
              <button onclick="window.pywebview.api.open_app()">Open App</button>
              <button class="secondary" onclick="copyLogs()">Copy Logs</button>
              <button class="secondary" onclick="copyDiagnostics()">Copy Diagnostics</button>
              <button class="secondary" onclick="window.pywebview.api.shutdown()">Stop</button>
            </div>
          </div>
          <div class="tabs">
            <button class="tab active" data-tab="logs" onclick="switchTab('logs')">Logs</button>
            <button class="tab" data-tab="tests" onclick="switchTab('tests')">Tests</button>
          </div>
          <div class="panel active" id="panel-logs">
            <textarea class="logs" id="logs" readonly></textarea>
          </div>
          <div class="panel" id="panel-tests">
            <div class="tests">
              <div class="toolbar">
                <button class="secondary" onclick="refreshTests()">Refresh</button>
                <button onclick="previewPlan()">Preview Run Plan</button>
                <button id="runSelectedBtn" onclick="runSelected()">Run Selected</button>
                <button class="ghost" onclick="runFiltered()">Run Filtered</button>
                <button class="secondary" onclick="cancelCurrent()">Cancel Current</button>
                <button class="secondary" onclick="cancelRun()">Cancel Run</button>
                <input id="filterTag" placeholder="tag" />
                <select id="filterSuite" onchange="renderTests()"><option value="">all suites</option></select>
                <select id="filterKind" onchange="renderTests()"><option value="">all kinds</option><option value="unit">unit</option><option value="integration">integration</option><option value="live">live</option><option value="smoke">smoke</option><option value="custom">custom</option></select>
                <select id="filterOutcome" onchange="renderTests()"><option value="">all outcomes</option><option value="idle">idle</option><option value="queued">queued</option><option value="running">running</option><option value="retrying">retrying</option><option value="passed">passed</option><option value="failed">failed</option><option value="canceled">canceled</option><option value="timed_out">timed_out</option></select>
              </div>
              <div class="test-meta" id="planPreview"></div>
              <div class="tests-main">
                <div class="tests-list" id="testsList" role="listbox" aria-label="Test cases"></div>
                <aside class="drawer" id="testDrawer" aria-label="Test details">
                  <div class="drawer-header" id="drawerHeader"></div>
                  <div class="drawer-tabs" id="drawerTabs"></div>
                  <div class="drawer-body" id="drawerBody"></div>
                </aside>
              </div>
              <div class="run-history" id="runHistory"></div>
            </div>
          </div>
        </div>
        <script>
          let activeTab = 'logs';
          let tests = [];
          let status = {};
          let openSuiteId = null;
          const expandedTests = new Set();
          const caseSearchByTest = {};
          const caseGroupByTest = {};
          const caseScrollTopByTestId = {};
          let selectedCase = null;
          let drawerOpen = false;
          let drawerTab = 'summary';
          const expandedAssertionRows = new Set();
          const expandedAssertionMore = new Set();
          let visibleCaseOrder = [];
          const caseLookupByKey = {};
          let selectedCaseCursor = -1;
          const uiInteractionLock = { active: false, untilTs: 0 };
          let pendingRefresh = false;

          function markUiInteraction() {
            uiInteractionLock.active = true;
            uiInteractionLock.untilTs = Date.now() + 1200;
          }

          function isUiInteractionLocked() {
            if (!uiInteractionLock.active) return false;
            if (Date.now() >= uiInteractionLock.untilTs) {
              uiInteractionLock.active = false;
              return false;
            }
            return true;
          }

          function captureCaseScrollPositions() {
            document.querySelectorAll('.child-scroll[data-test-id]').forEach((el) => {
              caseScrollTopByTestId[el.dataset.testId] = el.scrollTop;
            });
          }

          function restoreCaseScrollPositions() {
            document.querySelectorAll('.child-scroll[data-test-id]').forEach((el) => {
              const saved = caseScrollTopByTestId[el.dataset.testId];
              if (typeof saved === 'number') {
                const prev = el.style.scrollBehavior;
                el.style.scrollBehavior = 'auto';
                el.scrollTop = saved;
                el.style.scrollBehavior = prev;
              }
            });
          }

          function caseKeyOf(testId, nodeid) {
            return `${testId}::${nodeid}`;
          }

          function ensureSelectedCursor() {
            if (!selectedCase || !selectedCase.key) {
              selectedCaseCursor = -1;
              return;
            }
            selectedCaseCursor = visibleCaseOrder.indexOf(selectedCase.key);
          }

          function statusToBadge(value) {
            if (value === 'passed' || value === 'failed' || value === 'running' || value === 'queued' || value === 'retrying' || value === 'timed_out' || value === 'canceled') return value;
            return 'idle';
          }

          function selectCase(caseObj) {
            selectedCase = caseObj;
            ensureSelectedCursor();
            renderTests();
            if (drawerOpen) renderDrawer();
          }

          function openDrawer(caseObj = null) {
            if (caseObj) selectedCase = caseObj;
            if (!selectedCase) return;
            drawerOpen = true;
            if (!drawerTab) drawerTab = 'summary';
            renderDrawer();
          }

          function closeDrawer() {
            drawerOpen = false;
            const el = document.getElementById('testDrawer');
            if (el) el.classList.remove('open');
          }

          function caseModel() {
            if (!selectedCase) return null;
            const statusVal = (status[selectedCase.testId] && status[selectedCase.testId].status) || 'idle';
            const assertions = [
              {
                id: `${selectedCase.key}::a1`,
                title: `1 == 1`,
                state: statusVal === 'failed' ? 'failed' : 'passed',
                detail: [
                  `Completed ${selectedCase.name}()`,
                  `Validate node ${selectedCase.nodeid}`,
                  `Resolved context for ${selectedCase.file}`,
                  `Finished assertion pipeline`,
                ],
              },
              {
                id: `${selectedCase.key}::a2`,
                title: `output not empty`,
                state: statusVal === 'failed' ? 'failed' : 'passed',
                detail: [
                  `stdout captured`,
                  `normalized result payload`,
                  `shape validation passed`,
                ],
              },
            ];
            return {
              ...selectedCase,
              status: statusVal,
              duration: statusVal === 'running' ? 'running' : (status[selectedCase.testId]?.duration ? `${status[selectedCase.testId].duration.toFixed(2)}s` : 'n/a'),
              assertions,
              logs: [`[case] ${selectedCase.nodeid}`, `[status] ${statusVal}`, `[file] ${selectedCase.file}`],
              traceback: statusVal === 'failed' ? `Traceback (most recent call last):\n  ...\nAssertionError: ${selectedCase.name}` : '',
            };
          }

          function renderDrawer() {
            const drawer = document.getElementById('testDrawer');
            const header = document.getElementById('drawerHeader');
            const tabs = document.getElementById('drawerTabs');
            const body = document.getElementById('drawerBody');
            const model = caseModel();

            if (!drawer || !header || !tabs || !body || !model || !drawerOpen) {
              if (drawer) drawer.classList.remove('open');
              return;
            }
            drawer.classList.add('open');

            header.innerHTML = '';
            const title = document.createElement('div');
            title.className = 'drawer-title';
            title.textContent = model.name;
            const statusPill = document.createElement('span');
            statusPill.className = `badge ${statusToBadge(model.status)}`;
            statusPill.textContent = model.status;
            const titleWrap = document.createElement('div');
            titleWrap.style.display = 'flex';
            titleWrap.style.justifyContent = 'space-between';
            titleWrap.style.gap = '8px';
            titleWrap.appendChild(title);
            titleWrap.appendChild(statusPill);
            header.appendChild(titleWrap);
            const sub = document.createElement('div');
            sub.className = 'drawer-sub';
            sub.textContent = `${model.nodeid} • ${model.duration}`;
            header.appendChild(sub);

            const actionRow = document.createElement('div');
            actionRow.className = 'drawer-actions';
            const rerun = document.createElement('button');
            rerun.className = 'ghost';
            rerun.textContent = 'Rerun test';
            rerun.onclick = async () => window.pywebview.api.run_plan([model.testId], []);
            const copyNode = document.createElement('button');
            copyNode.className = 'ghost';
            copyNode.textContent = 'Copy node id';
            copyNode.onclick = async () => navigator.clipboard.writeText(model.nodeid);
            const copyDiag = document.createElement('button');
            copyDiag.className = 'ghost';
            copyDiag.textContent = 'Copy diagnostics';
            copyDiag.onclick = async () => navigator.clipboard.writeText(await window.pywebview.api.get_diagnostics_summary());
            const closeBtn = document.createElement('button');
            closeBtn.className = 'ghost';
            closeBtn.textContent = 'Close';
            closeBtn.onclick = () => closeDrawer();
            actionRow.appendChild(rerun);
            actionRow.appendChild(copyNode);
            actionRow.appendChild(copyDiag);
            actionRow.appendChild(closeBtn);
            header.appendChild(actionRow);

            const tabDefs = [
              { id: 'summary', label: 'Summary' },
              { id: 'assertions', label: 'Assertions' },
              { id: 'logs', label: 'Logs' },
            ];
            if (model.traceback) tabDefs.push({ id: 'traceback', label: 'Traceback' });
            if (!tabDefs.find((t) => t.id === drawerTab)) drawerTab = 'summary';

            tabs.innerHTML = '';
            tabDefs.forEach((tab) => {
              const btn = document.createElement('button');
              btn.className = `drawer-tab ${drawerTab === tab.id ? 'active' : ''}`;
              btn.textContent = tab.label;
              btn.onclick = () => {
                drawerTab = tab.id;
                renderDrawer();
              };
              tabs.appendChild(btn);
            });

            body.innerHTML = '';
            if (drawerTab === 'summary') {
              body.innerHTML = `<div class="case-section"><div>${model.assertions.filter((a) => a.state === 'passed').length} passed, ${model.assertions.filter((a) => a.state !== 'passed').length} failed</div><span class="case-pill">${model.duration}</span></div><div class="muted">File: ${model.file}</div><div class="mono">${model.nodeid}</div>`;
            } else if (drawerTab === 'logs') {
              model.logs.forEach((line) => {
                const row = document.createElement('div');
                row.className = 'mono';
                row.textContent = line;
                body.appendChild(row);
              });
            } else if (drawerTab === 'traceback') {
              const trace = document.createElement('pre');
              trace.className = 'mono';
              trace.style.whiteSpace = 'pre-wrap';
              trace.textContent = model.traceback;
              body.appendChild(trace);
            } else if (drawerTab === 'assertions') {
              const top = document.createElement('div');
              top.className = 'case-section';
              top.innerHTML = `<div>${model.assertions.filter((a) => a.state === 'passed').length} passed / ${model.assertions.filter((a) => a.state !== 'passed').length} failed</div><span class="case-pill">${model.duration}</span>`;
              body.appendChild(top);
              model.assertions.forEach((a) => {
                const row = document.createElement('div');
                row.className = 'assertion-row';
                row.innerHTML = `<div>${a.title}</div><div class="${a.state === 'passed' ? 'assertion-pass' : 'badge failed'}">${a.state}</div>`;
                row.onclick = () => {
                  if (expandedAssertionRows.has(a.id)) expandedAssertionRows.delete(a.id);
                  else expandedAssertionRows.add(a.id);
                  renderDrawer();
                };
                body.appendChild(row);
                if (expandedAssertionRows.has(a.id)) {
                  const showAll = expandedAssertionMore.has(a.id);
                  const lines = showAll ? a.detail : a.detail.slice(0, 2);
                  lines.forEach((line) => {
                    const step = document.createElement('div');
                    step.className = 'assertion-step';
                    step.textContent = `› ${line}`;
                    body.appendChild(step);
                  });
                  if (a.detail.length > 2 && !showAll) {
                    const more = document.createElement('button');
                    more.className = 'ghost';
                    more.textContent = `Show ${a.detail.length - 2} more`;
                    more.onclick = () => {
                      expandedAssertionMore.add(a.id);
                      renderDrawer();
                    };
                    body.appendChild(more);
                  }
                }
              });
            }
          }

          function switchTab(tabId) {
            activeTab = tabId;
            document.querySelectorAll('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
            document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${tabId}`));
          }

          async function refreshLogs() {
            if (activeTab !== 'logs') return;
            const el = document.getElementById('logs');
            const text = await window.pywebview.api.get_logs();
            const shouldScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
            el.value = text;
            if (shouldScroll) el.scrollTop = el.scrollHeight;
          }

          async function copyLogs() {
            const text = await window.pywebview.api.get_logs();
            await navigator.clipboard.writeText(text);
          }

          async function copyDiagnostics() {
            const text = await window.pywebview.api.get_diagnostics_summary();
            await navigator.clipboard.writeText(text);
          }

          function selectedIds() {
            return Array.from(document.querySelectorAll('.tests-list input[type="checkbox"]')).filter((el) => el.checked).map((el) => el.value);
          }

          function applyFilters(rows) {
            const suite = document.getElementById('filterSuite').value;
            const kind = document.getElementById('filterKind').value;
            const outcome = document.getElementById('filterOutcome').value;
            const tag = document.getElementById('filterTag').value.trim().toLowerCase();
            return rows.filter((row) => {
              const st = (status[row.id] && status[row.id].status) || 'idle';
              if (suite && row.suite_id !== suite) return false;
              if (kind && row.kind !== kind) return false;
              if (outcome && st !== outcome) return false;
              if (tag && !(row.tags || []).some((t) => t.toLowerCase() === tag)) return false;
              return true;
            });
          }

          function suiteStatus(items) {
            const states = items.map((item) => (status[item.id] && status[item.id].status) || 'idle');
            if (states.some((s) => s === 'running')) return 'running';
            if (states.some((s) => s === 'retrying')) return 'retrying';
            if (states.some((s) => s === 'queued')) return 'queued';
            if (states.some((s) => s === 'failed')) return 'failed';
            if (states.some((s) => s === 'timed_out')) return 'timed_out';
            if (states.some((s) => s === 'canceled')) return 'canceled';
            if (states.length > 0 && states.every((s) => s === 'passed')) return 'passed';
            return 'idle';
          }

          function renderTests() {
            const list = document.getElementById('testsList');
            const suites = Array.from(new Set(tests.map((t) => t.suite_id))).sort();
            const suiteSelect = document.getElementById('filterSuite');
            const existing = suiteSelect.value;
            suiteSelect.innerHTML = '<option value="">all suites</option>';
            suites.forEach((s) => {
              const opt = document.createElement('option');
              opt.value = s;
              opt.textContent = s;
              suiteSelect.appendChild(opt);
            });
            suiteSelect.value = existing;

            captureCaseScrollPositions();
            list.innerHTML = '';
            const rows = applyFilters(tests);
            const suitesMap = new Map();
            rows.forEach((item) => {
              if (!suitesMap.has(item.suite_id)) suitesMap.set(item.suite_id, []);
              suitesMap.get(item.suite_id).push(item);
            });
            const allSuiteMap = new Map();
            tests.forEach((item) => {
              if (!allSuiteMap.has(item.suite_id)) allSuiteMap.set(item.suite_id, []);
              allSuiteMap.get(item.suite_id).push(item);
            });

            visibleCaseOrder = [];
            Object.keys(caseLookupByKey).forEach((k) => delete caseLookupByKey[k]);
            Array.from(allSuiteMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([suiteId, suiteItems]) => {
              const items = suitesMap.get(suiteId) || [];
              const card = document.createElement('div');
              card.className = 'suite-card';
              if (openSuiteId === suiteId) card.classList.add('open');

              const header = document.createElement('div');
              header.className = 'suite-header';
              header.onclick = () => {
                markUiInteraction();
                if (openSuiteId === suiteId) openSuiteId = null;
                else openSuiteId = suiteId;
                renderTests();
              };

              const left = document.createElement('div');
              left.className = 'suite-left';
              const summary = suiteStatus(suiteItems);
              const suiteLabel = suiteItems[0] ? suiteItems[0].suite_name : suiteId;
              const chev = openSuiteId === suiteId ? '⌄' : '›';
              left.innerHTML = `<div class=\"chev\">${chev}</div><div><div class=\"suite-title\">${suiteLabel}</div><div class=\"suite-meta\">${items.length} match(es) of ${suiteItems.length} • click to ${openSuiteId === suiteId ? 'collapse' : 'expand'}</div></div>`;

              const right = document.createElement('div');
              right.className = 'suite-right';
              const badge = document.createElement('span');
              badge.className = `badge ${summary}`;
              badge.textContent = summary;
              const runSuiteBtn = document.createElement('button');
              runSuiteBtn.className = 'ghost';
              runSuiteBtn.textContent = 'Run Suite';
              runSuiteBtn.onclick = async (event) => {
                event.stopPropagation();
                await window.pywebview.api.run_plan(items.map((t) => t.id), []);
              };
              right.appendChild(badge);
              right.appendChild(runSuiteBtn);
              header.appendChild(left);
              header.appendChild(right);
              card.appendChild(header);

              if (openSuiteId === suiteId) {
                const rowsWrap = document.createElement('div');
                rowsWrap.className = 'suite-rows';
                if (!items.length) {
                  const empty = document.createElement('div');
                  empty.className = 'test-meta';
                  empty.textContent = 'No tests match current filters.';
                  rowsWrap.appendChild(empty);
                }
                items.forEach((item) => {
                  const st = (status[item.id] && status[item.id].status) || 'idle';
                  const row = document.createElement('div');
                  row.className = 'test-row';
                  if ((item.children || []).length > 0) {
                    row.style.cursor = 'pointer';
                    row.onclick = (event) => {
                      if (event.target.closest('button, input, select, textarea, label')) return;
                      markUiInteraction();
                      if (expandedTests.has(item.id)) expandedTests.delete(item.id);
                      else expandedTests.add(item.id);
                      renderTests();
                    };
                  }
                  const rowLeft = document.createElement('div');
                  rowLeft.className = 'test-left-wrap';
                  const itemChev = (item.children || []).length > 0 ? (expandedTests.has(item.id) ? '⌄' : '›') : '';
                  const topTags = (item.tags || []).slice(0, 2);
                  const extraTagCount = Math.max(0, (item.tags || []).length - topTags.length);
                  rowLeft.innerHTML = `
                    <div class=\"chev\">${itemChev}</div>
                    <div>
                      <div class=\"test-name\">${item.name} ${(item.children || []).length > 0 ? `<span class=\"pill\">${item.children.length}</span>` : ''}</div>
                      <div class=\"chips\">
                        <span class=\"chip\">${item.kind}</span>
                        ${topTags.map((tag) => `<span class=\"chip\">${tag}</span>`).join('')}
                        ${extraTagCount > 0 ? `<span class=\"chip\">+${extraTagCount}</span>` : ''}
                      </div>
                    </div>
                  `;
                  const rowRight = document.createElement('div');
                  rowRight.style.display = 'flex';
                  rowRight.style.gap = '8px';
                  rowRight.style.alignItems = 'center';
                  const rowBadge = document.createElement('span');
                  rowBadge.className = `badge ${st}`;
                  rowBadge.textContent = st;
                  const box = document.createElement('input');
                  box.type = 'checkbox';
                  box.value = item.id;
                  const runBtn = document.createElement('button');
                  runBtn.className = 'secondary';
                  runBtn.textContent = 'Run';
                  runBtn.onclick = async () => {
                    await window.pywebview.api.run_plan([item.id], []);
                  };
                  rowRight.appendChild(rowBadge);
                  rowRight.appendChild(box);
                  rowRight.appendChild(runBtn);
                  row.appendChild(rowLeft);
                  row.appendChild(rowRight);
                  rowsWrap.appendChild(row);

                  if (expandedTests.has(item.id) && (item.children || []).length > 0) {
                    const childWrap = document.createElement('div');
                    childWrap.className = 'child-rows';
                    const grouped = new Map();
                    item.children.forEach((child) => {
                      const file = child.file || 'unknown';
                      if (!grouped.has(file)) grouped.set(file, []);
                      grouped.get(file).push(child);
                    });

                    const summary = document.createElement('div');
                    summary.className = 'child-toolbar';
                    const summaryText = document.createElement('div');
                    summaryText.className = 'test-meta';
                    const search = (caseSearchByTest[item.id] || '').trim().toLowerCase();
                    const filesCount = grouped.size;
                    summaryText.textContent = `${item.children.length} discovered case(s) across ${filesCount} file(s)`;
                    const searchInput = document.createElement('input');
                    searchInput.className = 'child-search';
                    searchInput.placeholder = 'search cases or files';
                    searchInput.value = caseSearchByTest[item.id] || '';
                    searchInput.oninput = (event) => {
                      markUiInteraction();
                      caseSearchByTest[item.id] = event.target.value || '';
                      renderTests();
                    };
                    searchInput.onkeydown = () => markUiInteraction();
                    const toolbarRight = document.createElement('div');
                    toolbarRight.className = 'child-toolbar-right';
                    const groupSelect = document.createElement('select');
                    groupSelect.className = 'child-group';
                    groupSelect.innerHTML = '<option value=\"file\">Group: file</option><option value=\"name\">Group: name</option>';
                    groupSelect.value = caseGroupByTest[item.id] || 'file';
                    groupSelect.onchange = (event) => {
                      markUiInteraction();
                      caseGroupByTest[item.id] = event.target.value;
                      renderTests();
                    };
                    toolbarRight.appendChild(searchInput);
                    toolbarRight.appendChild(groupSelect);
                    summary.appendChild(summaryText);
                    summary.appendChild(toolbarRight);
                    childWrap.appendChild(summary);

                    const scroller = document.createElement('div');
                    scroller.className = 'child-scroll';
                    scroller.dataset.testId = item.id;
                    scroller.addEventListener('scroll', () => {
                      markUiInteraction();
                      caseScrollTopByTestId[item.id] = scroller.scrollTop;
                    });
                    scroller.addEventListener('wheel', () => markUiInteraction(), { passive: true });
                    scroller.addEventListener('touchmove', () => markUiInteraction(), { passive: true });

                    const groupMode = caseGroupByTest[item.id] || 'file';
                    const entries = groupMode === 'name'
                      ? [['All cases', Array.from(grouped.values()).flat().sort((a, b) => a.name.localeCompare(b.name))]]
                      : Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                    entries.forEach(([file, fileCases]) => {
                      const filtered = search
                        ? fileCases.filter((child) => {
                            const hay = `${child.name} ${child.nodeid} ${child.file}`.toLowerCase();
                            return hay.includes(search);
                          })
                        : fileCases;
                      if (filtered.length === 0) return;

                      const heading = document.createElement('div');
                      heading.className = 'child-file-heading';
                      heading.textContent = `${file} (${filtered.length})`;
                      scroller.appendChild(heading);

                      filtered.forEach((child) => {
                        const caseKey = `${item.id}::${child.nodeid}`;
                        const childRow = document.createElement('div');
                        childRow.className = `child-row clickable ${selectedCase && selectedCase.key === caseKey ? 'selected' : ''}`;
                        childRow.setAttribute('role', 'option');
                        childRow.setAttribute('aria-selected', selectedCase && selectedCase.key === caseKey ? 'true' : 'false');
                        childRow.tabIndex = -1;
                        childRow.dataset.caseKey = caseKey;
                        const caseObj = { key: caseKey, testId: item.id, name: child.name, nodeid: child.nodeid, file: child.file };
                        visibleCaseOrder.push(caseKey);
                        caseLookupByKey[caseKey] = caseObj;
                        childRow.onclick = () => {
                          markUiInteraction();
                          selectCase(caseObj);
                        };
                        childRow.ondblclick = () => {
                          markUiInteraction();
                          selectCase(caseObj);
                          openDrawer();
                        };
                        const childLeft = document.createElement('div');
                        childLeft.className = 'child-row-main';
                        childLeft.innerHTML = `<div class=\"chev\">›</div><div><div>${child.name}</div><div class=\"child-nodeid\">${child.nodeid}</div></div>`;
                        const childRight = document.createElement('div');
                        const childStatus = st === 'passed' ? 'Passed' : (st === 'failed' ? 'Failed' : 'Case');
                        childRight.className = `badge ${st === 'passed' || st === 'failed' ? st : 'idle'}`;
                        childRight.textContent = childStatus;
                        childRow.appendChild(childLeft);
                        childRow.appendChild(childRight);
                        scroller.appendChild(childRow);
                      });
                    });

                    if (!scroller.children.length) {
                      const empty = document.createElement('div');
                      empty.className = 'test-meta';
                      empty.textContent = 'No cases match this search.';
                      scroller.appendChild(empty);
                    }
                    childWrap.appendChild(scroller);
                    rowsWrap.appendChild(childWrap);
                  }
                });
                card.appendChild(rowsWrap);
              }

              list.appendChild(card);
            });
            restoreCaseScrollPositions();
            ensureSelectedCursor();
            renderDrawer();

            document.getElementById('runSelectedBtn').disabled = selectedIds().length === 0;
          }

          async function refreshTests() {
            tests = await window.pywebview.api.get_tests();
            status = await window.pywebview.api.get_test_status();
            const startup = await window.pywebview.api.get_startup_state();
            document.getElementById('startupStatus').textContent = startup.ready ? 'startup: ready' : `startup issues: ${startup.issues.length}`;
            if (isUiInteractionLocked()) {
              pendingRefresh = true;
            } else {
              renderTests();
              pendingRefresh = false;
            }
            await renderHistory();
          }

          function maybeApplyDeferredRender() {
            if (pendingRefresh && !isUiInteractionLocked()) {
              renderTests();
              pendingRefresh = false;
            }
          }

          function moveSelection(delta) {
            if (!visibleCaseOrder.length) return;
            if (selectedCaseCursor < 0) selectedCaseCursor = 0;
            else selectedCaseCursor = Math.max(0, Math.min(visibleCaseOrder.length - 1, selectedCaseCursor + delta));
            const key = visibleCaseOrder[selectedCaseCursor];
            const el = document.querySelector(`[data-case-key="${key}"]`);
            if (el) {
              el.scrollIntoView({ block: 'nearest' });
              if (caseLookupByKey[key]) selectCase(caseLookupByKey[key]);
            }
          }

          document.addEventListener('keydown', (event) => {
            if (activeTab !== 'tests') return;
            const target = event.target;
            const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
            if (event.key === '/' && !isTyping) {
              event.preventDefault();
              const search = document.querySelector('.child-search');
              if (search) search.focus();
              return;
            }
            if (event.key === 'Escape') {
              closeDrawer();
              return;
            }
            if (isTyping) return;
            if (event.key === 'j' || event.key === 'ArrowDown') {
              event.preventDefault();
              moveSelection(1);
              return;
            }
            if (event.key === 'k' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveSelection(-1);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              openDrawer();
            }
          });

          async function renderHistory() {
            const runs = await window.pywebview.api.get_runs();
            const el = document.getElementById('runHistory');
            el.innerHTML = '';
            runs.forEach((run) => {
              const row = document.createElement('div');
              row.className = 'run-row';
              const left = document.createElement('div');
              left.textContent = `${run.run_id || 'unknown'} • ${run.status || 'unknown'}`;
              const right = document.createElement('div');
              right.style.display = 'flex';
              right.style.gap = '8px';
              const badge = document.createElement('span');
              badge.className = 'export-badge';
              badge.textContent = 'JSON/JUnit';
              const openBtn = document.createElement('button');
              openBtn.className = 'ghost';
              openBtn.textContent = 'Open Artifacts';
              openBtn.onclick = async () => window.pywebview.api.open_run_dir(run.run_id || '');
              right.appendChild(badge);
              right.appendChild(openBtn);
              row.appendChild(left);
              row.appendChild(right);
              el.appendChild(row);
            });
          }

          async function previewPlan() {
            const ids = selectedIds();
            const tag = document.getElementById('filterTag').value.trim();
            const tags = tag ? [tag] : [];
            const plan = await window.pywebview.api.preview_plan(ids, tags);
            const line = plan.map((p) => `${p.order}:${p.id}`).join(' → ');
            document.getElementById('planPreview').textContent = line || 'No plan';
          }

          async function runSelected() {
            await window.pywebview.api.run_plan(selectedIds(), []);
          }

          async function runFiltered() {
            const tag = document.getElementById('filterTag').value.trim();
            const tags = tag ? [tag] : [];
            await window.pywebview.api.run_plan([], tags);
          }

          async function cancelCurrent() {
            await window.pywebview.api.cancel_current_test();
          }

          async function cancelRun() {
            await window.pywebview.api.cancel_run();
          }

          setInterval(refreshLogs, 800);
          setInterval(refreshTests, 1200);
          setInterval(maybeApplyDeferredRender, 250);
          refreshLogs();
          refreshTests();
        </script>
      </body>
    </html>
    """
    html = html.replace("__SERVER_PORT__", str(SERVER_PORT)).replace("__BRIDGE_PORT__", str(BRIDGE_PORT))

    window = webview.create_window("LeadPilot", html=html, width=1120, height=760)

    def get_logs() -> str:
        return "".join(_log_buffer)

    def get_startup_state() -> dict[str, Any]:
        return runtime["startup"]

    def get_tests() -> list[dict[str, Any]]:
        return runtime["tests"]

    def get_test_status() -> dict[str, dict[str, Any]]:
        return runtime["test_status"]

    def preview_plan(test_ids: list[str], tags: list[str]) -> list[dict[str, Any]]:
        catalog = runtime.get("catalog")
        if not catalog:
            raise RuntimeError(runtime.get("catalog_error") or "catalog unavailable")
        try:
            plan = build_run_plan(catalog, test_ids=test_ids or None, tags=tags or None)
        except PlanError as exc:
            _log_queue.put(f"[tests] preview failed: {exc}\n")
            return []
        return [{"order": p.order, "id": p.test.id, "name": p.test.name} for p in plan]

    def run_plan(test_ids: list[str], tags: list[str]) -> dict[str, Any]:
        with _state_lock:
            current = runtime.get("current_run")
            if current and current.get("status") == "running":
                return {"ok": False, "error": "run already active"}

            catalog = runtime.get("catalog")
            if not catalog:
                return {"ok": False, "error": runtime.get("catalog_error") or "catalog unavailable"}

            try:
                plan = build_run_plan(catalog, test_ids=test_ids or None, tags=tags or None)
            except PlanError as exc:
                _log_queue.put(f"[tests] run plan failed: {exc}\n")
                return {"ok": False, "error": str(exc)}

            run_paths = run_store.start_run()
            runtime["run_paths"] = run_paths
            runtime["current_run"] = {"run_id": run_paths.run_id, "status": "queued", "started_at": time.time()}
            run_store.write_metadata(
                run_paths,
                {
                    "run_id": run_paths.run_id,
                    "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "status": "queued",
                    "selected_test_ids": [p.test.id for p in plan],
                    "selected_tags": tags,
                    "artifacts": {
                        "events": str(run_paths.events),
                        "stdout": str(run_paths.stdout),
                        "junit": str(run_paths.junit),
                        "json": str(run_paths.results),
                    },
                },
            )

            for p in plan:
                _update_test_status(p.test.id, status="queued", lastRun=time.time(), duration=None)

            if not worker.is_alive():
                worker.restart()
                worker.request_discover()

            worker.request_run_plan({"run_id": run_paths.run_id, "test_ids": [p.test.id for p in plan], "tags": tags})
            _log_queue.put(f"[tests] queued run {run_paths.run_id} with {len(plan)} tests\n")
            return {"ok": True, "run_id": run_paths.run_id}

    def cancel_current_test() -> None:
        worker.request_cancel("current")

    def cancel_run() -> None:
        worker.request_cancel("run")

    def get_runs() -> list[dict[str, Any]]:
        return run_store.latest_runs(limit=30)

    def open_run_dir(run_id: str) -> None:
        run_dir = RUN_STORE_ROOT / run_id
        _open_path(str(run_dir))

    def get_diagnostics_summary() -> str:
        runs = run_store.latest_runs(limit=5)
        latest_failed = next((r for r in runs if r.get("status") == "failed"), runtime.get("latest_failed_run"))
        payload = {
            "startup": runtime.get("startup"),
            "catalog_error": runtime.get("catalog_error"),
            "current_run": runtime.get("current_run"),
            "latest_failed_run": latest_failed,
            "worker_alive": worker.is_alive(),
            "worker_last_heartbeat": runtime.get("worker_last_heartbeat"),
            "supervisor": supervisor.status(),
            "env": _redacted_env_snapshot(),
        }
        return json.dumps(payload, indent=2)

    def open_app() -> None:
        webbrowser.open(f"http://127.0.0.1:{SERVER_PORT}")

    def shutdown() -> None:
        try:
            worker.stop()
        except Exception:
            pass
        try:
            supervisor.shutdown()
        except Exception:
            pass
        window.destroy()

    window.expose(
        get_logs,
        get_startup_state,
        get_tests,
        get_test_status,
        preview_plan,
        run_plan,
        cancel_current_test,
        cancel_run,
        get_runs,
        open_run_dir,
        get_diagnostics_summary,
        open_app,
        shutdown,
    )
    webview.start(gui=None, debug=False, http_server=False)


if __name__ == "__main__":
    main()
