from __future__ import annotations

import difflib
import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Any


class RunTraceRecorder:
    """Thread-safe trace recorder persisted as JSON."""

    def __init__(self, trace_path: Path):
        self.trace_path = trace_path
        self._lock = threading.RLock()
        self._steps: dict[str, dict[str, Any]] = {}
        self._trace: dict[str, Any] = {
            "schema_version": "run_trace.v1",
            "run": {},
            "plan": {"ordered_steps": []},
            "steps": [],
            "timeline": [],
            "evidence": {
                "logs": [],
                "commands": [],
                "network_calls": [],
                "artifacts": [],
                "verification": [],
            },
            "changes": [],
        }
        if self.trace_path.exists():
            try:
                raw = json.loads(self.trace_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self._trace.update(raw)
                    for row in raw.get("steps", []) if isinstance(raw.get("steps"), list) else []:
                        if isinstance(row, dict) and isinstance(row.get("id"), str):
                            self._steps[row["id"]] = dict(row)
            except Exception:
                pass

    def _persist(self) -> None:
        self.trace_path.parent.mkdir(parents=True, exist_ok=True)
        payload = dict(self._trace)
        payload["steps"] = sorted(self._steps.values(), key=lambda s: (float(s.get("started_at_ts") or 0.0), str(s.get("id") or "")))
        payload_json = json.dumps(payload, indent=2)
        tmp = self.trace_path.parent / f"{self.trace_path.name}.tmp.{os.getpid()}.{threading.get_ident()}"
        tmp.write_text(payload_json, encoding="utf-8")
        last_err: Exception | None = None
        for attempt in range(10):
            try:
                tmp.replace(self.trace_path)
                return
            except PermissionError as exc:
                # Windows may transiently lock target while another thread/process reads.
                last_err = exc
                time.sleep(0.02 * (attempt + 1))
            except Exception as exc:
                last_err = exc
                break
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        # Never crash the worker event loop because trace persistence is locked.
        self._trace["last_persist_error"] = {
            "ts": time.time(),
            "error": f"{type(last_err).__name__}: {last_err}" if last_err else "unknown persist error",
        }

    def _append_timeline(self, event_type: str, data: dict[str, Any]) -> None:
        self._trace.setdefault("timeline", []).append(
            {
                "ts": time.time(),
                "type": event_type,
                **data,
            }
        )

    def start_run(self, *, run: dict[str, Any], plan: dict[str, Any]) -> None:
        with self._lock:
            self._trace["run"] = dict(run)
            self._trace["plan"] = dict(plan)
            self._append_timeline("run_started", {"run_id": run.get("id")})
            self._persist()

    def end_run(self, *, status: str, duration_sec: float | None = None, extra: dict[str, Any] | None = None) -> None:
        with self._lock:
            run = self._trace.setdefault("run", {})
            run["status"] = status
            run["finished_at_ts"] = time.time()
            if duration_sec is not None:
                run["duration_sec"] = float(duration_sec)
            if extra:
                run.update(extra)
            self._append_timeline("run_finished", {"status": status, "duration_sec": duration_sec})
            self._persist()

    def set_plan(self, *, plan_text: str | None = None, plan_json: Any = None) -> None:
        with self._lock:
            plan = self._trace.setdefault("plan", {})
            if plan_text is not None:
                plan["plan_text"] = str(plan_text)
            if plan_json is not None:
                plan["plan_json"] = plan_json
            self._append_timeline("plan_updated", {})
            self._persist()

    def start_step(self, *, step_id: str, label: str | None = None, inputs: dict[str, Any] | None = None) -> None:
        with self._lock:
            now = time.time()
            step = self._steps.setdefault(step_id, {"id": step_id})
            step["label"] = label or step.get("label") or step_id
            step["status"] = "running"
            step["started_at_ts"] = now
            step["started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
            if inputs is not None:
                step["inputs"] = inputs
            self._append_timeline("step_started", {"step_id": step_id, "label": step.get("label")})
            self._persist()

    def end_step(
        self,
        *,
        step_id: str,
        status: str,
        outputs: dict[str, Any] | None = None,
        duration_sec: float | None = None,
        error: str | None = None,
    ) -> None:
        with self._lock:
            now = time.time()
            step = self._steps.setdefault(step_id, {"id": step_id})
            started_ts = float(step.get("started_at_ts") or now)
            step["status"] = status
            step["finished_at_ts"] = now
            step["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
            step["duration_sec"] = float(duration_sec if duration_sec is not None else max(0.0, now - started_ts))
            if outputs is not None:
                step["outputs"] = outputs
            if error:
                step["error"] = error
            self._append_timeline("step_finished", {"step_id": step_id, "status": status, "duration_sec": step.get("duration_sec")})
            self._persist()

    def log(self, *, level: str, message: str, data: dict[str, Any] | None = None, step_id: str | None = None) -> None:
        with self._lock:
            row = {
                "ts": time.time(),
                "level": level,
                "message": message,
            }
            if step_id:
                row["step_id"] = step_id
            if data is not None:
                row["data"] = data
            self._trace.setdefault("evidence", {}).setdefault("logs", []).append(row)
            self._append_timeline("log", {"level": level, "step_id": step_id})
            self._persist()

    def attach_artifact(self, *, artifact_type: str, path: str, meta: dict[str, Any] | None = None) -> None:
        with self._lock:
            row = {"ts": time.time(), "type": artifact_type, "path": path, "meta": meta or {}}
            self._trace.setdefault("evidence", {}).setdefault("artifacts", []).append(row)
            self._append_timeline("artifact", {"artifact_type": artifact_type, "path": path})
            self._persist()

    def add_command(self, *, command: list[str], cwd: str | None = None, step_id: str | None = None) -> None:
        with self._lock:
            row = {"ts": time.time(), "command": list(command)}
            if cwd:
                row["cwd"] = cwd
            if step_id:
                row["step_id"] = step_id
            self._trace.setdefault("evidence", {}).setdefault("commands", []).append(row)
            self._append_timeline("command", {"step_id": step_id})
            self._persist()

    def add_verification(self, verification: dict[str, Any]) -> None:
        with self._lock:
            self._trace.setdefault("evidence", {}).setdefault("verification", []).append(
                {
                    "ts": time.time(),
                    **verification,
                }
            )
            self._append_timeline("verification", {})
            self._persist()

    def record_diff(self, *, file_path: str, before: str, after: str) -> None:
        with self._lock:
            diff = "\n".join(
                difflib.unified_diff(
                    before.splitlines(),
                    after.splitlines(),
                    fromfile=f"a/{file_path}",
                    tofile=f"b/{file_path}",
                    lineterm="",
                )
            )
            row = {
                "ts": time.time(),
                "file_path": file_path,
                "before_sha256": hashlib.sha256(before.encode("utf-8")).hexdigest(),
                "after_sha256": hashlib.sha256(after.encode("utf-8")).hexdigest(),
                "diff": diff,
            }
            self._trace.setdefault("changes", []).append(row)
            self._append_timeline("diff", {"file_path": file_path})
            self._persist()

    def record_unified_diff(self, *, file_path: str, unified_diff: str) -> None:
        with self._lock:
            row = {
                "ts": time.time(),
                "file_path": file_path,
                "diff": unified_diff,
            }
            self._trace.setdefault("changes", []).append(row)
            self._append_timeline("diff", {"file_path": file_path})
            self._persist()
