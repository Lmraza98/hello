from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

PREFIX = "[launcher-step-json] "


def _emit_structured(payload: dict[str, Any]) -> None:
    print(PREFIX + json.dumps(payload, ensure_ascii=True), flush=True)


def _sha(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run_pytest_step(*, label: str, nodeids: list[str], artifacts_dir: Path, timeout_sec: int) -> int:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    junit_path = artifacts_dir / "junit.xml"
    output_path = artifacts_dir / "pytest_output.txt"
    summary_path = artifacts_dir / "summary.json"

    cmd = [sys.executable, "-m", "pytest", "-q", *nodeids, f"--junitxml={junit_path.as_posix()}"]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=max(1, int(timeout_sec)),
        check=False,
    )
    duration_sec = max(0.0, time.time() - started)
    combined_output = ((proc.stdout or "") + ("\n" if proc.stdout and proc.stderr else "") + (proc.stderr or "")).strip()
    output_path.write_text(combined_output + ("\n" if combined_output else ""), encoding="utf-8")

    summary = {
        "label": label,
        "nodeids": nodeids,
        "returncode": int(proc.returncode),
        "duration_sec": duration_sec,
        "command": cmd,
        "output_path": str(output_path),
        "junit_path": str(junit_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    structured = {
        "inputs": {"label": label, "nodeids": nodeids, "timeout_sec": timeout_sec},
        "tool_call": {"command": cmd},
        "tool_response": {
            "returncode": int(proc.returncode),
            "stdout_tail": (proc.stdout or "")[-4000:],
            "stderr_tail": (proc.stderr or "")[-4000:],
        },
        "outputs": {
            "label": label,
            "duration_sec": duration_sec,
            "passed": proc.returncode == 0,
        },
        "normalized_output_hash": _sha(summary),
        "artifacts": [
            {"type": "junit", "path": str(junit_path)},
            {"type": "log", "path": str(output_path)},
            {"type": "json", "path": str(summary_path)},
        ],
    }
    if proc.returncode != 0:
        structured["error_trace"] = f"pytest step failed (returncode={proc.returncode})"
    _emit_structured(structured)
    if combined_output:
        print(combined_output, flush=True)
    return int(proc.returncode)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run pytest nodeids as a workflow step with structured artifacts")
    parser.add_argument("--label", required=True)
    parser.add_argument("--artifacts-dir", required=True)
    parser.add_argument("--timeout-sec", type=int, default=600)
    parser.add_argument("--nodeid", action="append", default=[])
    args = parser.parse_args()

    nodeids = [str(x).strip() for x in args.nodeid if str(x).strip()]
    if not nodeids:
        _emit_structured({"error_trace": "no --nodeid values provided", "outputs": {}})
        return 2

    try:
        return run_pytest_step(
            label=str(args.label).strip(),
            nodeids=nodeids,
            artifacts_dir=Path(args.artifacts_dir),
            timeout_sec=max(1, int(args.timeout_sec)),
        )
    except subprocess.TimeoutExpired as exc:
        _emit_structured({"error_trace": f"pytest step timed out: {exc}", "outputs": {}})
        return 124
    except Exception as exc:
        _emit_structured({"error_trace": str(exc), "outputs": {}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

