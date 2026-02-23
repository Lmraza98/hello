from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Callable

# Make local package imports work when script is launched directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from launcher_runtime.catalog import TestCase, load_catalog
from launcher_runtime.planner import build_run_plan
from launcher_runtime.protocol import build_message, parse_message

DEFAULT_STALL_TIMEOUT_SEC = 0
DEFAULT_STALL_TIMEOUT_SEC_NON_LIVE = 120
STEP_JSON_PREFIX = "[launcher-step-json] "


class WorkerState:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.proc: subprocess.Popen[str] | None = None
        self.cancel_run = False
        self.cancel_current = False


def _normalized_child_specs(raw_children: Any, parent_id: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not isinstance(raw_children, list):
        return out
    for row in raw_children:
        if not isinstance(row, dict):
            continue
        nodeid = str(row.get("nodeid") or "").strip()
        if not nodeid:
            continue
        cid = str(row.get("id") or f"{parent_id}::{nodeid}").strip()
        out.append({"id": cid, "nodeid": nodeid})
    return out


def _discover_payload(catalog: Any) -> dict[str, Any]:
    tests: list[dict[str, Any]] = []
    for suite in catalog.suites:
        for test in suite.tests:
            tests.append(
                {
                    "id": test.id,
                    "suite_id": suite.id,
                    "suite_name": suite.name,
                    "name": test.name,
                    "kind": test.kind,
                    "tags": test.tags,
                    "enabled": test.enabled,
                }
            )
    return {"tests": tests}


def _stdin_reader(inbox: Queue[Any]) -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = parse_message(json.loads(line))
            inbox.put(msg)
        except Exception as exc:
            emit("worker_error", {"message": f"invalid request: {exc}"})
    inbox.put(None)


def _drain_control_messages(inbox: Queue[Any], state: WorkerState, catalog: Any, *, allow_new_run: bool = False) -> bool:
    """Drain pending stdin control messages while a run is active.

    Returns False when stdin is closed and worker should exit.
    """
    while True:
        try:
            msg = inbox.get_nowait()
        except Empty:
            break
        if msg is None:
            state.cancel_run = True
            state.cancel_current = True
            return False

        if msg.type == "cancel":
            scope = str(msg.payload.get("scope") or "run")
            if scope == "current":
                state.cancel_current = True
            else:
                state.cancel_run = True
                state.cancel_current = True
            emit("heartbeat", {"status": "cancel_requested", "scope": scope})
            continue

        if msg.type == "ping":
            emit("heartbeat", {"status": "ok"})
            continue

        if msg.type == "discover":
            emit("discover", _discover_payload(catalog))
            continue

        if msg.type in {"run_plan", "run_steps"} and not allow_new_run:
            emit("worker_error", {"message": f"busy: request {msg.type} ignored while run is active"})
            continue

        emit("worker_error", {"message": f"unknown request type: {msg.type}"})

    return True


def emit(msg_type: str, payload: dict[str, Any] | None = None) -> None:
    print(json.dumps(build_message(msg_type, payload), ensure_ascii=True), flush=True)


def process_env(allowlist: list[str]) -> dict[str, str]:
    if not allowlist:
        return {}
    out: dict[str, str] = {}
    for key in allowlist:
        if key in os.environ:
            out[key] = os.environ[key]
    return out


def terminate_proc(proc: subprocess.Popen[str], *, grace_sec: float = 2.0) -> None:
    if proc.poll() is not None:
        return
    try:
        if sys.platform.startswith("win"):
            proc.terminate()
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    deadline = time.time() + max(0.1, float(grace_sec))
    while time.time() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.05)
    if proc.poll() is not None:
        return
    try:
        if sys.platform.startswith("win"):
            proc.kill()
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _stream_stdout(proc: subprocess.Popen[str], sink: Queue[str]) -> None:
    if proc.stdout is None:
        return
    for line in proc.stdout:
        sink.put(line.rstrip("\n"))


def _rewrite_pytest_args_for_nodeid(args: list[str], nodeid: str) -> list[str]:
    rewritten: list[str] = []
    for arg in args:
        val = str(arg)
        # Strip positional pytest collection targets from the parent command.
        # Child runs must execute only the selected nodeid, not "tests" + nodeid.
        is_target = (
            (val == "tests")
            or val.startswith("tests/")
            or (val.startswith("./tests"))
            or (val.startswith(".\\tests"))
        ) and (not val.startswith("-"))
        if is_target:
            continue
        rewritten.append(val)
    rewritten.append(nodeid)
    return rewritten


def _extract_step_json(line: str, acc: dict[str, Any]) -> None:
    text = str(line or "").strip()
    if not text.startswith(STEP_JSON_PREFIX):
        return
    raw = text[len(STEP_JSON_PREFIX) :].strip()
    if not raw:
        return
    try:
        payload = json.loads(raw)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    for key in ("inputs", "tool_call", "tool_response", "outputs", "normalized_output_hash", "artifacts", "error_trace"):
        if key in payload:
            acc[key] = payload.get(key)


def _run_streamed_command(
    *,
    cmd: list[str],
    cwd: Path,
    timeout_sec: int,
    state: WorkerState,
    output_id: str,
    run_env: dict[str, str],
    parent_id: str | None = None,
    stall_timeout_sec: int | None = None,
    poll_controls: Callable[[], bool] | None = None,
) -> tuple[str, str, float, dict[str, Any]]:
    line_queue: Queue[str] = Queue()
    creationflags = 0
    preexec = None
    if sys.platform.startswith("win"):
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        preexec = os.setsid

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=run_env,
        creationflags=creationflags,
        preexec_fn=preexec,
        )
    except FileNotFoundError:
        missing = str(cmd[0] if cmd else "")
        emit("test_output", {"id": output_id, **({"parent_id": parent_id} if parent_id else {}), "line": f"[worker-error] command not found: {missing}"})
        return "failed", f"command not found: {missing}", 0.0
    except Exception as exc:
        emit("test_output", {"id": output_id, **({"parent_id": parent_id} if parent_id else {}), "line": f"[worker-error] failed to spawn command: {exc}"})
        return "failed", f"spawn failed: {exc}", 0.0
    state.proc = proc
    reader = threading.Thread(target=_stream_stdout, args=(proc, line_queue), daemon=True)
    reader.start()
    started = time.time()
    last_output_at = started
    last_heartbeat_at = started
    status = "failed"
    message = ""
    structured: dict[str, Any] = {}
    effective_stall_timeout_sec = int(stall_timeout_sec if stall_timeout_sec is not None else DEFAULT_STALL_TIMEOUT_SEC)
    # Stall kill is opt-in. Keep total timeout as the primary control by default.
    max_silence = max(1, min(timeout_sec, effective_stall_timeout_sec)) if effective_stall_timeout_sec > 0 else 0

    while True:
        if poll_controls is not None:
            keep_running = poll_controls()
            if not keep_running:
                state.cancel_run = True
                state.cancel_current = True

        while not line_queue.empty():
            line = line_queue.get_nowait()
            last_output_at = time.time()
            _extract_step_json(line, structured)
            payload: dict[str, Any] = {"id": output_id, "line": line}
            if parent_id:
                payload["parent_id"] = parent_id
            emit("test_output", payload)

        if state.cancel_current or state.cancel_run:
            terminate_proc(proc)
            status = "canceled"
            message = "canceled by user"
            break

        elapsed = time.time() - started
        if elapsed - (last_heartbeat_at - started) >= 10:
            last_heartbeat_at = time.time()
            payload: dict[str, Any] = {
                "id": output_id,
                "line": f"[worker-heartbeat] still running ({int(elapsed)}s elapsed)",
            }
            if parent_id:
                payload["parent_id"] = parent_id
            emit("test_output", payload)
        if elapsed > timeout_sec:
            terminate_proc(proc)
            status = "timed_out"
            message = f"timeout after {timeout_sec}s"
            break
        silence = time.time() - last_output_at
        if max_silence > 0 and silence > max_silence:
            terminate_proc(proc)
            status = "timed_out"
            message = f"stalled with no output for {int(max_silence)}s"
            emit(
                "test_output",
                {
                    "id": output_id,
                    "line": f"[worker-watchdog] no output for {int(max_silence)}s; terminating process",
                    **({"parent_id": parent_id} if parent_id else {}),
                },
            )
            break

        rc = proc.poll()
        if rc is not None:
            if rc == 0:
                status = "passed"
                message = ""
            else:
                status = "failed"
                message = f"exit code {rc}"
            break
        time.sleep(0.1)

    while not line_queue.empty():
        line = line_queue.get_nowait()
        _extract_step_json(line, structured)
        payload: dict[str, Any] = {"id": output_id, "line": line}
        if parent_id:
            payload["parent_id"] = parent_id
        emit("test_output", payload)

    state.proc = None
    state.cancel_current = False
    return status, message, time.time() - started, structured


def run_test(
    test: TestCase,
    state: WorkerState,
    children: list[dict[str, str]] | None = None,
    poll_controls: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    if not test.enabled:
        return {"id": test.id, "status": "canceled", "duration_sec": 0.0, "message": "disabled"}

    attempts = test.retries + 1
    status = "failed"
    message = ""
    started = time.time()

    child_results: list[dict[str, Any]] = []
    for attempt in range(1, attempts + 1):
        if state.cancel_run:
            return {"id": test.id, "status": "canceled", "duration_sec": time.time() - started, "attempt": attempt}

        if attempt > 1:
            emit("test_started", {"id": test.id, "status": "retrying", "attempt": attempt})
            time.sleep(min(3.0, float(attempt)))

        cmd = test.command_template + test.args
        # Keep interpreter consistent with worker process to avoid PATH drift
        # (e.g. bare "python" resolving to system Python without project deps).
        if cmd and str(cmd[0]).lower() in {"python", "python3", "py"}:
            cmd = [sys.executable, *cmd[1:]]
        elif cmd:
            cmd = [_normalize_command_executable(str(cmd[0])), *cmd[1:]]
        cwd = (state.project_root / test.cwd).resolve()

        emit("test_started", {"id": test.id, "status": "running", "attempt": attempt, "command": cmd, "cwd": str(cwd)})

        run_env = {**os.environ, **process_env(test.env_allowlist)}
        # Gate probes like "python -m pytest --version" should avoid plugin
        # autoload to keep startup deterministic and prevent false timeouts.
        if _is_pytest_version_probe(cmd):
            run_env.setdefault("PYTEST_DISABLE_PLUGIN_AUTOLOAD", "1")
        # For launcher-driven single-case pytest runs, keep browser flows in
        # human-cadence mode unless user explicitly disables it.
        if (
            _env_bool("LAUNCHER_FORCE_HUMAN_CADENCE", True)
            and str(test.kind or "").lower() == "live"
            and _is_pytest_command(cmd)
            and _is_browser_scrape_target(cmd)
        ):
            run_env.setdefault("BROWSER_STEALTH_ENABLED", "true")
            run_env.setdefault("BROWSER_HUMAN_TYPE_DELAY_MS", "90")
            run_env.setdefault("BROWSER_HUMAN_TYPE_JITTER_MS", "45")
            run_env.setdefault("BROWSER_ACT_TIMEOUT_MS", "20000")

        t0 = time.time()
        duration = 0.0
        stall_timeout_sec = _stall_timeout_for_test(str(test.kind or ""))

        if children and _is_pytest_command(cmd):
            failures = 0
            for child in children:
                if poll_controls is not None:
                    poll_controls()
                child_id = str(child.get("id") or "")
                child_nodeid = str(child.get("nodeid") or "")
                if not child_id or not child_nodeid:
                    continue
                if state.cancel_run:
                    status = "canceled"
                    message = "canceled by user"
                    break
                if time.time() - t0 > test.timeout_sec:
                    status = "timed_out"
                    message = f"timeout after {test.timeout_sec}s"
                    break

                child_cmd = [*test.command_template, *_rewrite_pytest_args_for_nodeid(test.args, child_nodeid)]
                if child_cmd and str(child_cmd[0]).lower() in {"python", "python3", "py"}:
                    child_cmd = [sys.executable, *child_cmd[1:]]
                elif child_cmd:
                    child_cmd = [_normalize_command_executable(str(child_cmd[0])), *child_cmd[1:]]
                emit(
                    "test_started",
                    {
                        "id": child_id,
                        "parent_id": test.id,
                        "status": "running",
                        "attempt": attempt,
                        "command": child_cmd,
                        "cwd": str(cwd),
                    },
                )
                emit("test_output", {"id": child_id, "parent_id": test.id, "line": f"[child-note] started {child_nodeid}"})
                remaining = max(1, int(test.timeout_sec - (time.time() - t0)))
                child_status, child_message, child_duration, _child_structured = _run_streamed_command(
                    cmd=child_cmd,
                    cwd=cwd,
                    timeout_sec=remaining,
                    state=state,
                    output_id=child_id,
                    run_env=run_env,
                    parent_id=test.id,
                    stall_timeout_sec=stall_timeout_sec,
                    poll_controls=poll_controls,
                )
                child_row = {
                    "id": child_id,
                    "parent_id": test.id,
                    "status": child_status,
                    "attempt": attempt,
                    "duration_sec": child_duration,
                    "message": child_message,
                }
                emit("test_finished", child_row)
                emit("test_output", {"id": child_id, "parent_id": test.id, "line": f"[child-note] finished {child_status}"})
                child_results.append(dict(child_row))
                if child_status in {"failed", "timed_out"}:
                    failures += 1
                if child_status in {"canceled", "timed_out"}:
                    status = child_status
                    message = child_message
                    break

            duration = time.time() - t0
            if status not in {"canceled", "timed_out"}:
                if failures > 0:
                    status = "failed"
                    message = f"{failures} child test(s) failed"
                else:
                    status = "passed"
                    message = ""
        else:
            status, message, duration, _structured = _run_streamed_command(
                cmd=cmd,
                cwd=cwd,
                timeout_sec=test.timeout_sec,
                state=state,
                output_id=test.id,
                run_env=run_env,
                stall_timeout_sec=stall_timeout_sec,
                poll_controls=poll_controls,
            )

        emit(
            "test_finished",
            {
                "id": test.id,
                "status": status,
                "attempt": attempt,
                "duration_sec": duration,
                "message": message,
            },
        )

        if status in {"passed", "timed_out", "canceled"}:
            break

    out = {
        "id": test.id,
        "status": status,
        "duration_sec": time.time() - started,
        "message": message,
        "retries": test.retries,
    }
    if child_results:
        out["children"] = child_results
    return out


def run_step_payload(step: dict[str, Any], state: WorkerState, poll_controls: Callable[[], bool] | None = None) -> dict[str, Any]:
    step_id = str(step.get("id") or "step-unknown")
    label = str(step.get("label") or step_id)
    if bool(step.get("skip")):
        emit(
            "test_finished",
            {
                "id": step_id,
                "status": "passed",
                "attempt": 0,
                "duration_sec": 0.0,
                "message": "passed (cache satisfied)",
                "cached": True,
            },
        )
        return {
            "id": step_id,
            "status": "passed",
            "duration_sec": 0.0,
            "message": "passed (cache satisfied)",
            "label": label,
            "cached": True,
        }

    command_template = [str(x) for x in step.get("command_template", []) if str(x).strip()]
    args = [str(x) for x in step.get("args", []) if str(x).strip()]
    if not command_template:
        emit(
            "test_finished",
            {
                "id": step_id,
                "status": "failed",
                "attempt": 0,
                "duration_sec": 0.0,
                "message": "missing command_template",
            },
        )
        return {"id": step_id, "status": "failed", "duration_sec": 0.0, "message": "missing command_template", "label": label}

    kind = str(step.get("kind") or "custom")
    cwd = (state.project_root / str(step.get("cwd") or ".")).resolve()
    run_env = {**os.environ, **process_env([str(x) for x in step.get("env_allowlist", []) if str(x).strip()])}
    cmd = command_template + args
    if cmd and str(cmd[0]).lower() in {"python", "python3", "py"}:
        cmd = [sys.executable, *cmd[1:]]
    elif cmd:
        cmd = [_normalize_command_executable(str(cmd[0])), *cmd[1:]]

    emit("test_started", {"id": step_id, "status": "running", "attempt": 1, "command": cmd, "cwd": str(cwd)})
    status, message, duration, structured = _run_streamed_command(
        cmd=cmd,
        cwd=cwd,
        timeout_sec=max(1, int(step.get("timeout_sec") or 300)),
        state=state,
        output_id=step_id,
        run_env=run_env,
        stall_timeout_sec=_stall_timeout_for_test(kind),
        poll_controls=poll_controls,
    )

    finished_payload: dict[str, Any] = {
        "id": step_id,
        "status": status,
        "attempt": 1,
        "duration_sec": duration,
        "message": message,
        "cache_key": step.get("cache_key"),
    }
    for key in ("inputs", "tool_call", "tool_response", "outputs", "normalized_output_hash", "artifacts", "error_trace"):
        if key in structured:
            finished_payload[key] = structured.get(key)
    emit("test_finished", finished_payload)

    out = {
        "id": step_id,
        "status": status,
        "duration_sec": duration,
        "message": message,
        "label": label,
        "cache_key": step.get("cache_key"),
    }
    for key in ("inputs", "tool_call", "tool_response", "outputs", "normalized_output_hash", "artifacts", "error_trace"):
        if key in structured:
            out[key] = structured.get(key)
    return out


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _stall_timeout_for_test(test_kind: str) -> int:
    """
    Resolve stall-timeout policy.
    - Non-live tests always get a silence watchdog by default.
    - Live tests keep watchdog off by default.
    - LAUNCHER_TEST_STALL_TIMEOUT_SEC:
      - >0: explicit global override.
      - <=0: only disables live watchdog; non-live still uses default fail-fast.
    """
    raw = os.getenv("LAUNCHER_TEST_STALL_TIMEOUT_SEC")
    kind = str(test_kind or "").strip().lower()
    if raw is not None:
        try:
            parsed = int(str(raw).strip() or "0")
        except Exception:
            parsed = 0
        if parsed > 0:
            return parsed
        return 0 if kind == "live" else DEFAULT_STALL_TIMEOUT_SEC_NON_LIVE
    return 0 if kind == "live" else DEFAULT_STALL_TIMEOUT_SEC_NON_LIVE


def _normalize_command_executable(executable: str) -> str:
    exe = str(executable or "").strip()
    if not exe:
        return exe
    if not sys.platform.startswith("win"):
        return exe
    lowered = exe.lower()
    if lowered in {"npm", "npx"}:
        candidate = f"{lowered}.cmd"
        resolved = shutil.which(candidate)
        return resolved or candidate
    return exe


def _is_pytest_command(cmd: list[str]) -> bool:
    joined = " ".join(str(x) for x in cmd).lower()
    return "-m pytest" in joined or " pytest " in f" {joined} "


def _is_pytest_version_probe(cmd: list[str]) -> bool:
    if not _is_pytest_command(cmd):
        return False
    lowered = {str(x).strip().lower() for x in (cmd or [])}
    return "--version" in lowered


def _is_browser_scrape_target(cmd: list[str]) -> bool:
    text = " ".join(str(x) for x in cmd).lower()
    markers = (
        "salesnav",
        "browser_workflow",
        "google_workflow",
        "challenge",
        "linkedin",
    )
    return any(marker in text for marker in markers)


def main() -> int:
    parser = argparse.ArgumentParser(description="Launcher test worker")
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--project-root", required=True)
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    project_root = Path(args.project_root)

    catalog = load_catalog(catalog_path)
    state = WorkerState(project_root=project_root)
    inbox: Queue[Any] = Queue()
    stdin_thread = threading.Thread(target=_stdin_reader, args=(inbox,), daemon=True)
    stdin_thread.start()

    emit("heartbeat", {"status": "ready"})

    while True:
        try:
            msg = inbox.get(timeout=0.2)
        except Empty:
            continue
        if msg is None:
            break

        if msg.type == "ping":
            emit("heartbeat", {"status": "ok"})
            continue

        if msg.type == "discover":
            emit("discover", _discover_payload(catalog))
            continue

        if msg.type == "cancel":
            scope = str(msg.payload.get("scope") or "run")
            if scope == "current":
                state.cancel_current = True
            else:
                state.cancel_run = True
                state.cancel_current = True
            emit("heartbeat", {"status": "cancel_requested", "scope": scope})
            continue

        if msg.type == "run_plan":
            state.cancel_run = False
            state.cancel_current = False

            payload = msg.payload
            run_id = str(payload.get("run_id") or "run-unknown")
            selected_ids = [str(i) for i in payload.get("test_ids", []) if isinstance(i, str)]
            selected_tags = [str(i) for i in payload.get("tags", []) if isinstance(i, str)]
            child_map_raw = payload.get("children_by_test") if isinstance(payload.get("children_by_test"), dict) else {}
            child_map: dict[str, list[dict[str, str]]] = {}
            for key, raw_children in child_map_raw.items():
                if not isinstance(key, str):
                    continue
                child_map[key] = _normalized_child_specs(raw_children, key)

            try:
                plan = build_run_plan(catalog, test_ids=selected_ids or None, tags=selected_tags or None)
            except Exception as exc:
                emit("worker_error", {"run_id": run_id, "message": f"invalid run plan: {exc}"})
                emit("run_finished", {"run_id": run_id, "status": "failed", "tests": [], "duration_sec": 0.0})
                continue

            emit("run_started", {"run_id": run_id, "count": len(plan), "test_ids": [p.test.id for p in plan]})
            started = time.time()
            results: list[dict[str, Any]] = []
            final_status = "passed"

            for planned in plan:
                _drain_control_messages(inbox, state, catalog)
                if state.cancel_run:
                    final_status = "canceled"
                    break
                try:
                    outcome = run_test(
                        planned.test,
                        state,
                        children=child_map.get(planned.test.id),
                        poll_controls=lambda: _drain_control_messages(inbox, state, catalog),
                    )
                except Exception as exc:
                    emit("worker_error", {"run_id": run_id, "message": f"run_test failed for {planned.test.id}: {exc}"})
                    outcome = {
                        "id": planned.test.id,
                        "status": "failed",
                        "duration_sec": 0.0,
                        "message": f"worker exception: {exc}",
                        "retries": getattr(planned.test, "retries", 0),
                    }
                    emit(
                        "test_finished",
                        {
                            "id": planned.test.id,
                            "status": "failed",
                            "attempt": 1,
                            "duration_sec": 0.0,
                            "message": f"worker exception: {exc}",
                        },
                    )
                results.append(outcome)
                if outcome["status"] in {"failed", "timed_out"}:
                    final_status = "failed"
                if outcome["status"] == "canceled":
                    final_status = "canceled"
                    if state.cancel_run:
                        break

            emit(
                "run_finished",
                {
                    "run_id": run_id,
                    "status": final_status,
                    "tests": results,
                    "duration_sec": time.time() - started,
                },
            )
            continue

        if msg.type == "run_steps":
            state.cancel_run = False
            state.cancel_current = False

            payload = msg.payload
            run_id = str(payload.get("run_id") or "run-unknown")
            steps = payload.get("steps") if isinstance(payload.get("steps"), list) else []
            normalized_steps = [s for s in steps if isinstance(s, dict)]
            emit("run_started", {"run_id": run_id, "count": len(normalized_steps), "test_ids": [str(s.get("id") or "step-unknown") for s in normalized_steps]})
            started = time.time()
            results: list[dict[str, Any]] = []
            final_status = "passed"

            for step in normalized_steps:
                _drain_control_messages(inbox, state, catalog)
                if state.cancel_run:
                    final_status = "canceled"
                    break
                try:
                    outcome = run_step_payload(
                        step,
                        state,
                        poll_controls=lambda: _drain_control_messages(inbox, state, catalog),
                    )
                except Exception as exc:
                    step_id = str(step.get("id") or "step-unknown")
                    emit("worker_error", {"run_id": run_id, "message": f"run_step failed for {step_id}: {exc}"})
                    outcome = {
                        "id": step_id,
                        "status": "failed",
                        "duration_sec": 0.0,
                        "message": f"worker exception: {exc}",
                    }
                    emit(
                        "test_finished",
                        {
                            "id": step_id,
                            "status": "failed",
                            "attempt": 1,
                            "duration_sec": 0.0,
                            "message": f"worker exception: {exc}",
                        },
                    )
                results.append(outcome)
                if outcome["status"] in {"failed", "timed_out"}:
                    final_status = "failed"
                if outcome["status"] == "canceled" and state.cancel_run:
                    final_status = "canceled"
                    break

            emit(
                "run_finished",
                {
                    "run_id": run_id,
                    "status": final_status,
                    "tests": results,
                    "duration_sec": time.time() - started,
                    "mode": "steps",
                },
            )
            continue

        emit("worker_error", {"message": f"unknown request type: {msg.type}"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
