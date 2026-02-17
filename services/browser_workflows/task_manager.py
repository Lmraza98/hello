from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


logger = logging.getLogger(__name__)


def _env_int(name: str, default: int, *, minimum: int = 1, maximum: int = 10_000_000) -> int:
    try:
        value = int(os.getenv(name, str(default)) or str(default))
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


TASK_TTL_SECONDS = _env_int("BROWSER_WORKFLOW_TASK_TTL_SECONDS", 3600, minimum=60, maximum=7 * 24 * 3600)
TASK_MAX_RECORDS = _env_int("BROWSER_WORKFLOW_TASK_MAX_RECORDS", 1000, minimum=50, maximum=50_000)
TASK_MAX_CONCURRENT = _env_int("BROWSER_WORKFLOW_MAX_CONCURRENT_TASKS", 3, minimum=1, maximum=100)
TASK_MAX_CONCURRENT_PER_WEBSITE = _env_int("BROWSER_WORKFLOW_MAX_CONCURRENT_PER_WEBSITE", 1, minimum=1, maximum=20)
TASK_RETRY_ENABLED = (os.getenv("BROWSER_WORKFLOW_ASYNC_RETRY_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"})
TASK_RETRY_TIMEOUT_MS = _env_int("BROWSER_WORKFLOW_ASYNC_RETRY_TIMEOUT_MS", 30_000, minimum=1_000, maximum=600_000)
TASK_METRICS_ENABLED = (os.getenv("BROWSER_WORKFLOW_METRICS_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"})
TASK_METRICS_PATH = Path(os.getenv("BROWSER_WORKFLOW_METRICS_PATH", "data/logs/browser_workflow_tasks.jsonl"))
TASK_HEARTBEAT_INTERVAL_MS = _env_int("BROWSER_TASK_HEARTBEAT_INTERVAL_MS", 5000, minimum=500, maximum=120000)
TASK_HEARTBEAT_STALE_MS = _env_int("BROWSER_TASK_HEARTBEAT_STALE_MS", 30000, minimum=2000, maximum=600000)

TaskStatus = str


@dataclass
class WorkflowTask:
    task_id: str
    status: TaskStatus
    progress_pct: int = 0
    stage: str = "pending"
    diagnostics: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    heartbeat_at: float | None = None
    heartbeat_seq: int = 0

    def to_dict(self) -> dict[str, Any]:
        now = time.time()
        heartbeat_age_ms = None
        if self.heartbeat_at is not None:
            heartbeat_age_ms = int(max(0, now - self.heartbeat_at) * 1000)
        return {
            "task_id": self.task_id,
            "status": self.status,
            "progress_pct": self.progress_pct,
            "stage": self.stage,
            "diagnostics": self.diagnostics,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "heartbeat_at": self.heartbeat_at,
            "heartbeat_seq": self.heartbeat_seq,
            "heartbeat_age_ms": heartbeat_age_ms,
        }


ProgressFn = Callable[[int, str, dict[str, Any] | None], Awaitable[None]]
TaskCoroutineFactory = Callable[[ProgressFn], Awaitable[dict[str, Any]]]


class WorkflowTaskManager:
    def __init__(self) -> None:
        self._tasks: dict[str, WorkflowTask] = {}
        self._lock = asyncio.Lock()
        self._global_semaphore = asyncio.Semaphore(TASK_MAX_CONCURRENT)
        self._site_semaphores: dict[str, asyncio.Semaphore] = {}

    @staticmethod
    def _site_key_from_diagnostics(diagnostics: dict[str, Any] | None) -> str:
        if not isinstance(diagnostics, dict):
            return "default"
        explicit = str(diagnostics.get("website") or "").strip().lower()
        if explicit:
            return explicit
        task_name = str(diagnostics.get("task") or diagnostics.get("operation") or "").strip().lower()
        if "salesnav" in task_name or "linkedin" in task_name:
            return "linkedin.com"
        return "default"

    async def _get_site_semaphore(self, site_key: str) -> asyncio.Semaphore:
        key = (site_key or "default").strip().lower() or "default"
        async with self._lock:
            sem = self._site_semaphores.get(key)
            if sem is None:
                sem = asyncio.Semaphore(TASK_MAX_CONCURRENT_PER_WEBSITE)
                self._site_semaphores[key] = sem
            return sem

    async def _set_progress(self, task_id: str, pct: int, stage: str, diagnostics: dict[str, Any] | None = None) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.progress_pct = max(0, min(100, int(pct)))
            task.stage = str(stage or task.stage)
            if diagnostics:
                task.diagnostics.update(diagnostics)
            task.updated_at = time.time()
            task.heartbeat_at = task.updated_at

    async def start_inline(
        self,
        *,
        stage: str = "running",
        progress_pct: int = 5,
        diagnostics: dict[str, Any] | None = None,
    ) -> str:
        await self._cleanup()
        task_id = str(uuid.uuid4())
        now = time.time()
        row = WorkflowTask(
            task_id=task_id,
            status="running",
            progress_pct=max(0, min(100, int(progress_pct))),
            stage=str(stage or "running"),
            diagnostics=dict(diagnostics or {}),
            started_at=now,
            created_at=now,
            updated_at=now,
            heartbeat_at=now,
            heartbeat_seq=0,
        )
        async with self._lock:
            self._tasks[task_id] = row
        return task_id

    async def finish_inline(
        self,
        task_id: str,
        *,
        result: dict[str, Any] | None = None,
        stage: str = "finished",
        progress_pct: int = 100,
        diagnostics: dict[str, Any] | None = None,
    ) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.status = "finished"
            task.stage = str(stage or "finished")
            task.progress_pct = max(0, min(100, int(progress_pct)))
            if diagnostics:
                task.diagnostics.update(diagnostics)
            if result is not None:
                task.result = result if isinstance(result, dict) else {"result": result}
            task.updated_at = time.time()
            task.finished_at = time.time()
            task.heartbeat_at = task.updated_at
            await self._append_metric(task)

    async def fail_inline(
        self,
        task_id: str,
        *,
        code: str,
        message: str,
        retry_suggestion: str | None = None,
        stage: str = "failed",
        progress_pct: int = 100,
        diagnostics: dict[str, Any] | None = None,
    ) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.status = "failed"
            task.stage = str(stage or "failed")
            task.progress_pct = max(0, min(100, int(progress_pct)))
            if diagnostics:
                task.diagnostics.update(diagnostics)
            task.error = {
                "code": str(code or "task_failed"),
                "message": str(message or "Task failed."),
                **({"retry_suggestion": retry_suggestion} if retry_suggestion else {}),
            }
            task.updated_at = time.time()
            task.finished_at = time.time()
            task.heartbeat_at = task.updated_at
            await self._append_metric(task)

    async def _cleanup(self) -> None:
        async with self._lock:
            now = time.time()
            expired: list[str] = []
            for task_id, task in self._tasks.items():
                if task.status in {"pending", "running"} and task.heartbeat_at is not None:
                    if (now - task.heartbeat_at) * 1000 > TASK_HEARTBEAT_STALE_MS:
                        task.status = "failed"
                        task.stage = "heartbeat_stale"
                        task.error = {
                            "code": "workflow_stalled",
                            "message": "Task heartbeat became stale; marking task failed.",
                            "retry_suggestion": "Retry task. If this repeats, reduce scope (smaller limits) or run manually.",
                        }
                        task.updated_at = now
                        task.finished_at = now
                        await self._append_metric(task)
                if task.status in {"finished", "failed"} and task.finished_at is not None:
                    if (now - task.finished_at) > TASK_TTL_SECONDS:
                        expired.append(task_id)
            for task_id in expired:
                self._tasks.pop(task_id, None)

            if len(self._tasks) > TASK_MAX_RECORDS:
                oldest = sorted(self._tasks.values(), key=lambda x: x.updated_at)
                to_remove = len(self._tasks) - TASK_MAX_RECORDS
                for item in oldest[:to_remove]:
                    self._tasks.pop(item.task_id, None)

    async def _append_metric(self, task: WorkflowTask) -> None:
        if not TASK_METRICS_ENABLED:
            return
        duration_ms = None
        if task.started_at is not None and task.finished_at is not None:
            duration_ms = int((task.finished_at - task.started_at) * 1000)
        payload = {
            "task_id": task.task_id,
            "status": task.status,
            "stage": task.stage,
            "progress_pct": task.progress_pct,
            "duration_ms": duration_ms,
            "created_at": task.created_at,
            "started_at": task.started_at,
            "finished_at": task.finished_at,
            "diagnostics": task.diagnostics,
            "error_code": (task.error or {}).get("code") if isinstance(task.error, dict) else None,
        }
        try:
            TASK_METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
            with TASK_METRICS_PATH.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
        except Exception:
            logger.debug("task metrics append failed", exc_info=True)

    async def submit(
        self,
        *,
        coro_factory: TaskCoroutineFactory,
        timeout_ms: int,
        diagnostics: dict[str, Any] | None = None,
    ) -> str:
        await self._cleanup()
        task_id = str(uuid.uuid4())
        row = WorkflowTask(
            task_id=task_id,
            status="pending",
            progress_pct=0,
            stage="pending",
            diagnostics=dict(diagnostics or {}),
        )
        async with self._lock:
            self._tasks[task_id] = row

        async def _runner() -> None:
            site_key = self._site_key_from_diagnostics(diagnostics)
            await self._set_progress(task_id, 1, "queued", {"website": site_key})
            site_sem = await self._get_site_semaphore(site_key)

            stop_heartbeat = asyncio.Event()
            heartbeat_task: asyncio.Task | None = None
            await self._global_semaphore.acquire()
            await site_sem.acquire()
            try:
                await self._set_progress(task_id, 2, "running", {"website": site_key})
                async with self._lock:
                    task = self._tasks.get(task_id)
                    if task:
                        task.status = "running"
                        task.started_at = time.time()
                        task.updated_at = time.time()
                        task.heartbeat_at = task.updated_at
                        task.heartbeat_seq = 0

                heartbeat_task = asyncio.create_task(self._heartbeat_loop(task_id, stop_heartbeat, site_key))

                async def _progress(pct: int, stage: str, extra: dict[str, Any] | None = None) -> None:
                    merged = {"website": site_key}
                    if isinstance(extra, dict):
                        merged.update(extra)
                    await self._set_progress(task_id, pct, stage, merged)

                try:
                    result = await asyncio.wait_for(
                        coro_factory(_progress),
                        timeout=max(1000, int(timeout_ms)) / 1000.0,
                    )
                except Exception as first_exc:
                    task_row = await self.get(task_id)
                    pct = int((task_row or {}).get("progress_pct") or 0)
                    if TASK_RETRY_ENABLED and pct >= 50:
                        await self._set_progress(
                            task_id,
                            min(95, max(55, pct)),
                            "retry_short_sync",
                            {"retry_attempted": True},
                        )
                        result = await asyncio.wait_for(
                            coro_factory(_progress),
                            timeout=max(1000, int(TASK_RETRY_TIMEOUT_MS)) / 1000.0,
                        )
                    else:
                        raise first_exc

                async with self._lock:
                    task = self._tasks.get(task_id)
                    if not task:
                        return
                    task.status = "finished"
                    task.progress_pct = 100
                    task.stage = "finished"
                    task.result = result if isinstance(result, dict) else {"ok": True, "result": result}
                    task.updated_at = time.time()
                    task.finished_at = time.time()
                    await self._append_metric(task)
            except asyncio.TimeoutError:
                async with self._lock:
                    task = self._tasks.get(task_id)
                    if not task:
                        return
                    task.status = "failed"
                    task.stage = "failed"
                    task.error = {
                        "code": "workflow_timeout",
                        "message": f"Workflow timed out after {int(timeout_ms)}ms.",
                        "retry_suggestion": "Try again with fewer filters/lower limit or continue manually in the open browser tab.",
                    }
                    task.updated_at = time.time()
                    task.finished_at = time.time()
                    await self._append_metric(task)
            except Exception as exc:
                logger.exception("workflow task failed task_id=%s", task_id)
                async with self._lock:
                    task = self._tasks.get(task_id)
                    if not task:
                        return
                    task.status = "failed"
                    task.stage = "failed"
                    task.error = {
                        "code": "workflow_failed",
                        "message": str(exc),
                        "retry_suggestion": "Retry as a short task or continue manually in the open browser tab.",
                    }
                    task.updated_at = time.time()
                    task.finished_at = time.time()
                    await self._append_metric(task)
            finally:
                stop_heartbeat.set()
                if heartbeat_task is not None:
                    try:
                        await heartbeat_task
                    except Exception:
                        logger.debug("heartbeat task join failed", exc_info=True)
                site_sem.release()
                self._global_semaphore.release()

        asyncio.create_task(_runner())
        return task_id

    async def _heartbeat_loop(self, task_id: str, stop_event: asyncio.Event, site_key: str) -> None:
        interval_s = max(0.2, TASK_HEARTBEAT_INTERVAL_MS / 1000.0)
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval_s)
                break
            except asyncio.TimeoutError:
                pass
            async with self._lock:
                task = self._tasks.get(task_id)
                if not task:
                    return
                if task.status not in {"pending", "running"}:
                    return
                task.heartbeat_seq = int(task.heartbeat_seq or 0) + 1
                task.heartbeat_at = time.time()
                task.updated_at = task.heartbeat_at
                task.diagnostics.update({"website": site_key, "heartbeat_seq": task.heartbeat_seq})

    async def get(self, task_id: str) -> dict[str, Any] | None:
        await self._cleanup()
        async with self._lock:
            task = self._tasks.get(task_id)
            return task.to_dict() if task else None

    async def list(self, *, include_finished: bool = True, limit: int = 200) -> list[dict[str, Any]]:
        await self._cleanup()
        max_rows = max(1, min(2000, int(limit)))
        async with self._lock:
            rows = list(self._tasks.values())
            if not include_finished:
                rows = [r for r in rows if r.status in {"pending", "running"}]
            rows.sort(key=lambda r: r.updated_at, reverse=True)
            return [r.to_dict() for r in rows[:max_rows]]


workflow_task_manager = WorkflowTaskManager()
