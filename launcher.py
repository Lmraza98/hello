"""LeadPilot Launcher

Production-grade internal launcher for backend/bridge startup, diagnostics,
and isolated test orchestration via a manifest-driven worker process.
"""

from __future__ import annotations

import ast
import base64
import hashlib
import json
import mimetypes
import os
import queue
import re
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from launcher_runtime import (
    CatalogError,
    LauncherStartupError,
    PlanError,
    ProcessSupervisor,
    RunTraceRecorder,
    RunStore,
    WorkerClient,
    StepNode,
    StepPlanError,
    build_run_plan,
    build_step_plan,
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
STEP_CACHE_PATH = RUN_STORE_ROOT / "step_cache.json"
CASE_DEPS_PATH = APP_DIR / "config" / "launcher_case_deps.v1.json"
WORKFLOW_STEPS_PATH = APP_DIR / "config" / "launcher_workflow_steps.v1.json"
ENFORCE_LIVE_BROWSER_EVIDENCE = os.getenv("LAUNCHER_ENFORCE_LIVE_EVIDENCE", "").strip().lower() in {"1", "true", "yes"}
LAUNCHER_DEVTOOLS = os.getenv("LAUNCHER_DEVTOOLS", "").strip().lower() in {"1", "true", "yes"}

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
    "case_steps": {},
    "workflow_steps_by_parent": {},
    "step_cache": {},
    "trace_recorder": None,
    "trace_run_id": None,
    "run_test_output_lines": {},
}

supervisor = ProcessSupervisor(app_dir=APP_DIR, server_port=SERVER_PORT, bridge_port=BRIDGE_PORT)
run_store = RunStore(RUN_STORE_ROOT)
worker = WorkerClient(
    worker_script=APP_DIR / "scripts" / "launcher_test_worker.py",
    catalog_path=CATALOG_PATH,
    project_root=APP_DIR,
)

LAUNCHER_FRONTEND_DIR = APP_DIR / "launcher_frontend"


def _npm_command() -> list[str]:
    if sys.platform.startswith("win"):
        return ["npm.cmd"]
    return ["npm"]


def _path_latest_mtime(path: Path, suffixes: tuple[str, ...]) -> float:
    latest = 0.0
    if not path.exists():
        return latest
    for file_path in path.rglob("*"):
        if file_path.is_file() and file_path.suffix in suffixes:
            try:
                latest = max(latest, file_path.stat().st_mtime)
            except OSError:
                continue
    return latest


def _launcher_frontend_needs_build(index_html: Path) -> bool:
    if not index_html.exists():
        return True
    src_latest = _path_latest_mtime(LAUNCHER_FRONTEND_DIR / "src", (".js", ".jsx", ".ts", ".tsx", ".css"))
    config_latest = 0.0
    for p in (
        LAUNCHER_FRONTEND_DIR / "index.html",
        LAUNCHER_FRONTEND_DIR / "vite.config.js",
        LAUNCHER_FRONTEND_DIR / "package.json",
        LAUNCHER_FRONTEND_DIR / "package-lock.json",
    ):
        if p.exists():
            try:
                config_latest = max(config_latest, p.stat().st_mtime)
            except OSError:
                pass
    try:
        dist_mtime = index_html.stat().st_mtime
    except OSError:
        return True
    return max(src_latest, config_latest) > dist_mtime


def _ensure_launcher_frontend_build() -> None:
    if os.getenv("LAUNCHER_SKIP_FRONTEND_BUILD", "").strip().lower() in {"1", "true", "yes"}:
        _log_queue.put("[launcher] skipping launcher_frontend build (LAUNCHER_SKIP_FRONTEND_BUILD)\n")
        return

    index_html = LAUNCHER_FRONTEND_DIR / "dist" / "index.html"
    if not _launcher_frontend_needs_build(index_html):
        return

    npm = _npm_command()
    _log_queue.put("[launcher] launcher_frontend build required; checking dependencies\n")
    node_modules = LAUNCHER_FRONTEND_DIR / "node_modules"
    if not node_modules.exists():
        _log_queue.put("[launcher] installing launcher_frontend dependencies\n")
        subprocess.run([*npm, "install"], cwd=LAUNCHER_FRONTEND_DIR, check=True)

    _log_queue.put("[launcher] building launcher_frontend\n")
    subprocess.run([*npm, "run", "build"], cwd=LAUNCHER_FRONTEND_DIR, check=True)
    _log_queue.put("[launcher] launcher_frontend build complete\n")


def _ensure_case_deps_generated() -> None:
    if os.getenv("LAUNCHER_SKIP_CASE_DEPS_GEN", "").strip().lower() in {"1", "true", "yes"}:
        _log_queue.put("[launcher] skipping case-deps generation (LAUNCHER_SKIP_CASE_DEPS_GEN)\n")
        return
    script_path = APP_DIR / "scripts" / "generate_launcher_case_deps.py"
    if not script_path.exists():
        _log_queue.put(f"[launcher] case-deps generator not found: {script_path}\n")
        return
    try:
        subprocess.run([sys.executable, str(script_path)], cwd=APP_DIR, check=True, capture_output=True, text=True)
        _log_queue.put("[launcher] refreshed config/launcher_case_deps.v1.json\n")
    except Exception as exc:
        _log_queue.put(f"[launcher] case-deps generation failed: {exc}\n")


def _append_log(line: str) -> None:
    _log_buffer.append(line)
    if len(_log_buffer) > LOG_BUFFER_LIMIT:
        del _log_buffer[: len(_log_buffer) - LOG_BUFFER_LIMIT]


def _canonical_child_id(parent_id: str, raw_child_id: str) -> str:
    parent = str(parent_id or "").strip()
    raw = str(raw_child_id or "").strip()
    if not raw:
        return f"{parent}::child"
    if raw.startswith(f"{parent}::"):
        return raw
    return f"{parent}::{raw}"


_CHILD_NOTE_RE = re.compile(r"^\[child-note\]\s+(started|finished)\s*(.*)$", re.IGNORECASE)


def _parse_child_note(line: str) -> tuple[str, str] | None:
    text = str(line or "").strip()
    m = _CHILD_NOTE_RE.match(text)
    if not m:
        return None
    phase = str(m.group(1) or "").lower()
    rest = str(m.group(2) or "").strip()
    return phase, rest


def _load_step_cache() -> dict[str, dict[str, Any]]:
    if not STEP_CACHE_PATH.exists():
        return {}
    try:
        payload = json.loads(STEP_CACHE_PATH.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return {}
        out: dict[str, dict[str, Any]] = {}
        for key, value in payload.items():
            if isinstance(key, str) and isinstance(value, dict):
                out[key] = value
        return out
    except Exception:
        return {}


def _save_step_cache(cache: dict[str, dict[str, Any]]) -> None:
    STEP_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STEP_CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def _step_context_fingerprint() -> str:
    context = {
        "profile": "local",
        "server_port": SERVER_PORT,
        "bridge_port": BRIDGE_PORT,
        "cwd": str(APP_DIR),
        "python": sys.version.split()[0],
        "git_head": os.popen("git rev-parse --short HEAD 2>nul").read().strip() or "unknown",
    }
    raw = json.dumps(context, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _step_cache_key(step: StepNode) -> str:
    material = {
        "id": step.id,
        "cache_key": step.cache_key or step.id,
        "context": _step_context_fingerprint(),
    }
    raw = json.dumps(material, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _git_snapshot() -> dict[str, Any]:
    def _run_git(args: list[str]) -> str:
        try:
            proc = subprocess.run(args, cwd=APP_DIR, capture_output=True, text=True, check=False)
            if proc.returncode == 0:
                return proc.stdout.strip()
        except Exception:
            return ""
        return ""

    commit = _run_git(["git", "rev-parse", "HEAD"])
    branch = _run_git(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    dirty = bool(_run_git(["git", "status", "--porcelain"]))
    return {"commit": commit or None, "branch": branch or None, "dirty": dirty}


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
    runtime["step_cache"] = _load_step_cache()

    def discover_python_cases() -> list[dict[str, Any]]:
        cases: list[dict[str, Any]] = []
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
                            "id": f"python-tests-all::{rel}::{node.name}",
                            "name": node.name,
                            "nodeid": f"{rel}::{node.name}",
                            "file": rel,
                            "depends_on": [],
                        }
                    )
                if isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
                    for child in node.body:
                        if isinstance(child, ast.FunctionDef) and child.name.startswith("test_"):
                            cases.append(
                                {
                                    "id": f"python-tests-all::{rel}::{node.name}::{child.name}",
                                    "name": f"{node.name}.{child.name}",
                                    "nodeid": f"{rel}::{node.name}::{child.name}",
                                    "file": rel,
                                    "depends_on": [],
                                }
                            )
        return cases

    python_cases = discover_python_cases()
    cases_by_file: dict[str, list[dict[str, str]]] = {}
    cases_by_nodeid: dict[str, dict[str, str]] = {}
    for case in python_cases:
        file_key = str(case.get("file") or "")
        node_key = str(case.get("nodeid") or "")
        if file_key:
            cases_by_file.setdefault(file_key, []).append(case)
        if node_key:
            cases_by_nodeid[node_key] = case
    case_dep_map: dict[str, list[str]] = {}
    if CASE_DEPS_PATH.exists():
        try:
            raw_deps = json.loads(CASE_DEPS_PATH.read_text(encoding="utf-8"))
            for item in raw_deps.get("steps", []) if isinstance(raw_deps, dict) else []:
                if not isinstance(item, dict):
                    continue
                sid = str(item.get("id") or "").strip()
                deps = [str(x).strip() for x in item.get("deps", []) if str(x).strip()]
                if sid:
                    case_dep_map[sid] = deps
        except Exception as exc:
            _log_queue.put(f"[catalog] case deps load failed: {exc}\n")

    case_steps: dict[str, StepNode] = {}
    workflow_steps_by_parent: dict[str, list[dict[str, Any]]] = {}
    workflow_step_order_by_parent: dict[str, int] = {}
    for case in python_cases:
        nodeid = str(case.get("nodeid") or "")
        case_id = str(case.get("id") or f"python-tests-all::{nodeid}")
        deps_nodeids = case_dep_map.get(nodeid, []) or case_dep_map.get(case_id, [])
        case["depends_on"] = list(deps_nodeids)
        dep_case_ids = [dep if dep.startswith("python-tests-all::") else f"python-tests-all::{dep}" for dep in deps_nodeids]
        case_steps[case_id] = StepNode(
            id=case_id,
            label=str(case.get("name") or nodeid),
            deps=dep_case_ids,
            kind="assertion",
            cache_key=nodeid,
            provides=[nodeid],
            command_template=[sys.executable, "-m", "pytest"],
            args=["-q", nodeid],
            cwd=".",
            env_allowlist=["PYTEST_ADDOPTS", "PYTHONPATH"],
            timeout_sec=600,
            retries=0,
        )

    if WORKFLOW_STEPS_PATH.exists():
        try:
            raw_workflows = json.loads(WORKFLOW_STEPS_PATH.read_text(encoding="utf-8"))
            rows = raw_workflows.get("steps", []) if isinstance(raw_workflows, dict) else []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                step_id = str(row.get("id") or "").strip()
                if not step_id:
                    continue
                step_label = str(row.get("label") or step_id).strip()
                deps = [str(dep).strip() for dep in row.get("deps", []) if str(dep).strip()]
                command_template = [str(x).strip() for x in row.get("command_template", []) if str(x).strip()]
                args = [str(x).strip() for x in row.get("args", []) if str(x).strip()]
                env_allowlist = [str(x).strip() for x in row.get("env_allowlist", []) if str(x).strip()]
                if not command_template:
                    continue
                case_steps[step_id] = StepNode(
                    id=step_id,
                    label=step_label,
                    deps=deps,
                    kind=str(row.get("kind") or "action"),
                    cache_key=str(row.get("cache_key") or step_id),
                    provides=[step_id],
                    command_template=command_template,
                    args=args,
                    cwd=str(row.get("cwd") or "."),
                    env_allowlist=env_allowlist,
                    timeout_sec=max(1, int(row.get("timeout_sec") or 300)),
                    retries=max(0, int(row.get("retries") or 0)),
                )

                parent_id = str(row.get("parent_test_id") or step_id.split("::", 1)[0]).strip()
                next_order = workflow_step_order_by_parent.get(parent_id, 0)
                workflow_step_order_by_parent[parent_id] = next_order + 1
                raw_group = str(row.get("child_group") or "").strip()
                child_group = raw_group or "Workflow"
                raw_lane = row.get("child_lane")
                try:
                    child_lane = int(raw_lane) if raw_lane is not None else 0
                except Exception:
                    child_lane = 0
                raw_order = row.get("child_order")
                try:
                    child_order = int(raw_order) if raw_order is not None else next_order
                except Exception:
                    child_order = next_order

                workflow_steps_by_parent.setdefault(parent_id, []).append(
                    {
                        "id": step_id,
                        "name": step_label,
                        "nodeid": step_id.split("::", 1)[1] if "::" in step_id else step_id,
                        "file": str(row.get("file") or "workflow"),
                        "depends_on": deps,
                        "kind": str(row.get("kind") or "action"),
                        "child_group": child_group,
                        "child_lane": child_lane,
                        "child_order": child_order,
                    }
                )
        except Exception as exc:
            _log_queue.put(f"[catalog] workflow steps load failed: {exc}\n")
    runtime["case_steps"] = case_steps
    runtime["workflow_steps_by_parent"] = workflow_steps_by_parent

    def infer_children_for_catalog_test(test: Any) -> list[dict[str, Any]]:
        # Keep full catalog row for "all tests", and attach targeted subsets
        # for pytest file/node scoped catalog entries.
        if str(getattr(test, "id", "")) == "python-tests-all":
            return python_cases
        command_template = [str(x).strip() for x in getattr(test, "command_template", []) if str(x).strip()]
        args = [str(x).strip() for x in getattr(test, "args", []) if str(x).strip()]
        cmd_joined = " ".join(command_template).lower()
        if "pytest" not in cmd_joined:
            return []

        selected_nodeids: set[str] = set()
        selected_files: set[str] = set()
        selected_prefixes: set[str] = set()
        for arg in args:
            normalized = arg.replace("\\", "/").strip()
            if not normalized.startswith("tests/"):
                continue
            if "::" in normalized:
                nodeid = normalized
                file_part = normalized.split("::", 1)[0]
                selected_nodeids.add(nodeid)
                selected_files.add(file_part)
            elif normalized.endswith(".py"):
                selected_files.add(normalized)
            else:
                # Directory/prefix targets (e.g. tests/browser) should include all
                # discovered cases under that subtree.
                selected_prefixes.add(normalized.rstrip("/"))

        def _child_case_view(
            row: dict[str, Any],
            *,
            default_group: str,
            default_lane: int,
            default_order: int,
        ) -> dict[str, Any]:
            out = dict(row)
            group = str(out.get("child_group") or "").strip() or default_group
            out["child_group"] = group
            lane_raw = out.get("child_lane")
            order_raw = out.get("child_order")
            try:
                out["child_lane"] = int(lane_raw) if lane_raw is not None else int(default_lane)
            except Exception:
                out["child_lane"] = int(default_lane)
            try:
                out["child_order"] = int(order_raw) if order_raw is not None else int(default_order)
            except Exception:
                out["child_order"] = int(default_order)
            return out

        picked: list[dict[str, Any]] = []
        for nodeid in sorted(selected_nodeids):
            case = cases_by_nodeid.get(nodeid)
            if case:
                picked.append(
                    _child_case_view(
                        case,
                        default_group="Component Tests",
                        default_lane=1,
                        default_order=len(picked),
                    )
                )
        for file_path in sorted(selected_files):
            for case in cases_by_file.get(file_path, []):
                if not any(str(x.get("id") or "") == str(case.get("id") or "") for x in picked):
                    picked.append(
                        _child_case_view(
                            case,
                            default_group="Component Tests",
                            default_lane=1,
                            default_order=len(picked),
                        )
                    )
        if selected_prefixes:
            for file_path, cases in cases_by_file.items():
                normalized_file = str(file_path or "").replace("\\", "/")
                if not normalized_file:
                    continue
                if any(normalized_file == pref or normalized_file.startswith(f"{pref}/") for pref in selected_prefixes):
                    for case in cases:
                        if not any(str(x.get("id") or "") == str(case.get("id") or "") for x in picked):
                            picked.append(
                                _child_case_view(
                                    case,
                                    default_group="Component Tests",
                                    default_lane=1,
                                    default_order=len(picked),
                                )
                            )
        workflow_children = workflow_steps_by_parent.get(str(getattr(test, "id", "")), [])
        workflow_picked: list[dict[str, Any]] = []
        if workflow_children:
            seen_ids = {str(row.get("id") or "") for row in picked if isinstance(row, dict)}
            for row in workflow_children:
                rid = str(row.get("id") or "")
                if rid in seen_ids:
                    continue
                workflow_picked.append(
                    _child_case_view(
                        row,
                        default_group="Workflow",
                        default_lane=0,
                        default_order=len(workflow_picked),
                    )
                )

        # Keep SalesNav workflow lane primary in aggregate child views.
        test_id = str(getattr(test, "id", "") or "")
        if workflow_picked and test_id == "python-salesnav-core":
            combined = [*workflow_picked, *picked]
        else:
            combined = [*picked, *workflow_picked]

        # For SalesNav aggregate graph UX, keep component pytest children visible
        # but non-sequential so they don't appear as part of the primary workflow lane.
        if test_id == "python-salesnav-core":
            for row in combined:
                group = str(row.get("child_group") or "").strip().lower()
                if "workflow" in group:
                    continue
                row["depends_on"] = []

        # Stable, deterministic ordering by lane -> explicit order -> name.
        combined.sort(
            key=lambda row: (
                int(row.get("child_lane") if row.get("child_lane") is not None else 1),
                int(row.get("child_order") if row.get("child_order") is not None else 999999),
                str(row.get("name") or row.get("id") or ""),
            )
        )
        return combined
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
                        "children": infer_children_for_catalog_test(test),
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


def _reset_runtime_test_statuses() -> None:
    statuses: dict[str, dict[str, Any]] = runtime.get("test_status") or {}
    now_ts = time.time()
    for test_id, row in list(statuses.items()):
        if not isinstance(row, dict):
            statuses[test_id] = {"status": "not_run", "lastRun": None, "duration": None}
            continue
        statuses[test_id] = {
            **row,
            "status": "not_run",
            "duration": None,
            "attempt": None,
            "message": "",
            "started_at": None,
            "finished_at": None,
            "updated_at": now_ts,
        }
    runtime["test_status"] = statuses


def _finalize_active_run_canceled(reason: str = "terminated by stop") -> None:
    run_paths = runtime.get("run_paths")
    current = runtime.get("current_run") if isinstance(runtime.get("current_run"), dict) else {}
    run_id = str((run_paths.run_id if run_paths is not None else current.get("run_id")) or "").strip()
    if not run_id:
        return

    now_ts = time.time()
    started_at = float(current.get("started_at") or now_ts)
    duration = max(0.0, now_ts - started_at)
    terminal = {"passed", "failed", "timed_out", "canceled", "skipped"}
    tests: list[dict[str, Any]] = []

    for test_id, row in (runtime.get("test_status") or {}).items():
        if not isinstance(row, dict):
            continue
        status_val = str(row.get("status") or "not_run").lower()
        if status_val in {"queued", "running", "retrying"}:
            _update_test_status(
                str(test_id),
                status="canceled",
                finished_at=now_ts,
                updated_at=now_ts,
                message=reason,
            )
            status_val = "canceled"
        if status_val not in terminal:
            continue
        tests.append(
            {
                "id": str(test_id),
                "status": status_val,
                "duration_sec": float(row.get("duration") or 0.0),
                "message": str(row.get("message") or ""),
                "attempt": row.get("attempt"),
            }
        )

    runtime["current_run"] = {
        "run_id": run_id,
        "status": "canceled",
        "duration_sec": duration,
        "finished_at": now_ts,
    }

    if run_paths is not None:
        dependency_analysis = _build_dependency_analysis(
            run_id=run_id,
            run_tests=tests,
            events_path=run_paths.events,
        )
        result_payload = {
            "run_id": run_id,
            "status": "canceled",
            "duration_sec": duration,
            "tests": tests,
            "dependency_analysis": dependency_analysis,
            "exports": {"json": True, "junit": True},
        }
        run_store.write_results(run_paths, result_payload)
        run_store.write_junit(run_paths, result_payload)
        run_store.finalize_run(
            run_paths,
            status="canceled",
            duration_sec=duration,
            tests=tests,
            dependency_analysis=dependency_analysis,
        )
        recorder = runtime.get("trace_recorder")
        if recorder is not None:
            recorder.end_run(status="canceled", duration_sec=duration, extra={"reason": reason, "tests_count": len(tests)})
        runtime["run_paths"] = None
        runtime["trace_recorder"] = None
        runtime["trace_run_id"] = None
        runtime["run_test_output_lines"] = {}
        run_store.prune()

    _log_queue.put(f"[tests] run finished: {run_id} status=canceled duration={duration:.2f}s\n")


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


def _trace_plan_for_catalog(plan: list[Any], selected_tags: list[str]) -> dict[str, Any]:
    ordered_steps: list[dict[str, Any]] = []
    for p in plan:
        deps = list(p.test.depends_on)
        ordered_steps.append(
            {
                "order": p.order,
                "id": p.test.id,
                "label": p.test.name,
                "kind": p.test.kind,
                "deps": deps,
                "dependency_reasons": [f"depends on {dep}" for dep in deps],
                "skip": False,
            }
        )
    return {"mode": "catalog", "selected_tags": list(selected_tags), "ordered_steps": ordered_steps}


def _trace_plan_for_steps(step_plan: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "mode": "steps",
        "ordered_steps": [
            {
                "order": int(s.get("order") or 0),
                "id": str(s.get("id") or ""),
                "label": str(s.get("name") or s.get("id") or ""),
                "kind": str(s.get("kind") or "action"),
                "deps": [str(dep) for dep in s.get("deps", []) if str(dep).strip()],
                "dependency_reasons": [f"depends on {dep}" for dep in s.get("deps", []) if str(dep).strip()],
                "skip": bool(s.get("skip")),
                "cache_key": s.get("cache_key"),
            }
            for s in step_plan
        ],
    }


def _test_runtime_meta(test_id: str) -> dict[str, Any]:
    tests = runtime.get("tests") or []
    for row in tests:
        if isinstance(row, dict) and str(row.get("id")) == test_id:
            return row
    if "::" in test_id:
        root_id = test_id.split("::", 1)[0]
        for row in tests:
            if isinstance(row, dict) and str(row.get("id")) == root_id:
                return row
    return {}


def _is_live_expected(test_id: str, meta: dict[str, Any]) -> bool:
    kind = str(meta.get("kind") or "").lower()
    tags = [str(t).lower() for t in meta.get("tags", []) if isinstance(t, str)]
    if kind == "live":
        return True
    if any(tag in {"live", "e2e", "browser", "ui"} for tag in tags):
        return True
    lowered_id = test_id.lower()
    if "/test_live_" in lowered_id or "::test_live_" in lowered_id or "e2e" in lowered_id:
        return True
    return False


def _has_browser_evidence(lines: list[str]) -> bool:
    if not lines:
        return False
    markers = (
        "leadpilot-bridge",
        "browser bridge",
        "cdp",
        "playwright",
        "tab_id",
        "/tabs",
        "navigate",
        "snapshot",
    )
    for raw in lines:
        line = str(raw).lower()
        if any(marker in line for marker in markers):
            return True
    return False


def _annotate_run_evidence(tests: list[dict[str, Any]], output_lines_by_test: dict[str, list[str]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in tests:
        if not isinstance(row, dict):
            continue
        test_id = str(row.get("id") or "")
        meta = _test_runtime_meta(test_id)
        expected_live = _is_live_expected(test_id, meta)
        lines = output_lines_by_test.get(test_id, [])
        browser_evidence = _has_browser_evidence(lines)
        observed = "live_browser" if browser_evidence else ("mocked_or_unit" if not expected_live else "none")
        flagged = expected_live and not browser_evidence
        evidence = {
            "expected": "live_browser" if expected_live else "mocked_or_unit",
            "observed": observed,
            "browser_evidence": browser_evidence,
            "flagged": flagged,
            "line_count": len(lines),
        }
        row_out = dict(row)
        row_out["evidence"] = evidence
        if flagged:
            prior_message = str(row_out.get("message") or "").strip()
            marker = "missing live browser evidence"
            if marker not in prior_message.lower():
                row_out["message"] = f"{prior_message}; {marker}" if prior_message else marker
            if ENFORCE_LIVE_BROWSER_EVIDENCE:
                row_out["status"] = "failed"
        out.append(row_out)
    return out


def _parse_iso_ts(raw: Any) -> float | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return float(datetime.fromisoformat(text).timestamp())
    except Exception:
        return None


def _planned_dep_map_for_run(run_tests: list[dict[str, Any]]) -> dict[str, list[str]]:
    top_ids = [str(row.get("id") or "").strip() for row in run_tests if isinstance(row, dict)]
    top_set = {tid for tid in top_ids if tid}
    planned: dict[str, set[str]] = {}

    catalog_tests = runtime.get("tests") or []
    tests_by_id: dict[str, dict[str, Any]] = {
        str(row.get("id") or ""): row
        for row in catalog_tests
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }
    case_steps: dict[str, StepNode] = runtime.get("case_steps") or {}

    for top_id in top_ids:
        if not top_id:
            continue
        step_node = case_steps.get(top_id)
        if step_node is not None:
            step_deps = [str(dep).strip() for dep in getattr(step_node, "deps", []) if str(dep).strip()]
            if step_deps:
                planned.setdefault(top_id, set()).update(dep for dep in step_deps if dep in top_set)
            continue
        row = tests_by_id.get(top_id) or {}
        top_deps = [str(dep).strip() for dep in (row.get("depends_on") or []) if str(dep).strip()]
        if top_deps:
            planned.setdefault(top_id, set()).update(dep for dep in top_deps if dep in top_set)

        children = row.get("children") if isinstance(row.get("children"), list) else []
        for child in children:
            if not isinstance(child, dict):
                continue
            nodeid = str(child.get("nodeid") or "").strip()
            if not nodeid:
                continue
            child_id = _canonical_child_id(top_id, nodeid)
            raw_deps = [str(dep).strip() for dep in (child.get("depends_on") or []) if str(dep).strip()]
            if not raw_deps:
                continue
            mapped = {_canonical_child_id(top_id, dep) for dep in raw_deps}
            planned.setdefault(child_id, set()).update(mapped)

    return {node: sorted(deps) for node, deps in planned.items() if deps}


def _build_dependency_analysis(
    *,
    run_id: str,
    run_tests: list[dict[str, Any]],
    events_path: Path | None,
) -> dict[str, Any]:
    planned = _planned_dep_map_for_run(run_tests)

    node_status: dict[str, str] = {}
    node_attempts: dict[str, int] = {}
    for row in run_tests:
        if not isinstance(row, dict):
            continue
        rid = str(row.get("id") or "").strip()
        if not rid:
            continue
        node_status[rid] = str(row.get("status") or "")
        attempt_raw = row.get("attempt")
        if attempt_raw is not None:
            try:
                node_attempts[rid] = max(node_attempts.get(rid, 0), int(attempt_raw))
            except Exception:
                pass
        children = row.get("children") if isinstance(row.get("children"), list) else []
        for child in children:
            if not isinstance(child, dict):
                continue
            cid = str(child.get("id") or "").strip()
            if not cid:
                continue
            node_status[cid] = str(child.get("status") or "")
            c_attempt = child.get("attempt")
            if c_attempt is not None:
                try:
                    node_attempts[cid] = max(node_attempts.get(cid, 0), int(c_attempt))
                except Exception:
                    pass

    started_at: dict[str, float] = {}
    finished_at: dict[str, float] = {}
    observed_edges: set[tuple[str, str]] = set()
    observed_edge_rows: list[dict[str, Any]] = []
    unsatisfied_at_start: dict[str, list[str]] = {}
    stream_last_finished: dict[str, str] = {}

    if events_path is not None and events_path.exists():
        try:
            with events_path.open("r", encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line:
                        continue
                    try:
                        evt = json.loads(line)
                    except Exception:
                        continue
                    ev_type = str(evt.get("type") or "")
                    payload = evt.get("payload") if isinstance(evt.get("payload"), dict) else {}
                    raw_id = str(payload.get("id") or "").strip()
                    if not raw_id:
                        continue
                    parent_id = str(payload.get("parent_id") or "").strip()
                    node_id = _canonical_child_id(parent_id, raw_id) if parent_id else raw_id
                    ts = _parse_iso_ts(evt.get("timestamp")) or time.time()
                    stream_key = f"parent:{parent_id}" if parent_id else "__root__"

                    if ev_type == "test_started":
                        started_at[node_id] = min(started_at.get(node_id, ts), ts)
                        attempt_raw = payload.get("attempt")
                        if attempt_raw is not None:
                            try:
                                node_attempts[node_id] = max(node_attempts.get(node_id, 0), int(attempt_raw))
                            except Exception:
                                pass
                        predecessor = stream_last_finished.get(stream_key)
                        if predecessor and predecessor != node_id:
                            edge = (predecessor, node_id)
                            if edge not in observed_edges:
                                observed_edges.add(edge)
                                observed_edge_rows.append(
                                    {
                                        "from": predecessor,
                                        "to": node_id,
                                        "kind": "stream_predecessor",
                                        "stream": stream_key,
                                    }
                                )

                        planned_deps = planned.get(node_id, [])
                        if planned_deps:
                            missing = [dep for dep in planned_deps if finished_at.get(dep, float("inf")) > ts]
                            if missing:
                                unsatisfied_at_start[node_id] = sorted(set(missing))
                    elif ev_type == "test_finished":
                        finished_at[node_id] = max(finished_at.get(node_id, ts), ts)
                        stream_last_finished[stream_key] = node_id
                        if node_id not in node_status:
                            node_status[node_id] = str(payload.get("status") or "")

        except Exception as exc:
            return {
                "version": "1",
                "run_id": run_id,
                "error": f"dependency analysis failed: {exc}",
                "planned_edges": [],
                "observed_edges": [],
                "drift": {"missing_planned_edges": [], "unexpected_observed_edges": [], "nodes_started_before_planned_ready": []},
                "nodes": [],
            }

    planned_edges: set[tuple[str, str]] = set()
    for node_id, deps in planned.items():
        for dep in deps:
            if dep and node_id and dep != node_id:
                planned_edges.add((dep, node_id))

    missing_planned = sorted(
        [
            {"from": dep, "to": node}
            for (dep, node) in planned_edges
            if node in started_at and (dep, node) not in observed_edges
        ],
        key=lambda row: (str(row.get("to") or ""), str(row.get("from") or "")),
    )
    unexpected_observed = sorted(
        [
            {"from": dep, "to": node}
            for (dep, node) in observed_edges
            if (dep, node) not in planned_edges
        ],
        key=lambda row: (str(row.get("to") or ""), str(row.get("from") or "")),
    )

    all_node_ids = sorted(
        set(planned.keys())
        | set(node_status.keys())
        | set(started_at.keys())
        | set(finished_at.keys())
        | set(unsatisfied_at_start.keys())
    )

    nodes: list[dict[str, Any]] = []
    for node_id in all_node_ids:
        deps = planned.get(node_id, [])
        unresolved = unsatisfied_at_start.get(node_id, [])
        satisfied = [dep for dep in deps if dep not in set(unresolved)]
        nodes.append(
            {
                "id": node_id,
                "status": node_status.get(node_id, ""),
                "attempts": int(node_attempts.get(node_id, 0) or 0),
                "planned_deps": deps,
                "satisfied_planned_deps_at_start": sorted(satisfied),
                "unsatisfied_planned_deps_at_start": unresolved,
                "first_started_at": started_at.get(node_id),
                "last_finished_at": finished_at.get(node_id),
            }
        )

    return {
        "version": "1",
        "run_id": run_id,
        "planned_edges": [{"from": dep, "to": node} for (dep, node) in sorted(planned_edges)],
        "observed_edges": observed_edge_rows,
        "drift": {
            "missing_planned_edges": missing_planned,
            "unexpected_observed_edges": unexpected_observed,
            "nodes_started_before_planned_ready": [
                {"id": node_id, "unsatisfied_deps": deps}
                for node_id, deps in sorted(unsatisfied_at_start.items(), key=lambda row: row[0])
            ],
        },
        "nodes": nodes,
    }


def _process_worker_event(event: dict[str, Any]) -> None:
    ev_type = str(event.get("type") or "")
    payload = event.get("payload", {}) if isinstance(event.get("payload"), dict) else {}
    recorder: RunTraceRecorder | None = runtime.get("trace_recorder")

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
        runtime["run_test_output_lines"] = {}
        for test_id in payload.get("test_ids", []):
            _update_test_status(str(test_id), status="queued", lastRun=time.time(), duration=None)
            if recorder is not None:
                recorder.start_step(step_id=str(test_id), label=str(test_id), inputs={"status": "queued"})
        _log_queue.put(f"[tests] run started: {run_id}\n")
        if recorder is not None:
            recorder.log(level="info", message="run started", data={"run_id": run_id, "test_ids": payload.get("test_ids", [])})
        return

    if ev_type == "test_started":
        test_id = str(payload.get("id") or "")
        parent_id = str(payload.get("parent_id") or "")
        if parent_id and test_id:
            test_id = _canonical_child_id(parent_id, test_id)
        status = str(payload.get("status") or "running")
        attempt = payload.get("attempt")
        _update_test_status(test_id, status=status, lastRun=time.time(), started_at=time.time(), attempt=attempt, updated_at=time.time())
        if recorder is not None:
            cmd = payload.get("command")
            cwd = payload.get("cwd")
            if isinstance(cmd, list):
                recorder.add_command(command=[str(x) for x in cmd], cwd=str(cwd) if cwd is not None else None, step_id=test_id)
            recorder.start_step(step_id=test_id, label=test_id, inputs={"attempt": attempt, "status": status})
        return

    if ev_type == "test_output":
        test_id = str(payload.get("id") or "unknown")
        parent_id = str(payload.get("parent_id") or "")
        if parent_id and test_id:
            test_id = _canonical_child_id(parent_id, test_id)
        line = str(payload.get("line") or "")
        if line:
            _log_queue.put(f"[tests:{test_id}] {line}\n")
            out_lines = runtime.setdefault("run_test_output_lines", {}).setdefault(test_id, [])
            out_lines.append(line)
            if len(out_lines) > 400:
                del out_lines[: len(out_lines) - 400]
            if parent_id:
                parent_lines = runtime.setdefault("run_test_output_lines", {}).setdefault(parent_id, [])
                parent_lines.append(line)
                if len(parent_lines) > 400:
                    del parent_lines[: len(parent_lines) - 400]
            if run_paths is not None:
                run_store.append_stdout(run_paths, f"[{test_id}] {line}\n")
            if recorder is not None:
                recorder.log(level="info", message=line, step_id=test_id)
            # Some child orchestration signals are emitted as child-note log lines.
            # Mirror them into status updates so live UI can advance even if a
            # corresponding structured child event is delayed or missing.
            child_note = _parse_child_note(line) if parent_id else None
            if child_note:
                phase, rest = child_note
                now_ts = time.time()
                if phase == "started":
                    _update_test_status(
                        test_id,
                        status="running",
                        lastRun=now_ts,
                        started_at=now_ts,
                        updated_at=now_ts,
                        message=rest or line,
                    )
                elif phase == "finished":
                    lowered = rest.lower()
                    finished_status = "passed" if "pass" in lowered else ("canceled" if "cancel" in lowered else ("failed" if ("fail" in lowered or "error" in lowered or "timeout" in lowered) else "passed"))
                    _update_test_status(
                        test_id,
                        status=finished_status,
                        finished_at=now_ts,
                        updated_at=now_ts,
                        message=rest or line,
                    )
        return

    if ev_type == "test_finished":
        test_id = str(payload.get("id") or "")
        parent_id = str(payload.get("parent_id") or "")
        if parent_id and test_id:
            test_id = _canonical_child_id(parent_id, test_id)
        status = str(payload.get("status") or "failed")
        duration = float(payload.get("duration_sec") or 0.0)
        _update_test_status(
            test_id,
            status=status,
            duration=duration,
            attempt=payload.get("attempt"),
            message=str(payload.get("message") or ""),
            finished_at=time.time(),
            updated_at=time.time(),
        )
        _log_queue.put(f"[tests] {test_id} -> {status} ({duration:.2f}s)\n")
        if recorder is not None:
            step_outputs = {
                "attempt": payload.get("attempt"),
                "message": payload.get("message"),
                "cache_key": payload.get("cache_key"),
            }
            for key in ("inputs", "tool_call", "tool_response", "outputs", "normalized_output_hash", "artifacts"):
                if key in payload:
                    step_outputs[key] = payload.get(key)
            recorder.end_step(
                step_id=test_id,
                status=status,
                duration_sec=duration,
                outputs=step_outputs,
                error=str(payload.get("error_trace") or payload.get("message") or "") if status in {"failed", "timed_out"} else None,
            )
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

        output_lines_by_test = runtime.get("run_test_output_lines") or {}
        tests = _annotate_run_evidence(tests, output_lines_by_test)
        dependency_analysis = _build_dependency_analysis(
            run_id=run_id,
            run_tests=tests,
            events_path=(run_paths.events if run_paths is not None else None),
        )
        if ENFORCE_LIVE_BROWSER_EVIDENCE:
            missing_live = [row for row in tests if isinstance(row, dict) and row.get("status") == "failed" and (row.get("evidence") or {}).get("flagged")]
            if missing_live:
                status = "failed"

        if run_paths is not None:
            result_payload = {
                "run_id": run_id,
                "status": status,
                "duration_sec": duration,
                "tests": tests,
                "dependency_analysis": dependency_analysis,
                "exports": {"json": True, "junit": True},
            }
            run_store.write_results(run_paths, result_payload)
            run_store.write_junit(run_paths, result_payload)
            run_store.finalize_run(
                run_paths,
                status=status,
                duration_sec=duration,
                tests=tests,
                dependency_analysis=dependency_analysis,
            )
            if recorder is not None:
                recorder.add_verification({"source": "worker.run_finished", "status": status, "tests": tests, "duration_sec": duration})
                recorder.add_verification(
                    {
                        "source": "launcher.dependency_analysis",
                        "planned_edges": len(dependency_analysis.get("planned_edges") or []),
                        "observed_edges": len(dependency_analysis.get("observed_edges") or []),
                        "missing_planned_edges": len((dependency_analysis.get("drift") or {}).get("missing_planned_edges") or []),
                        "unexpected_observed_edges": len((dependency_analysis.get("drift") or {}).get("unexpected_observed_edges") or []),
                    }
                )
                recorder.attach_artifact(artifact_type="events", path=str(run_paths.events), meta={})
                recorder.attach_artifact(artifact_type="stdout", path=str(run_paths.stdout), meta={})
                recorder.attach_artifact(artifact_type="json", path=str(run_paths.results), meta={})
                recorder.attach_artifact(artifact_type="junit", path=str(run_paths.junit), meta={})
                recorder.end_run(status=status, duration_sec=duration, extra={"tests_count": len(tests)})
            runtime["run_paths"] = None
            runtime["trace_recorder"] = None
            runtime["trace_run_id"] = None
            runtime["run_test_output_lines"] = {}
            run_store.prune()

        # Update step cache for dependency-aware case execution.
        if isinstance(tests, list):
            cache: dict[str, dict[str, Any]] = runtime.get("step_cache") or {}
            changed = False
            for row in tests:
                if not isinstance(row, dict):
                    continue
                step_id = str(row.get("id") or "")
                if not step_id:
                    continue
                cache_key = row.get("cache_key")
                if not cache_key:
                    continue
                status_val = str(row.get("status") or "")
                if status_val == "passed":
                    cache[step_id] = {
                        "status": "passed",
                        "cache_key": str(cache_key),
                        "finished_at": time.time(),
                    }
                    changed = True
                elif status_val in {"failed", "timed_out"} and step_id in cache:
                    cache.pop(step_id, None)
                    changed = True
            if changed:
                runtime["step_cache"] = cache
                _save_step_cache(cache)

        if status == "failed":
            runtime["latest_failed_run"] = {"run_id": run_id, "duration_sec": duration}

        _log_queue.put(f"[tests] run finished: {run_id} status={status} duration={duration:.2f}s\n")
        return

    if ev_type == "worker_error":
        message = str(payload.get("message") or "unknown worker error")
        _log_queue.put(f"[worker] {message}\n")
        if recorder is not None:
            recorder.log(level="error", message="worker_error", data={"message": message})
        if runtime.get("current_run") and runtime["current_run"].get("status") == "running":
            runtime["current_run"]["status"] = "failed"
        if not worker.is_alive():
            try:
                worker.restart()
                worker.request_discover()
                _log_queue.put("[worker] restarted successfully\n")
            except Exception as exc:
                _log_queue.put(f"[worker] restart failed: {exc}\n")
        return

    if ev_type == "worker_stderr":
        line = str(payload.get("line") or "").strip()
        if line:
            _log_queue.put(f"[worker:stderr] {line}\n")
        return


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
    preflight_checks: dict[str, Any] = {}

    try:
        preflight_checks = supervisor.preflight(RUN_STORE_ROOT)
        runtime["startup"]["checks"]["preflight"] = preflight_checks
    except LauncherStartupError as exc:
        _mark_startup_issue(exc.code, exc.message, exc.remediation)

    bridge_required = bool(preflight_checks.get("bridge_required", True))
    runtime["startup"]["phase"] = "launch_bridge"
    bridge_proc = None
    backend_proc = None
    attach_existing_bridge = bool(preflight_checks.get("attach_existing_bridge"))
    if not bridge_required:
        _log_queue.put("[startup] bridge skipped (BROWSER_GATEWAY_MODE is not leadpilot/openclaw)\n")
    elif attach_existing_bridge:
        _log_queue.put("[startup] attach_existing_bridge: using already-running bridge on configured port\n")
    else:
        try:
            bridge_proc = supervisor.start_process("bridge", supervisor.bridge_command(), retries=2)
            threading.Thread(target=_stream_output, args=("bridge", bridge_proc), daemon=True).start()
        except LauncherStartupError as exc:
            _mark_startup_issue(exc.code, exc.message, exc.remediation)

    runtime["startup"]["phase"] = "launch_backend"
    attach_existing_backend = bool(preflight_checks.get("attach_existing_backend"))
    if attach_existing_backend:
        _log_queue.put("[startup] attach_existing_backend: using already-running backend on configured port\n")
    else:
        try:
            backend_proc = supervisor.start_process("backend", supervisor.backend_command(), retries=2)
            threading.Thread(target=_stream_output, args=("backend", backend_proc), daemon=True).start()
        except LauncherStartupError as exc:
            _mark_startup_issue(exc.code, exc.message, exc.remediation)

    runtime["startup"]["phase"] = "readiness"
    if bridge_required and (bridge_proc is not None or attach_existing_bridge) and not supervisor.wait_for_bridge_ready(timeout=15):
        _mark_startup_issue("readiness_timeout", "bridge readiness probe timed out", "Check bridge logs and node/tsx runtime.")
    if (backend_proc is not None or attach_existing_backend) and not supervisor.wait_for_backend_ready(timeout=20):
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

    shutdown_lock = threading.Lock()
    shutdown_state = {"done": False}

    _ensure_case_deps_generated()
    _load_catalog_state()

    log_thread = threading.Thread(target=_pump_logs, daemon=True)
    log_thread.start()

    _startup()

    event_thread = threading.Thread(target=_poll_worker_events, daemon=True)
    event_thread.start()

    frontend_index = LAUNCHER_FRONTEND_DIR / "dist" / "index.html"
    frontend_build_required = _launcher_frontend_needs_build(frontend_index)
    frontend_build_error: str | None = None
    try:
        _ensure_launcher_frontend_build()
    except Exception as exc:
        frontend_build_error = str(exc)
        _log_queue.put(f"[launcher] frontend build failed: {exc}\n")
        if frontend_build_required:
            _mark_startup_issue(
                "frontend_build_failed",
                "launcher frontend build failed while source changes require a rebuild",
                "Run `npm.cmd --prefix launcher_frontend install` then `npm.cmd --prefix launcher_frontend run build`.",
            )

    launcher_candidates = [
        APP_DIR / "launcher_frontend" / "dist" / "index.html",
        Path.cwd() / "launcher_frontend" / "dist" / "index.html",
    ]
    launcher_app_path = next((p for p in launcher_candidates if p.exists()), None)
    if frontend_build_required and frontend_build_error:
        # Never boot stale dist when rebuild is required and failed.
        launcher_app_path = None
    if launcher_app_path is not None:
        launcher_url = launcher_app_path.resolve().as_uri()
        _log_queue.put(f"[launcher] loading standalone UI: {launcher_app_path.resolve()}\n")
        window = webview.create_window("LeadPilot Launcher", url=launcher_url, width=1280, height=860)
    else:
        dist_dir = APP_DIR / "launcher_frontend" / "dist"
        assets_exist = (dist_dir / "assets").exists()
        js_assets = sorted((dist_dir / "assets").glob("index-*.js")) if assets_exist else []
        css_assets = sorted((dist_dir / "assets").glob("index-*.css")) if assets_exist else []
        if js_assets:
            js_uri = js_assets[-1].resolve().as_uri()
            css_link = ""
            if css_assets:
                css_uri = css_assets[-1].resolve().as_uri()
                css_link = f'<link rel="stylesheet" href="{css_uri}" />'
            debug_bootstrap = "<script>window.__LP_DEBUG__=true;</script>" if LAUNCHER_DEVTOOLS else ""
            synth_html = f"""
            <html>
              <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                {css_link}
              </head>
              <body>
                <div id="root"></div>
                {debug_bootstrap}
                <script type="module" src="{js_uri}"></script>
              </body>
            </html>
            """
            _log_queue.put("[launcher] dist/index.html missing; using synthesized asset loader\n")
            window = webview.create_window("LeadPilot Launcher", html=synth_html, width=1280, height=860)
        else:
            checked_paths = "".join(
                f"<div class='sub'><span class='mono'>{str(p)}</span> => {'FOUND' if p.exists() else 'missing'}</div>"
                for p in launcher_candidates
            )
            fallback_html = """
            <html>
              <head>
                <style>
                  html, body {
                    height: 100%;
                    margin: 0;
                    font-family: Segoe UI, Arial, sans-serif;
                    background: #0b1220;
                    color: #e2e8f0;
                  }
                  .root {
                    min-height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    box-sizing: border-box;
                  }
                  .card {
                    width: min(680px, 100%);
                    border: 1px solid #1f2a44;
                    border-radius: 12px;
                    background: #0f172a;
                    padding: 16px;
                  }
                  .title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
                  .sub { font-size: 12px; color: #94a3b8; margin-bottom: 8px; }
                  .mono { font-family: Consolas, Menlo, monospace; }
                </style>
              </head>
              <body>
                <div class="root">
                  <div class="card">
                    <div class="title">Launcher UI bundle not found</div>
                    <div class="sub">Missing file: <span class="mono">launcher_frontend/dist/index.html</span></div>
                    <div class="sub">Assets dir exists: <span class="mono">__ASSETS_EXIST__</span></div>
                    <div class="sub">App dir: <span class="mono">__APP_DIR__</span></div>
                    <div class="sub">CWD: <span class="mono">__CWD__</span></div>
                    <div class="sub">Paths checked:</div>
                    __CHECKED_PATHS__
                    <div class="sub">Build once: <span class="mono">npm.cmd --prefix launcher_frontend install</span></div>
                    <div class="sub">Then: <span class="mono">npm.cmd --prefix launcher_frontend run build</span></div>
                    <div class="sub">Then run: <span class="mono">python launcher.py</span></div>
                  </div>
                </div>
              </body>
            </html>
            """
            fallback_html = (
                fallback_html.replace("__APP_DIR__", str(APP_DIR))
                .replace("__CWD__", str(Path.cwd()))
                .replace("__ASSETS_EXIST__", "yes" if assets_exist else "no")
                .replace("__CHECKED_PATHS__", checked_paths)
            )
            window = webview.create_window("LeadPilot Launcher", html=fallback_html, width=1280, height=860)

    if LAUNCHER_DEVTOOLS:
        _log_queue.put("[launcher] devtools enabled (LAUNCHER_DEVTOOLS=1)\n")

        def _open_devtools() -> None:
            try:
                try:
                    window.evaluate_js("window.__LP_DEBUG__=true; try{localStorage.setItem('LP_DEBUG','1')}catch(_e){}")
                except Exception:
                    pass
                if hasattr(window, "show_devtools"):
                    window.show_devtools()  # type: ignore[attr-defined]
            except Exception as exc:
                _log_queue.put(f"[launcher] failed to open devtools: {exc}\n")

        try:
            window.events.loaded += _open_devtools
        except Exception as exc:
            _log_queue.put(f"[launcher] failed to register devtools hook: {exc}\n")

    def get_logs() -> str:
        return "".join(_log_buffer)

    def get_startup_state() -> dict[str, Any]:
        return runtime["startup"]

    def get_tests() -> list[dict[str, Any]]:
        return runtime["tests"]

    def get_test_status() -> dict[str, dict[str, Any]]:
        return runtime["test_status"]

    def _classify_requested_ids(ids: list[str]) -> tuple[list[str], list[str]]:
        catalog = runtime.get("catalog")
        catalog_ids = set(catalog.tests_by_id().keys()) if catalog else set()
        case_steps = runtime.get("case_steps") or {}
        case_ids = set(case_steps.keys())
        out_catalog: list[str] = []
        out_case: list[str] = []
        for raw in ids:
            rid = str(raw).strip()
            if not rid:
                continue
            if rid in catalog_ids:
                out_catalog.append(rid)
                continue
            if rid in case_ids:
                out_case.append(rid)
                continue
            # UI drilldown ids are composed as "<test-id>::<nodeid>".
            if "::" in rid:
                prefix, rest = rid.split("::", 1)
                candidate = f"{prefix}::{rest}"
                if candidate in case_ids:
                    out_case.append(candidate)
                    continue
            # Legacy/short-form step references (e.g. "browser.validate").
            short_matches = []
            for case_id in case_ids:
                tail = case_id.split("::")[-1]
                if tail == rid or tail.endswith(f".{rid}"):
                    short_matches.append(case_id)
            if len(short_matches) == 1:
                out_case.append(short_matches[0])
                continue
            raise RuntimeError(f"unknown test or step id: {rid}")
        return out_catalog, out_case

    def _build_case_plan(case_ids: list[str]) -> list[dict[str, Any]]:
        case_steps: dict[str, StepNode] = runtime.get("case_steps") or {}
        if not case_steps:
            raise StepPlanError("no case steps discovered")
        planned = build_step_plan(case_steps, step_ids=case_ids)
        cache: dict[str, dict[str, Any]] = runtime.get("step_cache") or {}
        out: list[dict[str, Any]] = []
        for item in planned:
            step = item.step
            cache_key = _step_cache_key(step)
            cache_row = cache.get(step.id) or {}
            satisfied = cache_row.get("status") == "passed" and cache_row.get("cache_key") == cache_key
            out.append(
                {
                    "order": item.order,
                    "id": step.id,
                    "name": step.label,
                    "kind": step.kind,
                    "deps": list(step.deps),
                    "cache_key": cache_key,
                    "skip": bool(satisfied),
                    "command_template": list(step.command_template),
                    "args": list(step.args),
                    "cwd": step.cwd,
                    "env_allowlist": list(step.env_allowlist),
                    "timeout_sec": step.timeout_sec,
                    "retries": step.retries,
                }
            )
        return out

    def _materialize_step_runtime_tokens(step_plan: list[dict[str, Any]], run_id: str, run_dir: Path) -> list[dict[str, Any]]:
        run_dir_str = str(run_dir)
        out: list[dict[str, Any]] = []
        for row in step_plan:
            if not isinstance(row, dict):
                continue
            step_id = str(row.get("id") or "")
            step_slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", step_id).strip("_") or "step"

            def _materialize(value: str) -> str:
                return (
                    str(value or "")
                    .replace("__RUN_ID__", run_id)
                    .replace("__RUN_DIR__", run_dir_str)
                    .replace("__STEP_ID_SANITIZED__", step_slug)
                )

            command_template = [_materialize(str(x)) for x in row.get("command_template", [])]
            args = [_materialize(str(x)) for x in row.get("args", [])]
            cwd = _materialize(str(row.get("cwd") or "."))
            out.append({**row, "command_template": command_template, "args": args, "cwd": cwd})
        return out

    def preview_plan(test_ids: list[str], tags: list[str]) -> list[dict[str, Any]]:
        catalog = runtime.get("catalog")
        if not catalog:
            raise RuntimeError(runtime.get("catalog_error") or "catalog unavailable")
        requested = [str(i) for i in (test_ids or []) if isinstance(i, str)]
        catalog_ids, case_ids = _classify_requested_ids(requested) if requested else ([], [])
        if case_ids and catalog_ids:
            raise RuntimeError("mixed catalog test ids and case step ids are not supported in one run")
        if case_ids:
            try:
                return _build_case_plan(case_ids)
            except StepPlanError as exc:
                _log_queue.put(f"[steps] preview failed: {exc}\n")
                return []
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

            requested = [str(i) for i in (test_ids or []) if isinstance(i, str)]
            try:
                catalog_ids, case_ids = _classify_requested_ids(requested) if requested else ([], [])
            except Exception as exc:
                return {"ok": False, "error": str(exc)}
            if case_ids and catalog_ids:
                return {"ok": False, "error": "mixed catalog test ids and case step ids are not supported in one run"}

            step_mode = bool(case_ids)
            if step_mode:
                try:
                    step_plan = _build_case_plan(case_ids)
                except StepPlanError as exc:
                    _log_queue.put(f"[steps] run plan failed: {exc}\n")
                    return {"ok": False, "error": str(exc)}
                plan = []
            else:
                try:
                    plan = build_run_plan(catalog, test_ids=catalog_ids or None if requested else None, tags=tags or None)
                except PlanError as exc:
                    _log_queue.put(f"[tests] run plan failed: {exc}\n")
                    return {"ok": False, "error": str(exc)}
                step_plan = []

            run_paths = run_store.start_run()
            if step_mode:
                step_plan = _materialize_step_runtime_tokens(step_plan, run_paths.run_id, run_paths.run_dir)
            runtime["run_paths"] = run_paths
            runtime["current_run"] = {"run_id": run_paths.run_id, "status": "queued", "started_at": time.time()}
            run_store.write_metadata(
                run_paths,
                {
                    "run_id": run_paths.run_id,
                    "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "status": "queued",
                    "selected_test_ids": [p.test.id for p in plan],
                    "selected_step_ids": [s["id"] for s in step_plan],
                    "selected_tags": tags,
                    "artifacts": {
                        "events": str(run_paths.events),
                        "stdout": str(run_paths.stdout),
                        "junit": str(run_paths.junit),
                        "json": str(run_paths.results),
                        "trace": str(run_paths.trace),
                    },
                },
            )
            trace_recorder = RunTraceRecorder(run_paths.trace)
            selected_ids = [s["id"] for s in step_plan] if step_mode else [p.test.id for p in plan]
            trace_plan = _trace_plan_for_steps(step_plan) if step_mode else _trace_plan_for_catalog(plan, tags or [])
            trace_recorder.start_run(
                run={
                    "id": run_paths.run_id,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "env": {
                        "profile": "local",
                        "server_port": SERVER_PORT,
                        "bridge_port": BRIDGE_PORT,
                        "python": sys.version.split()[0],
                    },
                    "git": _git_snapshot(),
                    "config_snapshot": {
                        "selected_ids": selected_ids,
                        "selected_tags": list(tags or []),
                        "mode": "steps" if step_mode else "catalog",
                    },
                    "status": "queued",
                },
                plan=trace_plan,
            )
            trace_recorder.set_plan(plan_json=trace_plan, plan_text=json.dumps(trace_plan, ensure_ascii=True))
            runtime["trace_recorder"] = trace_recorder
            runtime["trace_run_id"] = run_paths.run_id

            if step_mode:
                for s in step_plan:
                    _update_test_status(str(s["id"]), status="queued", lastRun=time.time(), duration=None)
            else:
                for p in plan:
                    _update_test_status(p.test.id, status="queued", lastRun=time.time(), duration=None)

            if not worker.is_alive():
                worker.restart()
                worker.request_discover()

            if step_mode:
                worker.request_run_steps({"run_id": run_paths.run_id, "steps": step_plan})
                _log_queue.put(f"[steps] queued run {run_paths.run_id} with {len(step_plan)} steps\n")
            else:
                tests_by_id: dict[str, dict[str, Any]] = {
                    str(row.get("id")): row
                    for row in runtime.get("tests", [])
                    if isinstance(row, dict) and isinstance(row.get("id"), str)
                }
                children_by_test: dict[str, list[dict[str, Any]]] = {}
                for p in plan:
                    parent_id = p.test.id
                    row = tests_by_id.get(parent_id) or {}
                    children = row.get("children") if isinstance(row.get("children"), list) else []
                    normalized: list[dict[str, Any]] = []
                    for child in children:
                        if not isinstance(child, dict):
                            continue
                        nodeid = str(child.get("nodeid") or "").strip()
                        if not nodeid:
                            continue
                        normalized.append(
                            {
                                "id": f"{parent_id}::{nodeid}",
                                "nodeid": nodeid,
                                "name": str(child.get("name") or nodeid),
                                "file": str(child.get("file") or ""),
                            }
                        )
                    if normalized:
                        children_by_test[parent_id] = normalized
                worker.request_run_plan(
                    {
                        "run_id": run_paths.run_id,
                        "test_ids": [p.test.id for p in plan],
                        "tags": tags,
                        "children_by_test": children_by_test,
                    }
                )
                _log_queue.put(f"[tests] queued run {run_paths.run_id} with {len(plan)} tests\n")
            return {"ok": True, "run_id": run_paths.run_id}

    def cancel_current_test() -> None:
        worker.request_cancel("current")

    def cancel_run() -> None:
        worker.request_cancel("run")

    def stop(mode: str = "run") -> dict[str, Any]:
        try:
            with _state_lock:
                if mode == "after_current":
                    worker.request_cancel("current")
                elif mode == "terminate_workers":
                    # Hard-stop path: cancel active run state first, then recycle worker process.
                    worker.request_cancel("run")
                    _finalize_active_run_canceled("terminated by stop")
                    _reset_runtime_test_statuses()
                    worker.stop()
                    worker.start()
                    worker.request_ping()
                    worker.request_discover()
                else:
                    worker.request_cancel("run")
            return {"ok": True, "mode": mode}
        except Exception as exc:
            _log_queue.put(f"[tests] stop failed mode={mode}: {exc}\n")
            return {"ok": False, "mode": mode, "error": str(exc)}

    def get_runs() -> list[dict[str, Any]]:
        return run_store.latest_runs(limit=30)

    def get_child_events(run_id: str, child_id: str, attempt_id: str | int | None = None) -> list[dict[str, Any]]:
        rid = str(run_id or "").strip()
        cid = str(child_id or "").strip()
        if not rid or not cid:
            return []
        events_path = RUN_STORE_ROOT / rid / "events.ndjson"
        if not events_path.exists():
            return []

        parent_id = cid.split("::", 1)[0] if "::" in cid else ""
        raw_child_id = cid.split("::", 1)[1] if "::" in cid else cid
        canonical = _canonical_child_id(parent_id, raw_child_id) if parent_id else cid
        want_attempt = str(attempt_id) if attempt_id not in (None, "", "latest") else None

        out: list[dict[str, Any]] = []
        try:
            with events_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        evt = json.loads(line)
                    except Exception:
                        continue
                    ev_type = str(evt.get("type") or "")
                    payload = evt.get("payload") if isinstance(evt.get("payload"), dict) else {}
                    pid = str(payload.get("parent_id") or "")
                    raw_id = str(payload.get("id") or "")
                    event_attempt = payload.get("attempt")
                    if want_attempt is not None and str(event_attempt) != want_attempt:
                        continue
                    candidate_ids = {raw_id}
                    if pid:
                        candidate_ids.add(_canonical_child_id(pid, raw_id))
                    if canonical not in candidate_ids:
                        continue
                    if parent_id and pid and pid != parent_id:
                        continue

                    message = ""
                    mapped_type = "note"
                    if ev_type == "test_started":
                        mapped_type = "started"
                        message = str(payload.get("status") or "started")
                    elif ev_type == "test_finished":
                        status_val = str(payload.get("status") or "finished")
                        mapped_type = "finished" if status_val in {"passed", "canceled"} else "error"
                        message = str(payload.get("message") or status_val)
                    elif ev_type == "test_output":
                        message = str(payload.get("line") or "")
                        child_note = _parse_child_note(message)
                        if child_note:
                            phase, note_text = child_note
                            if phase == "started":
                                mapped_type = "started"
                                message = note_text or "started"
                            elif phase == "finished":
                                lowered = note_text.lower()
                                mapped_type = "error" if any(tok in lowered for tok in ("fail", "error", "timeout")) else "finished"
                                message = note_text or "finished"
                            else:
                                mapped_type = "note"
                        else:
                            mapped_type = "note"
                    else:
                        continue

                    raw_ts = str(evt.get("timestamp") or "")
                    try:
                        parsed_ts = int(datetime.fromisoformat(raw_ts).timestamp() * 1000) if raw_ts else int(time.time() * 1000)
                    except Exception:
                        parsed_ts = int(time.time() * 1000)

                    out.append(
                        {
                            "id": str(evt.get("timestamp") or "") + f":{len(out)}",
                            "ts": parsed_ts,
                            "type": mapped_type,
                            "nodeId": canonical,
                            "message": message,
                            "runId": rid,
                            "attemptId": event_attempt if event_attempt is not None else "latest",
                            "parentId": parent_id,
                            "rawChildId": raw_child_id,
                        }
                    )
        except Exception:
            return []
        return out

    def get_child_progress(run_id: str, parent_id: str, attempt_id: str | int | None = None) -> list[dict[str, Any]]:
        _ = str(run_id or "").strip()
        pid = str(parent_id or "").strip()
        if not pid:
            return []
        want_attempt = str(attempt_id) if attempt_id not in (None, "", "latest") else None

        tests_by_id: dict[str, dict[str, Any]] = {
            str(row.get("id")): row
            for row in runtime.get("tests", [])
            if isinstance(row, dict) and isinstance(row.get("id"), str)
        }
        row = tests_by_id.get(pid) or {}
        children = row.get("children") if isinstance(row.get("children"), list) else []
        out: list[dict[str, Any]] = []
        for child in children:
            if not isinstance(child, dict):
                continue
            raw = str(child.get("id") or child.get("nodeid") or child.get("name") or "").strip()
            if not raw:
                continue
            cid = _canonical_child_id(pid, raw)
            st = runtime.get("test_status", {}).get(cid) or runtime.get("test_status", {}).get(raw) or {}
            attempt_val = st.get("attempt")
            if want_attempt is not None and str(attempt_val) != want_attempt:
                continue
            out.append(
                {
                    "childId": cid,
                    "rawChildId": raw,
                    "status": str(st.get("status") or "not_run"),
                    "attemptId": attempt_val if attempt_val is not None else "latest",
                    "startedAt": st.get("started_at"),
                    "finishedAt": st.get("finished_at"),
                    "message": str(st.get("message") or ""),
                }
            )
        return out

    def get_run_trace(run_id: str) -> dict[str, Any] | None:
        rid = str(run_id or "").strip()
        if not rid:
            current = runtime.get("trace_run_id")
            rid = str(current or "").strip()
        if not rid:
            runs = run_store.latest_runs(limit=1)
            rid = str(runs[0].get("run_id")) if runs else ""
        if not rid:
            return None
        return run_store.load_run_trace(rid)

    def trace_set_plan(plan_text: str | None = None, plan_json: Any | None = None, run_id: str | None = None) -> dict[str, Any]:
        rid = str(run_id or runtime.get("trace_run_id") or "")
        recorder: RunTraceRecorder | None = runtime.get("trace_recorder") if rid == str(runtime.get("trace_run_id") or "") else None
        if recorder is None and rid:
            trace_path = RUN_STORE_ROOT / rid / "run_trace.json"
            recorder = RunTraceRecorder(trace_path)
        if recorder is None:
            return {"ok": False, "error": "no active run trace"}
        recorder.set_plan(plan_text=plan_text, plan_json=plan_json)
        return {"ok": True, "run_id": rid}

    def trace_record_diff(file_path: str, before: str, after: str, run_id: str | None = None) -> dict[str, Any]:
        rid = str(run_id or runtime.get("trace_run_id") or "")
        recorder: RunTraceRecorder | None = runtime.get("trace_recorder") if rid == str(runtime.get("trace_run_id") or "") else None
        if recorder is None and rid:
            recorder = RunTraceRecorder(RUN_STORE_ROOT / rid / "run_trace.json")
        if recorder is None:
            return {"ok": False, "error": "no active run trace"}
        recorder.record_diff(file_path=file_path, before=before, after=after)
        return {"ok": True, "run_id": rid}

    def trace_add_verification(result: dict[str, Any], run_id: str | None = None) -> dict[str, Any]:
        rid = str(run_id or runtime.get("trace_run_id") or "")
        recorder: RunTraceRecorder | None = runtime.get("trace_recorder") if rid == str(runtime.get("trace_run_id") or "") else None
        if recorder is None and rid:
            recorder = RunTraceRecorder(RUN_STORE_ROOT / rid / "run_trace.json")
        if recorder is None:
            return {"ok": False, "error": "no active run trace"}
        payload = result if isinstance(result, dict) else {"value": result}
        recorder.add_verification(payload)
        return {"ok": True, "run_id": rid}

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
        webbrowser.open(f"http://127.0.0.1:{SERVER_PORT}/")

    def reload_catalog_state() -> dict[str, Any]:
        try:
            _ensure_case_deps_generated()
            _load_catalog_state()
            return {
                "ok": True,
                "tests": len(runtime.get("tests") or []),
                "case_steps": len(runtime.get("case_steps") or {}),
                "workflow_parents": len(runtime.get("workflow_steps_by_parent") or {}),
            }
        except Exception as exc:
            _log_queue.put(f"[launcher] reload catalog state failed: {exc}\n")
            return {"ok": False, "error": str(exc)}

    def clear_step_cache() -> dict[str, Any]:
        cache: dict[str, dict[str, Any]] = runtime.get("step_cache") or {}
        cleared = len(cache)
        runtime["step_cache"] = {}
        try:
            _save_step_cache({})
        except Exception as exc:
            _log_queue.put(f"[launcher] clear step cache failed: {exc}\n")
            return {"ok": False, "cleared": 0, "error": str(exc)}
        _log_queue.put(f"[launcher] cleared step cache ({cleared} entries)\n")
        return {"ok": True, "cleared": cleared}

    def resolve_artifact_image(path: str) -> dict[str, Any]:
        raw = str(path or "").strip()
        if not raw:
            return {"ok": False, "error": "empty_path"}
        try:
            target = Path(raw).expanduser().resolve()
            root = RUN_STORE_ROOT.resolve()
            if target != root and root not in target.parents:
                return {"ok": False, "error": "path_outside_run_store"}
            if not target.exists() or not target.is_file():
                return {"ok": False, "error": "file_not_found"}
            mime, _ = mimetypes.guess_type(str(target))
            if not mime:
                mime = "application/octet-stream"
            encoded = base64.b64encode(target.read_bytes()).decode("ascii")
            return {"ok": True, "url": f"data:{mime};base64,{encoded}", "mime": mime, "path": str(target)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _shutdown_once(reason: str, destroy_window: bool) -> None:
        with shutdown_lock:
            if shutdown_state["done"]:
                return
            shutdown_state["done"] = True
        _log_queue.put(f"[launcher] shutdown: {reason}\n")
        try:
            worker.stop()
        except Exception as exc:
            _log_queue.put(f"[launcher] worker stop failed: {exc}\n")
        try:
            supervisor.shutdown()
        except Exception as exc:
            _log_queue.put(f"[launcher] supervisor shutdown failed: {exc}\n")
        if destroy_window:
            try:
                window.destroy()
            except Exception as exc:
                _log_queue.put(f"[launcher] window destroy failed: {exc}\n")

    def shutdown() -> None:
        _shutdown_once("bridge_shutdown", destroy_window=True)

    def _on_window_closing(*_args: Any) -> None:
        _shutdown_once("window_closing", destroy_window=False)

    window.expose(
        get_logs,
        get_startup_state,
        get_tests,
        get_test_status,
        preview_plan,
        run_plan,
        cancel_current_test,
        cancel_run,
        stop,
        get_runs,
        get_child_events,
        get_child_progress,
        get_run_trace,
        trace_set_plan,
        trace_record_diff,
        trace_add_verification,
        open_run_dir,
        get_diagnostics_summary,
        reload_catalog_state,
        clear_step_cache,
        resolve_artifact_image,
        open_app,
        shutdown,
    )
    try:
        window.events.closing += _on_window_closing
    except Exception:
        try:
            window.events.closed += _on_window_closing
        except Exception as exc:
            _log_queue.put(f"[launcher] failed to register close hook: {exc}\n")

    try:
        webview.start(gui=None, debug=LAUNCHER_DEVTOOLS, http_server=False)
    finally:
        _shutdown_once("webview_stopped", destroy_window=False)


if __name__ == "__main__":
    main()
