"""Process runner helpers for pipeline routes."""

from __future__ import annotations

import os
import subprocess
from typing import Optional

from api.routes.pipeline_routes.state import append_output, mark_finished, set_process


def _sanitize_console_text(line: str) -> str:
    cleaned = line.strip()
    return cleaned.encode("ascii", "replace").decode("ascii")


def run_streaming_command(
    cmd: list[str],
    *,
    cwd: Optional[str] = None,
    extra_env: Optional[dict[str, str]] = None,
) -> None:
    """Run command and stream output into shared pipeline state."""
    try:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUNBUFFERED"] = "1"
        if extra_env:
            env.update(extra_env)

        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=0,
            env=env,
        )
        set_process(process)

        for line in iter(process.stdout.readline, ""):
            if line:
                append_output(_sanitize_console_text(line))

        process.wait()
    except Exception as exc:
        append_output(f"ERROR: {exc}")
    finally:
        mark_finished()

