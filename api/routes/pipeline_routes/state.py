"""Shared pipeline state and synchronization helpers."""

from __future__ import annotations

import threading
from datetime import datetime

pipeline = {
    "running": False,
    "output": [],
    "process": None,
    "started_at": None,
}

output_lock = threading.Lock()
MAX_OUTPUT_LINES = 200


def is_running() -> bool:
    with output_lock:
        return bool(pipeline["running"])


def initialize_run(start_text: str | None = None) -> None:
    with output_lock:
        pipeline["running"] = True
        pipeline["output"] = []
        pipeline["started_at"] = datetime.now().isoformat()
        pipeline["process"] = None
        if start_text:
            pipeline["output"].append(
                {
                    "time": datetime.now().isoformat(),
                    "text": start_text,
                }
            )


def append_output(text: str) -> None:
    with output_lock:
        pipeline["output"].append({"time": datetime.now().isoformat(), "text": text})
        if len(pipeline["output"]) > MAX_OUTPUT_LINES:
            pipeline["output"] = pipeline["output"][-MAX_OUTPUT_LINES:]


def set_process(process) -> None:
    with output_lock:
        pipeline["process"] = process


def mark_finished() -> None:
    with output_lock:
        pipeline["running"] = False
        pipeline["process"] = None


def snapshot(last_lines: int = 50) -> dict:
    with output_lock:
        return {
            "running": pipeline["running"],
            "output": pipeline["output"][-last_lines:],
            "started_at": pipeline["started_at"],
        }


def stop_process() -> None:
    with output_lock:
        process = pipeline["process"]
    if process:
        process.terminate()
    with output_lock:
        pipeline["running"] = False
