from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from services.langgraph import state_store
from services.langgraph.graphs.contacts_enrichment import build_contacts_enrichment_graph
from services.langgraph.graphs.lead_research import build_lead_research_graph

logger = logging.getLogger(__name__)


GraphBuilder = Callable[[], Any]


GRAPH_REGISTRY: dict[str, GraphBuilder] = {
    "contacts_enrichment": build_contacts_enrichment_graph,
    "lead_research": build_lead_research_graph,
}


class LangGraphEngine:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    def create_run(self, graph_id: str, input_payload: dict[str, Any]) -> str:
        if graph_id not in GRAPH_REGISTRY:
            raise ValueError(f"unknown_graph:{graph_id}")
        run_id = state_store.create_run(graph_id, input_payload)
        state_store.append_event(run_id, "created", {"graph_id": graph_id})
        return run_id

    async def start_run(self, run_id: str) -> dict[str, Any]:
        run = state_store.get_run(run_id)
        if not run:
            return {"ok": False, "error": "run_not_found"}
        if run["status"] == "running":
            return {"ok": False, "error": "run_already_running"}
        if run["status"] in {"completed", "cancelled"}:
            return {"ok": False, "error": f"run_{run['status']}"}
        async with self._lock:
            if run_id in self._tasks and not self._tasks[run_id].done():
                return {"ok": False, "error": "run_already_running"}
            task = asyncio.create_task(self._run_graph(run_id, run["graph_id"], run["input"]))
            self._tasks[run_id] = task
        return {"ok": True, "status": "running"}

    async def continue_run(self, run_id: str) -> dict[str, Any]:
        run = state_store.get_run(run_id)
        if not run:
            return {"ok": False, "error": "run_not_found"}
        if run["status"] not in {"paused", "failed"}:
            return {"ok": False, "error": "run_not_resumable"}
        checkpoint = state_store.get_latest_checkpoint(run_id)
        resume_state = checkpoint["state"] if checkpoint else None
        async with self._lock:
            if run_id in self._tasks and not self._tasks[run_id].done():
                return {"ok": False, "error": "run_already_running"}
            task = asyncio.create_task(
                self._run_graph(run_id, run["graph_id"], run["input"], resume_state=resume_state)
            )
            self._tasks[run_id] = task
        return {"ok": True, "status": "running"}

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        async with self._lock:
            task = self._tasks.get(run_id)
            if task and not task.done():
                task.cancel()
                state_store.update_run_status(run_id, "cancelled", completed_at=state_store.utcnow_iso())
                state_store.append_event(run_id, "cancelled", {"run_id": run_id})
                return {"ok": True, "status": "cancelled"}
        return {"ok": False, "error": "run_not_running"}

    async def _run_graph(
        self,
        run_id: str,
        graph_id: str,
        input_payload: dict[str, Any],
        *,
        resume_state: dict[str, Any] | None = None,
    ) -> None:
        builder = GRAPH_REGISTRY[graph_id]
        graph = builder()
        state_store.update_run_status(run_id, "running", started_at=state_store.utcnow_iso())
        state_store.append_event(run_id, "started", {"run_id": run_id, "graph_id": graph_id})

        start_state = resume_state or {"input": {**input_payload, "run_id": run_id}, "progress": {}, "results": {}}
        last_state: dict[str, Any] | None = None
        step_index = 0

        try:
            async for update in graph.astream(start_state, stream_mode="values"):
                last_state = update
                step_index += 1
                state_store.save_checkpoint(run_id, f"step_{step_index}", update)
                progress = update.get("progress") if isinstance(update, dict) else None
                if progress:
                    state_store.append_event(run_id, "progress", {"step": step_index, "progress": progress})
            if last_state is None:
                last_state = await graph.ainvoke(start_state)

            output = last_state.get("results") if isinstance(last_state, dict) else {}
            state_store.update_run_status(
                run_id,
                "completed",
                completed_at=state_store.utcnow_iso(),
                output=output,
            )
            state_store.append_event(run_id, "completed", {"run_id": run_id, "output": output})
        except asyncio.CancelledError:
            state_store.update_run_status(run_id, "cancelled", completed_at=state_store.utcnow_iso())
            state_store.append_event(run_id, "cancelled", {"run_id": run_id})
            raise
        except Exception as exc:
            logger.exception("LangGraph run failed run_id=%s", run_id)
            error_payload = {"message": str(exc)}
            state_store.update_run_status(
                run_id,
                "failed",
                completed_at=state_store.utcnow_iso(),
                error=error_payload,
            )
            state_store.append_event(run_id, "failed", {"run_id": run_id, "error": error_payload})


_engine: LangGraphEngine | None = None


def get_engine() -> LangGraphEngine:
    global _engine
    if _engine is None:
        _engine = LangGraphEngine()
    return _engine
