from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path


def _start_worker(catalog_path: Path, project_root: Path) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [
            sys.executable,
            "scripts/launcher_test_worker.py",
            "--catalog",
            str(catalog_path),
            "--project-root",
            str(project_root),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(project_root),
        bufsize=1,
    )


def _send(proc: subprocess.Popen[str], msg_type: str, payload: dict) -> None:
    assert proc.stdin is not None
    proc.stdin.write(json.dumps({"type": msg_type, "payload": payload}) + "\n")
    proc.stdin.flush()


def _collect(proc: subprocess.Popen[str], timeout: float = 10.0) -> list[dict]:
    assert proc.stdout is not None
    out: list[dict] = []
    end = time.time() + timeout
    while time.time() < end:
        line = proc.stdout.readline().strip()
        if not line:
            continue
        out.append(json.loads(line))
        if out[-1].get("type") == "run_finished":
            break
    return out


def test_worker_timeout(tmp_path: Path):
    sleep_script = tmp_path / "sleep_test.py"
    sleep_script.write_text("import time\ntime.sleep(2)\n", encoding="utf-8")

    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        json.dumps(
            {
                "catalog_version": "1",
                "suites": [
                    {
                        "id": "suite",
                        "name": "suite",
                        "description": "suite",
                        "tags": ["int"],
                        "tests": [
                            {
                                "id": "slow",
                                "name": "slow",
                                "kind": "integration",
                                "command_template": ["python", str(sleep_script)],
                                "args": [],
                                "cwd": ".",
                                "timeout_sec": 1,
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    proc = _start_worker(catalog, Path.cwd())
    try:
        _send(proc, "run_plan", {"run_id": "r1", "test_ids": ["slow"]})
        events = _collect(proc)
    finally:
        proc.terminate()

    test_finished = [e for e in events if e.get("type") == "test_finished"]
    assert test_finished
    assert test_finished[-1]["payload"]["status"] == "timed_out"


def test_worker_cancel_run(tmp_path: Path):
    sleep_script = tmp_path / "sleep_test_cancel.py"
    sleep_script.write_text("import time\ntime.sleep(5)\n", encoding="utf-8")

    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        json.dumps(
            {
                "catalog_version": "1",
                "suites": [
                    {
                        "id": "suite",
                        "name": "suite",
                        "description": "suite",
                        "tags": ["int"],
                        "tests": [
                            {
                                "id": "slow",
                                "name": "slow",
                                "kind": "integration",
                                "command_template": ["python", str(sleep_script)],
                                "args": [],
                                "cwd": ".",
                                "timeout_sec": 10,
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    proc = _start_worker(catalog, Path.cwd())
    try:
        _send(proc, "run_plan", {"run_id": "r2", "test_ids": ["slow"]})
        time.sleep(0.8)
        _send(proc, "cancel", {"scope": "run"})
        events = _collect(proc)
    finally:
        proc.terminate()

    run_finished = [e for e in events if e.get("type") == "run_finished"]
    assert run_finished
    assert run_finished[-1]["payload"]["status"] == "canceled"
