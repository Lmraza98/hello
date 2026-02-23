from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .protocol import utc_now_iso


@dataclass(slots=True)
class RunPaths:
    run_id: str
    run_dir: Path
    metadata: Path
    events: Path
    stdout: Path
    junit: Path
    results: Path
    trace: Path


class RunStore:
    def __init__(self, root: Path, max_runs: int = 50, max_age_days: int = 30):
        self.root = root
        self.max_runs = max_runs
        self.max_age_days = max_age_days
        self.root.mkdir(parents=True, exist_ok=True)

    def ensure_writable(self) -> None:
        probe = self.root / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)

    def start_run(self) -> RunPaths:
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        nonce = datetime.now(UTC).strftime("%f")
        run_id = f"run-{stamp}-{nonce}"
        run_dir = self.root / run_id
        run_dir.mkdir(parents=True, exist_ok=False)

        paths = RunPaths(
            run_id=run_id,
            run_dir=run_dir,
            metadata=run_dir / "metadata.json",
            events=run_dir / "events.ndjson",
            stdout=run_dir / "stdout.log",
            junit=run_dir / "results.junit.xml",
            results=run_dir / "results.json",
            trace=run_dir / "run_trace.json",
        )

        self.write_metadata(
            paths,
            {
                "run_id": run_id,
                "started_at": utc_now_iso(),
                "status": "running",
                "artifacts": {
                    "events": str(paths.events),
                    "stdout": str(paths.stdout),
                    "junit": str(paths.junit),
                    "json": str(paths.results),
                    "trace": str(paths.trace),
                },
            },
        )
        return paths

    def write_metadata(self, paths: RunPaths, data: dict[str, Any]) -> None:
        paths.metadata.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def append_event(self, paths: RunPaths, event: dict[str, Any]) -> None:
        with paths.events.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=True) + "\n")

    def append_stdout(self, paths: RunPaths, line: str) -> None:
        with paths.stdout.open("a", encoding="utf-8") as f:
            f.write(line)

    def write_results(self, paths: RunPaths, result: dict[str, Any]) -> None:
        paths.results.write_text(json.dumps(result, indent=2), encoding="utf-8")

    def write_junit(self, paths: RunPaths, result: dict[str, Any]) -> None:
        tests = result.get("tests", []) if isinstance(result, dict) else []
        total = len(tests)
        failures = sum(1 for t in tests if t.get("status") in {"failed", "timed_out"})
        skipped = sum(1 for t in tests if t.get("status") == "canceled")
        time_sec = float(result.get("duration_sec") or 0.0)

        lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            f'<testsuite name="launcher-run" tests="{total}" failures="{failures}" skipped="{skipped}" time="{time_sec:.3f}">',
        ]
        for test in tests:
            name = str(test.get("id", "unknown"))
            test_time = float(test.get("duration_sec") or 0.0)
            lines.append(f'  <testcase classname="launcher" name="{name}" time="{test_time:.3f}">')
            status = str(test.get("status", ""))
            if status in {"failed", "timed_out"}:
                message = str(test.get("message", status)).replace("&", "&amp;").replace("<", "&lt;")
                lines.append(f'    <failure message="{message}"/>')
            elif status == "canceled":
                lines.append('    <skipped message="canceled"/>')
            lines.append("  </testcase>")
        lines.append("</testsuite>")
        paths.junit.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def finalize_run(self, paths: RunPaths, *, status: str, finished_at: str | None = None, **extra: Any) -> None:
        current = {}
        if paths.metadata.exists():
            current = json.loads(paths.metadata.read_text(encoding="utf-8"))
        current.update(extra)
        current["status"] = status
        current["finished_at"] = finished_at or utc_now_iso()
        self.write_metadata(paths, current)

    def prune(self) -> dict[str, int]:
        now = datetime.now(UTC)
        cutoff = now - timedelta(days=self.max_age_days)
        runs = sorted([p for p in self.root.iterdir() if p.is_dir() and p.name.startswith("run-")], key=lambda p: p.name)

        removed_age = 0
        for run_dir in runs:
            mtime = datetime.fromtimestamp(run_dir.stat().st_mtime, tz=UTC)
            if mtime < cutoff:
                shutil.rmtree(run_dir, ignore_errors=True)
                removed_age += 1

        runs = sorted([p for p in self.root.iterdir() if p.is_dir() and p.name.startswith("run-")], key=lambda p: p.name)
        removed_count = 0
        while len(runs) > self.max_runs:
            run_dir = runs.pop(0)
            shutil.rmtree(run_dir, ignore_errors=True)
            removed_count += 1

        return {"removed_by_age": removed_age, "removed_by_count": removed_count}

    def latest_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        runs = sorted([p for p in self.root.iterdir() if p.is_dir() and p.name.startswith("run-")], key=lambda p: p.name, reverse=True)
        out: list[dict[str, Any]] = []
        for run_dir in runs[:limit]:
            metadata_path = run_dir / "metadata.json"
            if metadata_path.exists():
                try:
                    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
                except Exception:
                    payload = {"run_id": run_dir.name, "status": "unknown"}
            else:
                payload = {"run_id": run_dir.name, "status": "unknown"}
            payload["run_dir"] = str(run_dir)
            out.append(payload)
        return out

    def load_run_trace(self, run_id: str) -> dict[str, Any] | None:
        trace_path = self.root / run_id / "run_trace.json"
        if not trace_path.exists():
            return None
        try:
            payload = json.loads(trace_path.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else None
        except Exception:
            return None
