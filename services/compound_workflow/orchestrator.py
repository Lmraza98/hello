from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import database
from services.browser_workflows import recipes


logger = logging.getLogger(__name__)


def _env_int(name: str, default: int, *, minimum: int = 1, maximum: int = 10_000_000) -> int:
    try:
        value = int(os.getenv(name, str(default)) or str(default))
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


WORKFLOW_HEARTBEAT_INTERVAL_MS = _env_int("COMPOUND_WORKFLOW_HEARTBEAT_INTERVAL_MS", 5000, minimum=500, maximum=120000)
WORKFLOW_HEARTBEAT_STALE_MS = _env_int("COMPOUND_WORKFLOW_HEARTBEAT_STALE_MS", 60000, minimum=2000, maximum=600000)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True)


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


@dataclass
class WorkflowContext:
    workflow_id: str
    spec: dict[str, Any]
    phase_results: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    cancelled: bool = False
    browser_calls: int = 0
    heartbeat_seq: int = 0
    heartbeat_stop: asyncio.Event | None = None


class WorkflowToolExecutionError(RuntimeError):
    def __init__(
        self,
        *,
        tool: str,
        task: str,
        code: str,
        message: str,
        detail: Any = None,
        result: Any = None,
    ) -> None:
        super().__init__(message)
        self.tool = tool
        self.task = task
        self.code = code
        self.detail = detail
        self.result = result

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": str(self),
            "tool": self.tool,
            "task": self.task,
        }
        if self.detail is not None:
            payload["detail"] = self.detail
        if isinstance(self.result, dict):
            payload["result"] = self.result
        return payload


class CompoundWorkflowOrchestrator:
    def __init__(self, db_conn: sqlite3.Connection | None = None) -> None:
        self.db = db_conn or database.get_connection()
        self.db.row_factory = sqlite3.Row
        self._active: dict[str, WorkflowContext] = {}
        self._lock = asyncio.Lock()
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        c = self.db.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS compound_workflows (
                id TEXT PRIMARY KEY,
                spec TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                current_phase_id TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                error TEXT,
                created_by TEXT,
                total_phases INTEGER NOT NULL,
                completed_phases INTEGER NOT NULL DEFAULT 0,
                total_items INTEGER NOT NULL DEFAULT 0,
                processed_items INTEGER NOT NULL DEFAULT 0,
                browser_calls_used INTEGER NOT NULL DEFAULT 0,
                api_calls_used INTEGER NOT NULL DEFAULT 0,
                estimated_remaining_minutes INTEGER,
                heartbeat_at TEXT,
                heartbeat_seq INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS compound_workflow_phases (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                phase_id TEXT NOT NULL,
                phase_index INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                started_at TEXT,
                completed_at TEXT,
                input_count INTEGER NOT NULL DEFAULT 0,
                output_count INTEGER NOT NULL DEFAULT 0,
                results TEXT,
                iteration_total INTEGER,
                iteration_completed INTEGER NOT NULL DEFAULT 0,
                iteration_failed INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (workflow_id) REFERENCES compound_workflows(id)
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS compound_workflow_items (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                phase_id TEXT NOT NULL,
                item_index INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                input_data TEXT NOT NULL,
                output_data TEXT,
                started_at TEXT,
                completed_at TEXT,
                browser_tab_id TEXT,
                error TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (workflow_id) REFERENCES compound_workflows(id)
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS compound_workflow_events (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (workflow_id) REFERENCES compound_workflows(id)
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_compound_workflows_status ON compound_workflows(status)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_compound_workflow_phases_workflow ON compound_workflow_phases(workflow_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_compound_workflow_items_phase ON compound_workflow_items(workflow_id, phase_id, status)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_compound_workflow_events_workflow ON compound_workflow_events(workflow_id, created_at)")
        self._ensure_column("compound_workflows", "heartbeat_at", "TEXT")
        self._ensure_column("compound_workflows", "heartbeat_seq", "INTEGER NOT NULL DEFAULT 0")
        self.db.commit()

    def _ensure_column(self, table: str, column: str, ddl_type: str) -> None:
        rows = self.db.execute(f"PRAGMA table_info({table})").fetchall()
        names = {str(r[1]) for r in rows}
        if column in names:
            return
        self.db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}")

    def _emit_event(self, workflow_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.db.execute(
            """
            INSERT INTO compound_workflow_events (id, workflow_id, event_type, payload, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), workflow_id, event_type, _json_dumps(payload), _utcnow_iso()),
        )
        self.db.commit()

    async def create_workflow(self, spec: dict[str, Any], user_id: str | None = None) -> str:
        workflow_id = str(spec.get("id") or uuid.uuid4())
        phases = list(spec.get("phases") or [])
        now = _utcnow_iso()
        self.db.execute(
            """
            INSERT INTO compound_workflows (id, spec, status, created_at, created_by, total_phases)
            VALUES (?, ?, 'pending', ?, ?, ?)
            """,
            (workflow_id, _json_dumps({**spec, "id": workflow_id}), now, user_id, len(phases)),
        )
        for idx, phase in enumerate(phases):
            phase_id = str(phase.get("id") or f"phase_{idx+1}")
            self.db.execute(
                """
                INSERT INTO compound_workflow_phases (id, workflow_id, phase_id, phase_index, status)
                VALUES (?, ?, ?, ?, 'pending')
                """,
                (f"{workflow_id}_{phase_id}", workflow_id, phase_id, idx),
            )
        self.db.commit()
        self._emit_event(workflow_id, "created", {"workflow_id": workflow_id, "phase_count": len(phases)})
        return workflow_id

    async def start_workflow(self, workflow_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT spec, status FROM compound_workflows WHERE id = ?", (workflow_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "workflow_not_found"}
        status = str(row["status"] or "")
        if status == "running":
            return {"ok": False, "error": "workflow_already_running"}
        if status in {"completed", "cancelled"}:
            return {"ok": False, "error": f"workflow_{status}"}
        spec = _json_loads(row["spec"], {})
        ctx = WorkflowContext(workflow_id=workflow_id, spec=spec)
        async with self._lock:
            self._active[workflow_id] = ctx
        self.db.execute(
            "UPDATE compound_workflows SET status='running', started_at=?, completed_at=NULL, error=NULL WHERE id=?",
            (_utcnow_iso(), workflow_id),
        )
        self.db.commit()
        self._emit_event(workflow_id, "started", {"workflow_id": workflow_id})
        asyncio.create_task(self._execute_workflow(ctx))
        return {"ok": True, "workflow_id": workflow_id, "status": "running"}

    async def continue_workflow(self, workflow_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT status FROM compound_workflows WHERE id = ?", (workflow_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "workflow_not_found"}
        if str(row["status"]) != "paused":
            return {"ok": False, "error": "workflow_not_paused"}
        self._emit_event(workflow_id, "continued", {"workflow_id": workflow_id})
        return await self.start_workflow(workflow_id)

    async def cancel_workflow(self, workflow_id: str) -> dict[str, Any]:
        async with self._lock:
            ctx = self._active.get(workflow_id)
            if ctx:
                ctx.cancelled = True
        self.db.execute(
            "UPDATE compound_workflows SET status='cancelled', completed_at=? WHERE id=?",
            (_utcnow_iso(), workflow_id),
        )
        self.db.commit()
        self._emit_event(workflow_id, "cancelled", {"workflow_id": workflow_id})
        return {"ok": True, "workflow_id": workflow_id, "status": "cancelled"}

    async def _execute_workflow(self, ctx: WorkflowContext) -> None:
        heartbeat_stop = asyncio.Event()
        ctx.heartbeat_stop = heartbeat_stop
        heartbeat_task = asyncio.create_task(self._heartbeat_loop(ctx))
        try:
            phases = list(ctx.spec.get("phases") or [])
            # Reload completed phase results for resumes.
            phase_rows = self.db.execute(
                "SELECT phase_id, results FROM compound_workflow_phases WHERE workflow_id = ? AND status = 'completed'",
                (ctx.workflow_id,),
            ).fetchall()
            for row in phase_rows:
                ctx.phase_results[str(row["phase_id"])] = _json_loads(row["results"], [])

            for phase in phases:
                if ctx.cancelled:
                    return
                phase_id = str(phase.get("id") or "")
                if not phase_id:
                    continue
                depends_on = list(phase.get("depends_on") or [])
                if depends_on:
                    missing = [dep for dep in depends_on if dep not in ctx.phase_results]
                    if missing:
                        raise RuntimeError(f"phase_dependency_missing:{phase_id}:{','.join(missing)}")
                # Skip already-completed phases on resume.
                existing = self.db.execute(
                    "SELECT status FROM compound_workflow_phases WHERE workflow_id=? AND phase_id=?",
                    (ctx.workflow_id, phase_id),
                ).fetchone()
                if existing and str(existing["status"]) == "completed":
                    continue
                await self._execute_phase(ctx, phase)
                checkpoint = phase.get("checkpoint") or {}
                if bool(checkpoint.get("enabled")):
                    count = len(ctx.phase_results.get(phase_id) or [])
                    auto = str(checkpoint.get("auto_continue_if") or "").strip()
                    should_pause = True
                    if auto:
                        try:
                            should_pause = not bool(eval(auto, {"__builtins__": {}}, {"count": count}))
                        except Exception:
                            should_pause = True
                    if should_pause:
                        msg = str(checkpoint.get("message") or "Continue?").replace("{{count}}", str(count))
                        self.db.execute(
                            "UPDATE compound_workflows SET status='paused', current_phase_id=? WHERE id=?",
                            (phase_id, ctx.workflow_id),
                        )
                        self.db.commit()
                        self._emit_event(
                            ctx.workflow_id,
                            "checkpoint",
                            {
                                "workflow_id": ctx.workflow_id,
                                "phase_id": phase_id,
                                "message": msg,
                                "result_count": count,
                                "results_preview": (ctx.phase_results.get(phase_id) or [])[:5],
                                "actions": ["continue", "cancel"],
                            },
                        )
                        async with self._lock:
                            self._active.pop(ctx.workflow_id, None)
                        return

            self.db.execute(
                """
                UPDATE compound_workflows
                SET status='completed', completed_at=?, current_phase_id=NULL,
                    total_items=?, processed_items=?, browser_calls_used=?
                WHERE id=?
                """,
                (
                    _utcnow_iso(),
                    len((ctx.phase_results.get((phases[-1] or {}).get("id", "")) or []) if phases else []),
                    len((ctx.phase_results.get((phases[-1] or {}).get("id", "")) or []) if phases else []),
                    ctx.browser_calls,
                    ctx.workflow_id,
                ),
            )
            self.db.commit()
            final_phase_id = str((phases[-1] or {}).get("id") if phases else "")
            self._emit_event(
                ctx.workflow_id,
                "completed",
                {
                    "workflow_id": ctx.workflow_id,
                    "total_results": len(ctx.phase_results.get(final_phase_id) or []),
                    "results": ctx.phase_results.get(final_phase_id) or [],
                    "browser_calls_used": ctx.browser_calls,
                },
            )
        except Exception as exc:
            logger.exception("compound workflow failed workflow_id=%s", ctx.workflow_id)
            error_payload = {"message": str(exc)}
            if isinstance(exc, WorkflowToolExecutionError):
                error_payload = exc.to_payload()
            self.db.execute(
                "UPDATE compound_workflows SET status='failed', completed_at=?, error=? WHERE id=?",
                (_utcnow_iso(), _json_dumps(error_payload), ctx.workflow_id),
            )
            self.db.commit()
            self._emit_event(ctx.workflow_id, "failed", {"workflow_id": ctx.workflow_id, "error": error_payload})
        finally:
            heartbeat_stop.set()
            try:
                await heartbeat_task
            except Exception:
                logger.debug("compound workflow heartbeat loop join failed", exc_info=True)
            async with self._lock:
                self._active.pop(ctx.workflow_id, None)

    async def _heartbeat_loop(self, ctx: WorkflowContext) -> None:
        interval_s = max(0.2, WORKFLOW_HEARTBEAT_INTERVAL_MS / 1000.0)
        while not (ctx.heartbeat_stop and ctx.heartbeat_stop.is_set()):
            try:
                await asyncio.wait_for(ctx.heartbeat_stop.wait(), timeout=interval_s)
                break
            except asyncio.TimeoutError:
                pass
            ctx.heartbeat_seq = int(ctx.heartbeat_seq or 0) + 1
            now_iso = _utcnow_iso()
            self.db.execute(
                "UPDATE compound_workflows SET heartbeat_at=?, heartbeat_seq=? WHERE id=?",
                (now_iso, ctx.heartbeat_seq, ctx.workflow_id),
            )
            self.db.commit()
            self._emit_event(
                ctx.workflow_id,
                "heartbeat",
                {"workflow_id": ctx.workflow_id, "heartbeat_seq": ctx.heartbeat_seq},
            )

    async def _execute_phase(self, ctx: WorkflowContext, phase: dict[str, Any]) -> None:
        phase_id = str(phase.get("id") or "")
        phase_name = str(phase.get("name") or phase_id)
        self.db.execute(
            "UPDATE compound_workflow_phases SET status='running', started_at=? WHERE workflow_id=? AND phase_id=?",
            (_utcnow_iso(), ctx.workflow_id, phase_id),
        )
        self.db.execute(
            "UPDATE compound_workflows SET current_phase_id=? WHERE id=?",
            (phase_id, ctx.workflow_id),
        )
        self.db.commit()
        self._emit_event(
            ctx.workflow_id,
            "phase_started",
            {"workflow_id": ctx.workflow_id, "phase_id": phase_id, "phase_name": phase_name, "phase_type": phase.get("type")},
        )

        if phase.get("type") == "aggregate":
            results = await self._execute_aggregate_phase(ctx, phase)
        elif isinstance(phase.get("iteration"), dict):
            results = await self._execute_iteration_phase(ctx, phase)
        elif phase.get("type") == "filter":
            source = str((phase.get("depends_on") or [""])[0] or "")
            base = list(ctx.phase_results.get(source) or [])
            results = self._apply_post_process(base, phase.get("post_process") or {})
        else:
            results = await self._execute_single_phase(ctx, phase)

        self.db.execute(
            """
            UPDATE compound_workflow_phases
            SET status='completed', completed_at=?, output_count=?, results=?
            WHERE workflow_id=? AND phase_id=?
            """,
            (_utcnow_iso(), len(results), _json_dumps(results), ctx.workflow_id, phase_id),
        )
        self.db.execute(
            """
            UPDATE compound_workflows
            SET completed_phases=(SELECT COUNT(*) FROM compound_workflow_phases WHERE workflow_id=? AND status='completed'),
                browser_calls_used=?
            WHERE id=?
            """,
            (ctx.workflow_id, ctx.browser_calls, ctx.workflow_id),
        )
        self.db.commit()
        ctx.phase_results[phase_id] = results
        self._emit_event(
            ctx.workflow_id,
            "phase_completed",
            {"workflow_id": ctx.workflow_id, "phase_id": phase_id, "result_count": len(results)},
        )

    async def _execute_single_phase(self, ctx: WorkflowContext, phase: dict[str, Any]) -> list[dict[str, Any]]:
        operation = dict(phase.get("operation") or {})
        tool = str(operation.get("tool") or "")
        task = str(operation.get("task") or "")
        params = dict(operation.get("base_params") or {})
        for key, value in dict(phase.get("param_templates") or {}).items():
            params[key] = value
        result = await self._call_browser_tool(ctx, tool, task, params)
        items = list((result or {}).get("items") or [])
        return self._apply_post_process(items, phase.get("post_process") or {})

    async def _execute_iteration_phase(self, ctx: WorkflowContext, phase: dict[str, Any]) -> list[dict[str, Any]]:
        iteration = dict(phase.get("iteration") or {})
        source_ref = str(iteration.get("over") or "")
        source_phase = source_ref.split(".", 1)[0] if source_ref else ""
        item_var = str(iteration.get("as") or "item")
        max_items = max(1, int(iteration.get("max_items") or 50))
        concurrency = max(1, int(iteration.get("concurrency") or 3))
        source_items = list(ctx.phase_results.get(source_phase) or [])[:max_items]

        self.db.execute(
            """
            UPDATE compound_workflow_phases
            SET input_count=?, iteration_total=?, iteration_completed=0, iteration_failed=0
            WHERE workflow_id=? AND phase_id=?
            """,
            (len(source_items), len(source_items), ctx.workflow_id, str(phase.get("id") or "")),
        )
        self.db.commit()
        self._emit_event(
            ctx.workflow_id,
            "iteration_started",
            {
                "workflow_id": ctx.workflow_id,
                "phase_id": str(phase.get("id") or ""),
                "total_items": len(source_items),
                "concurrency": concurrency,
            },
        )

        sem = asyncio.Semaphore(concurrency)
        phase_id = str(phase.get("id") or "")

        async def _run_item(idx: int, source_item: dict[str, Any]) -> list[dict[str, Any]]:
            item_id = str(uuid.uuid4())
            self.db.execute(
                """
                INSERT INTO compound_workflow_items
                (id, workflow_id, phase_id, item_index, status, input_data, started_at)
                VALUES (?, ?, ?, ?, 'running', ?, ?)
                """,
                (item_id, ctx.workflow_id, phase_id, idx, _json_dumps(source_item), _utcnow_iso()),
            )
            self.db.commit()
            async with sem:
                try:
                    if ctx.cancelled:
                        return []
                    operation = dict(phase.get("operation") or {})
                    tool = str(operation.get("tool") or "")
                    task = str(operation.get("task") or "")
                    params = dict(operation.get("base_params") or {})
                    for key, template in dict(phase.get("param_templates") or {}).items():
                        params[key] = self._substitute_template(template, {item_var: source_item})
                    out = await self._call_browser_tool(ctx, tool, task, params)
                    items = list((out or {}).get("items") or [])
                    for row in items:
                        if isinstance(row, dict):
                            row["_source_item"] = source_item
                    self.db.execute(
                        """
                        UPDATE compound_workflow_items
                        SET status='completed', output_data=?, completed_at=?
                        WHERE id=?
                        """,
                        (_json_dumps(items), _utcnow_iso(), item_id),
                    )
                    self.db.execute(
                        """
                        UPDATE compound_workflow_phases
                        SET iteration_completed=iteration_completed+1
                        WHERE workflow_id=? AND phase_id=?
                        """,
                        (ctx.workflow_id, phase_id),
                    )
                    self.db.commit()
                    self._emit_event(
                        ctx.workflow_id,
                        "item_completed",
                        {
                            "workflow_id": ctx.workflow_id,
                            "phase_id": phase_id,
                            "item_index": idx,
                            "total_items": len(source_items),
                        },
                    )
                    return items
                except Exception as exc:
                    self.db.execute(
                        """
                        UPDATE compound_workflow_items
                        SET status='failed', error=?, completed_at=?
                        WHERE id=?
                        """,
                        (_json_dumps({"message": str(exc)}), _utcnow_iso(), item_id),
                    )
                    self.db.execute(
                        """
                        UPDATE compound_workflow_phases
                        SET iteration_failed=iteration_failed+1
                        WHERE workflow_id=? AND phase_id=?
                        """,
                        (ctx.workflow_id, phase_id),
                    )
                    self.db.commit()
                    logger.warning("compound workflow item failed workflow_id=%s phase=%s idx=%s err=%s", ctx.workflow_id, phase_id, idx, exc)
                    return []

        rows = await asyncio.gather(*[_run_item(i, item) for i, item in enumerate(source_items)])
        combined: list[dict[str, Any]] = []
        for bucket in rows:
            combined.extend(bucket or [])
        return self._apply_post_process(combined, phase.get("post_process") or {})

    async def _execute_aggregate_phase(self, ctx: WorkflowContext, phase: dict[str, Any]) -> list[dict[str, Any]]:
        phase_depends = list(phase.get("depends_on") or [])
        if phase_depends:
            base = list(ctx.phase_results.get(phase_depends[-1]) or [])
        else:
            phase_order = list(ctx.spec.get("phases") or [])
            last_non_agg = ""
            for row in reversed(phase_order):
                if str(row.get("type") or "") != "aggregate":
                    last_non_agg = str(row.get("id") or "")
                    break
            base = list(ctx.phase_results.get(last_non_agg) or [])
        templates = dict(phase.get("param_templates") or {})
        rank_by = str(templates.get("rank_by") or "")
        if rank_by:
            def _get(row: Any, path: str) -> Any:
                current = row
                for part in path.split("."):
                    if isinstance(current, dict):
                        current = current.get(part)
                    else:
                        return 0
                if isinstance(current, list):
                    return len(current)
                return current or 0
            base = sorted(base, key=lambda x: _get(x, rank_by), reverse=True)
        limit = int(templates.get("limit") or phase.get("post_process", {}).get("limit") or 10)
        return base[: max(1, limit)]

    async def _call_browser_tool(self, ctx: WorkflowContext, tool: str, task: str, params: dict[str, Any]) -> dict[str, Any]:
        ctx.browser_calls += 1
        if tool == "browser_search_and_extract":
            out = await recipes.search_and_extract(
                task=task,
                query=str(params.get("query") or ""),
                filter_values=params.get("filter_values") or params.get("filters"),
                click_target=params.get("click_target"),
                extract_type=params.get("extract_type"),
                tab_id=params.get("tab_id"),
                limit=int(params.get("limit") or 25),
                wait_ms=int(params.get("wait_ms") or 1500),
                progress_cb=None,
            )
            return self._validate_browser_tool_result(tool=tool, task=task, out=out)
        if tool == "browser_list_sub_items":
            out = await recipes.list_sub_items(
                task=task,
                tab_id=params.get("tab_id"),
                parent_query=params.get("parent_query"),
                parent_task=params.get("parent_task"),
                parent_filter_values=params.get("parent_filter_values") or params.get("parent_filters"),
                entrypoint_action=str(params.get("entrypoint_action") or "entrypoint"),
                extract_type=str(params.get("extract_type") or "lead"),
                limit=int(params.get("limit") or 100),
                wait_ms=int(params.get("wait_ms") or 1200),
                progress_cb=None,
            )
            return self._validate_browser_tool_result(tool=tool, task=task, out=out)
        raise ValueError(f"unknown_workflow_tool:{tool}")

    def _validate_browser_tool_result(self, *, tool: str, task: str, out: Any) -> dict[str, Any]:
        if not isinstance(out, dict):
            raise WorkflowToolExecutionError(
                tool=tool,
                task=task,
                code="invalid_tool_response",
                message="Browser tool returned a non-dict response.",
                result={"raw_type": type(out).__name__},
            )
        if out.get("ok") is False or bool(out.get("error")):
            error_obj = out.get("error")
            code = "browser_tool_failed"
            message = "Browser tool execution failed."
            detail = None
            if isinstance(error_obj, dict):
                if isinstance(error_obj.get("code"), str) and error_obj.get("code"):
                    code = str(error_obj["code"])
                if isinstance(error_obj.get("message"), str) and error_obj.get("message"):
                    message = str(error_obj["message"])
                detail = error_obj
            elif isinstance(error_obj, str) and error_obj.strip():
                message = error_obj.strip()
                detail = {"message": message}
            elif isinstance(out.get("message"), str) and str(out.get("message")).strip():
                message = str(out.get("message")).strip()
                detail = {"message": message}
            raise WorkflowToolExecutionError(
                tool=tool,
                task=task,
                code=code,
                message=message,
                detail=detail,
                result=out,
            )
        return out

    def _substitute_template(self, template: Any, context: dict[str, Any]) -> Any:
        if isinstance(template, dict):
            return {k: self._substitute_template(v, context) for k, v in template.items()}
        if isinstance(template, list):
            return [self._substitute_template(v, context) for v in template]
        if not isinstance(template, str):
            return template
        pattern = re.compile(r"\{\{([^}]+)\}\}")

        def _resolve(path: str) -> str:
            current: Any = context
            for part in path.split("."):
                part = part.strip()
                if isinstance(current, dict):
                    current = current.get(part)
                else:
                    return ""
            return str(current) if current is not None else ""

        return pattern.sub(lambda m: _resolve(m.group(1).strip()), template)

    def _apply_post_process(self, items: list[dict[str, Any]], post_process: dict[str, Any]) -> list[dict[str, Any]]:
        out = list(items)
        if not post_process:
            return out
        filt = post_process.get("filter")
        if isinstance(filt, str) and filt.strip():
            filtered: list[dict[str, Any]] = []
            for row in out:
                try:
                    keep = bool(eval(filt, {"__builtins__": {}}, {"result": row}))
                except Exception:
                    keep = True
                if keep:
                    filtered.append(row)
            out = filtered
        sort_by = post_process.get("sort_by")
        if isinstance(sort_by, str) and sort_by.strip():
            out = sorted(out, key=lambda x: x.get(sort_by, ""), reverse=True)
        limit = post_process.get("limit")
        if isinstance(limit, int) and limit > 0:
            out = out[:limit]
        return out

    def get_workflow_status(self, workflow_id: str) -> dict[str, Any] | None:
        self._mark_stale_workflows()
        row = self.db.execute(
            """
            SELECT cw.*, (
                SELECT COUNT(*) FROM compound_workflow_phases cwp
                WHERE cwp.workflow_id = cw.id AND cwp.status = 'completed'
            ) AS phases_done
            FROM compound_workflows cw
            WHERE cw.id = ?
            """,
            (workflow_id,),
        ).fetchone()
        if not row:
            return None
        events = self.db.execute(
            """
            SELECT event_type, payload, created_at
            FROM compound_workflow_events
            WHERE workflow_id = ?
            ORDER BY created_at DESC
            LIMIT 200
            """,
            (workflow_id,),
        ).fetchall()
        return {
            "id": row["id"],
            "status": row["status"],
            "current_phase_id": row["current_phase_id"],
            "name": _json_loads(row["spec"], {}).get("name"),
            "description": _json_loads(row["spec"], {}).get("description"),
            "original_query": _json_loads(row["spec"], {}).get("original_query"),
            "total_phases": int(row["total_phases"] or 0),
            "completed_phases": int(row["phases_done"] or 0),
            "browser_calls_used": int(row["browser_calls_used"] or 0),
            "created_at": row["created_at"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
            "heartbeat_at": row["heartbeat_at"],
            "heartbeat_seq": int(row["heartbeat_seq"] or 0),
            "heartbeat_age_ms": self._heartbeat_age_ms(row["heartbeat_at"]),
            "error": _json_loads(row["error"], None),
            "events": [
                {
                    "type": str(ev["event_type"]),
                    "payload": _json_loads(ev["payload"], {}),
                    "timestamp": ev["created_at"],
                }
                for ev in events
            ],
        }

    def list_workflows(self, *, limit: int = 50, status: str | None = None) -> list[dict[str, Any]]:
        self._mark_stale_workflows()
        max_rows = max(1, min(500, int(limit)))
        if status:
            rows = self.db.execute(
                """
                SELECT id, status, current_phase_id, total_phases, completed_phases, browser_calls_used, created_at, started_at, completed_at, error, spec, heartbeat_at, heartbeat_seq
                FROM compound_workflows
                WHERE status = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (status, max_rows),
            ).fetchall()
        else:
            rows = self.db.execute(
                """
                SELECT id, status, current_phase_id, total_phases, completed_phases, browser_calls_used, created_at, started_at, completed_at, error, spec, heartbeat_at, heartbeat_seq
                FROM compound_workflows
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (max_rows,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "status": row["status"],
                "name": _json_loads(row["spec"], {}).get("name"),
                "description": _json_loads(row["spec"], {}).get("description"),
                "original_query": _json_loads(row["spec"], {}).get("original_query"),
                "current_phase_id": row["current_phase_id"],
                "total_phases": int(row["total_phases"] or 0),
                "completed_phases": int(row["completed_phases"] or 0),
                "browser_calls_used": int(row["browser_calls_used"] or 0),
                "created_at": row["created_at"],
                "started_at": row["started_at"],
                "completed_at": row["completed_at"],
                "heartbeat_at": row["heartbeat_at"],
                "heartbeat_seq": int(row["heartbeat_seq"] or 0),
                "heartbeat_age_ms": self._heartbeat_age_ms(row["heartbeat_at"]),
                "error": _json_loads(row["error"], None),
            }
            for row in rows
        ]

    def _heartbeat_age_ms(self, heartbeat_at: str | None) -> int | None:
        if not heartbeat_at:
            return None
        try:
            then = datetime.fromisoformat(str(heartbeat_at))
            if then.tzinfo is None:
                then = then.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            return int(max(0, (now - then).total_seconds() * 1000))
        except Exception:
            return None

    def _mark_stale_workflows(self) -> None:
        rows = self.db.execute(
            """
            SELECT id, heartbeat_at
            FROM compound_workflows
            WHERE status='running'
            """
        ).fetchall()
        for row in rows:
            heartbeat_at = row["heartbeat_at"]
            age = self._heartbeat_age_ms(heartbeat_at)
            if age is None:
                continue
            if age <= WORKFLOW_HEARTBEAT_STALE_MS:
                continue
            self.db.execute(
                """
                UPDATE compound_workflows
                SET status='failed', completed_at=?, error=?
                WHERE id=?
                """,
                (
                    _utcnow_iso(),
                    _json_dumps(
                        {
                            "code": "workflow_stalled",
                            "message": "Workflow heartbeat became stale; workflow marked failed.",
                            "retry_suggestion": "Retry the workflow with lower limits/concurrency.",
                        }
                    ),
                    row["id"],
                ),
            )
            self._emit_event(
                row["id"],
                "failed",
                {
                    "workflow_id": row["id"],
                    "error": "workflow_stalled",
                },
            )
        self.db.commit()


_ORCHESTRATOR: CompoundWorkflowOrchestrator | None = None


def get_orchestrator() -> CompoundWorkflowOrchestrator:
    global _ORCHESTRATOR
    if _ORCHESTRATOR is None:
        _ORCHESTRATOR = CompoundWorkflowOrchestrator()
    return _ORCHESTRATOR
