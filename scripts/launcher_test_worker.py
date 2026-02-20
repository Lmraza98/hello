from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Queue
from typing import Any

# Make local package imports work when script is launched directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from launcher_runtime.catalog import TestCase, load_catalog
from launcher_runtime.planner import build_run_plan
from launcher_runtime.protocol import build_message, parse_message


class WorkerState:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.proc: subprocess.Popen[str] | None = None
        self.cancel_run = False
        self.cancel_current = False


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


def terminate_proc(proc: subprocess.Popen[str]) -> None:
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


def _stream_stdout(proc: subprocess.Popen[str], sink: Queue[str]) -> None:
    if proc.stdout is None:
        return
    for line in proc.stdout:
        sink.put(line.rstrip("\n"))


def run_test(test: TestCase, state: WorkerState) -> dict[str, Any]:
    if not test.enabled:
        return {"id": test.id, "status": "canceled", "duration_sec": 0.0, "message": "disabled"}

    attempts = test.retries + 1
    status = "failed"
    message = ""
    started = time.time()

    for attempt in range(1, attempts + 1):
        if state.cancel_run:
            return {"id": test.id, "status": "canceled", "duration_sec": time.time() - started, "attempt": attempt}

        if attempt > 1:
            emit("test_started", {"id": test.id, "status": "retrying", "attempt": attempt})
            time.sleep(min(3.0, float(attempt)))

        cmd = test.command_template + test.args
        cwd = (state.project_root / test.cwd).resolve()

        emit("test_started", {"id": test.id, "status": "running", "attempt": attempt, "command": cmd, "cwd": str(cwd)})
        line_queue: Queue[str] = Queue()

        creationflags = 0
        preexec = None
        if sys.platform.startswith("win"):
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            preexec = os.setsid

        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env={**os.environ, **process_env(test.env_allowlist)},
            creationflags=creationflags,
            preexec_fn=preexec,
        )
        state.proc = proc

        reader = threading.Thread(target=_stream_stdout, args=(proc, line_queue), daemon=True)
        reader.start()
        t0 = time.time()

        while True:
            while not line_queue.empty():
                line = line_queue.get_nowait()
                emit("test_output", {"id": test.id, "line": line})

            if state.cancel_current or state.cancel_run:
                terminate_proc(proc)
                status = "canceled"
                message = "canceled by user"
                break

            elapsed = time.time() - t0
            if elapsed > test.timeout_sec:
                terminate_proc(proc)
                status = "timed_out"
                message = f"timeout after {test.timeout_sec}s"
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
            emit("test_output", {"id": test.id, "line": line})

        state.proc = None
        state.cancel_current = False
        duration = time.time() - t0

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

    return {
        "id": test.id,
        "status": status,
        "duration_sec": time.time() - started,
        "message": message,
        "retries": test.retries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Launcher test worker")
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--project-root", required=True)
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    project_root = Path(args.project_root)

    catalog = load_catalog(catalog_path)
    state = WorkerState(project_root=project_root)

    emit("heartbeat", {"status": "ready"})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = parse_message(json.loads(line))
        except Exception as exc:
            emit("worker_error", {"message": f"invalid request: {exc}"})
            continue

        if msg.type == "ping":
            emit("heartbeat", {"status": "ok"})
            continue

        if msg.type == "discover":
            tests = []
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
            emit("discover", {"tests": tests})
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
                if state.cancel_run:
                    final_status = "canceled"
                    break
                outcome = run_test(planned.test, state)
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

        emit("worker_error", {"message": f"unknown request type: {msg.type}"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
