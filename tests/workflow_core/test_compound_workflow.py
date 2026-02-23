import asyncio
import sqlite3

from services.orchestration.compound.orchestrator import CompoundWorkflowOrchestrator


def _run(coro):
    return asyncio.run(coro)


async def _wait_until(orchestrator: CompoundWorkflowOrchestrator, workflow_id: str, statuses: set[str], timeout_s: float = 2.0):
    steps = int(timeout_s / 0.02)
    for _ in range(max(1, steps)):
        row = orchestrator.get_workflow_status(workflow_id)
        if row and str(row.get("status")) in statuses:
            return row
        await asyncio.sleep(0.02)
    return orchestrator.get_workflow_status(workflow_id)


def test_compound_workflow_create_start_complete(monkeypatch):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    orchestrator = CompoundWorkflowOrchestrator(db_conn=conn)

    async def fake_search_and_extract(**_kwargs):
        await asyncio.sleep(0.01)
        return {"ok": True, "items": [{"name": "Acme", "score": 3}]}

    monkeypatch.setattr("services.orchestration.compound.orchestrator.recipes.search_and_extract", fake_search_and_extract)

    spec = {
        "name": "test",
        "phases": [
            {
                "id": "p1",
                "name": "search",
                "type": "search",
                "operation": {
                    "tool": "browser_search_and_extract",
                    "task": "salesnav_search_account",
                    "base_params": {"limit": 5},
                },
                "param_templates": {"query": "industrial machinery"},
            },
            {
                "id": "p2",
                "name": "aggregate",
                "type": "aggregate",
                "operation": {"tool": "internal_aggregate", "task": "join_and_rank"},
                "param_templates": {"limit": 1},
                "depends_on": ["p1"],
            },
        ],
    }

    async def _scenario():
        workflow_id = await orchestrator.create_workflow(spec)
        started = await orchestrator.start_workflow(workflow_id)
        assert started["ok"] is True
        done = await _wait_until(orchestrator, workflow_id, {"completed", "failed"})
        assert done is not None
        assert done["status"] == "completed"
        assert int(done["completed_phases"]) == 2

    _run(_scenario())


def test_compound_workflow_checkpoint_continue(monkeypatch):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    orchestrator = CompoundWorkflowOrchestrator(db_conn=conn)

    async def fake_search_and_extract(**kwargs):
        query = str(kwargs.get("query") or "")
        if "VP of Operations" in query:
            return {"ok": True, "items": [{"name": "Jane VP", "title": "VP of Operations"}]}
        return {"ok": True, "items": [{"name": "Acme"}]}

    monkeypatch.setattr("services.orchestration.compound.orchestrator.recipes.search_and_extract", fake_search_and_extract)

    spec = {
        "name": "checkpoint",
        "phases": [
            {
                "id": "p1",
                "name": "search",
                "type": "search",
                "operation": {"tool": "browser_search_and_extract", "task": "salesnav_search_account", "base_params": {}},
                "param_templates": {"query": "industrial machinery"},
                "checkpoint": {"enabled": True, "message": "Found {{count}}. Continue?", "auto_continue_if": "count <= 0"},
            },
            {
                "id": "p2",
                "name": "enrich",
                "type": "enrich",
                "operation": {"tool": "browser_search_and_extract", "task": "salesnav_people_search", "base_params": {}},
                "iteration": {"over": "p1.results", "as": "company", "max_items": 5, "concurrency": 1},
                "param_templates": {"query": "VP of Operations at {{company.name}}"},
                "depends_on": ["p1"],
            },
        ],
    }

    async def _scenario():
        workflow_id = await orchestrator.create_workflow(spec)
        await orchestrator.start_workflow(workflow_id)
        paused = await _wait_until(orchestrator, workflow_id, {"paused", "failed"})
        assert paused is not None
        assert paused["status"] == "paused"

        resumed = await orchestrator.continue_workflow(workflow_id)
        assert resumed["ok"] is True
        done = await _wait_until(orchestrator, workflow_id, {"completed", "failed"})
        assert done is not None
        assert done["status"] == "completed"

    _run(_scenario())


def test_template_substitution_recurses_objects():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    orchestrator = CompoundWorkflowOrchestrator(db_conn=conn)
    out = orchestrator._substitute_template(
        {
            "query": "VP at {{company.name}}",
            "filters": {"company": "{{company.name}}", "region": "US"},
            "terms": ["{{company.name}}", "AI"],
        },
        {"company": {"name": "Acme"}},
    )
    assert out == {
        "query": "VP at Acme",
        "filters": {"company": "Acme", "region": "US"},
        "terms": ["Acme", "AI"],
    }


def test_compound_workflow_fails_when_browser_tool_returns_error(monkeypatch):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    orchestrator = CompoundWorkflowOrchestrator(db_conn=conn)

    async def fake_search_and_extract(**_kwargs):
        return {
            "ok": False,
            "error": {
                "code": "salesnav_filter_unmapped",
                "message": "One or more SalesNav filters are not URL-mapped.",
            },
        }

    monkeypatch.setattr("services.orchestration.compound.orchestrator.recipes.search_and_extract", fake_search_and_extract)

    spec = {
        "name": "must fail on recipe error",
        "phases": [
            {
                "id": "p1",
                "name": "search",
                "type": "search",
                "operation": {"tool": "browser_search_and_extract", "task": "salesnav_search_account", "base_params": {}},
                "param_templates": {"query": "industrial machinery"},
            },
        ],
    }

    async def _scenario():
        workflow_id = await orchestrator.create_workflow(spec)
        started = await orchestrator.start_workflow(workflow_id)
        assert started["ok"] is True
        done = await _wait_until(orchestrator, workflow_id, {"completed", "failed"})
        assert done is not None
        assert done["status"] == "failed"
        err = done.get("error") or {}
        assert err.get("code") == "salesnav_filter_unmapped"
        assert "URL-mapped" in str(err.get("message") or "")

    _run(_scenario())
