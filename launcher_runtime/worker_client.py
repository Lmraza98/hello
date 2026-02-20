from __future__ import annotations

import json
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from .protocol import build_message, parse_message


class WorkerError(RuntimeError):
    """Raised for launcher worker communication failures."""


class WorkerClient:
    def __init__(self, worker_script: Path, catalog_path: Path, project_root: Path):
        self.worker_script = worker_script
        self.catalog_path = catalog_path
        self.project_root = project_root
        self.proc: subprocess.Popen[str] | None = None
        self.events: "queue.Queue[dict[str, Any]]" = queue.Queue()
        self._reader_thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if self.proc and self.proc.poll() is None:
                return
            self.proc = subprocess.Popen(
                [
                    sys.executable,
                    str(self.worker_script),
                    "--catalog",
                    str(self.catalog_path),
                    "--project-root",
                    str(self.project_root),
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            self._reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
            self._reader_thread.start()

    def stop(self) -> None:
        with self._lock:
            if not self.proc:
                return
            try:
                self.send("cancel", {"scope": "run"})
            except Exception:
                pass
            self.proc.terminate()
            self.proc = None

    def is_alive(self) -> bool:
        return bool(self.proc and self.proc.poll() is None)

    def restart(self) -> None:
        self.stop()
        self.start()

    def send(self, msg_type: str, payload: dict[str, Any] | None = None) -> None:
        if not self.proc or self.proc.poll() is not None:
            raise WorkerError("worker is not running")
        if self.proc.stdin is None:
            raise WorkerError("worker stdin unavailable")
        msg = build_message(msg_type, payload)
        self.proc.stdin.write(json.dumps(msg, ensure_ascii=True) + "\n")
        self.proc.stdin.flush()

    def poll_events(self, limit: int = 200) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for _ in range(limit):
            try:
                out.append(self.events.get_nowait())
            except queue.Empty:
                break
        return out

    def request_ping(self) -> None:
        self.send("ping", {})

    def request_discover(self) -> None:
        self.send("discover", {})

    def request_run_plan(self, payload: dict[str, Any]) -> None:
        self.send("run_plan", payload)

    def request_cancel(self, scope: str = "run") -> None:
        self.send("cancel", {"scope": scope})

    def _reader_loop(self) -> None:
        assert self.proc is not None
        if self.proc.stdout is None:
            return
        for line in self.proc.stdout:
            text = line.strip()
            if not text:
                continue
            try:
                raw = json.loads(text)
                parsed = parse_message(raw)
                self.events.put({"type": parsed.type, "payload": parsed.payload, "timestamp": raw.get("timestamp")})
            except Exception:
                self.events.put(
                    {
                        "type": "worker_error",
                        "payload": {"message": f"invalid worker output: {text[:300]}"},
                    }
                )

        self.events.put({"type": "worker_error", "payload": {"message": "worker process exited"}})
