import asyncio

import pytest
from fastapi import HTTPException

from api.routes import browser_workflows as routes


def _run(coro):
    return asyncio.run(coro)


def test_search_and_extract_short_task_runs_sync(monkeypatch):
    monkeypatch.setenv("BROWSER_WORKFLOW_ASYNC_ENABLED", "false")

    called = {"count": 0}

    async def fake_search_and_extract(**kwargs):
        called["count"] += 1
        return {"ok": True, "count": 1, "tab_id": "tab-0", "echo": kwargs.get("query")}

    monkeypatch.setattr(routes, "search_and_extract", fake_search_and_extract)
    req = routes.SearchAndExtractRequest(task="salesnav_search_account", query="acme", limit=5)
    out = _run(routes.browser_search_and_extract(req))
    assert out.get("ok") is True
    assert out.get("echo") == "acme"
    assert isinstance(out.get("task_id"), str)
    assert out.get("task_status") == "finished"
    assert called["count"] == 1


def test_search_and_extract_long_task_runs_async_with_status(monkeypatch):
    monkeypatch.setenv("BROWSER_WORKFLOW_ASYNC_ENABLED", "true")

    async def fake_search_and_extract(**kwargs):
        progress_cb = kwargs.get("progress_cb")
        if progress_cb:
            await progress_cb(40, "running", {"phase": "search"})
        await asyncio.sleep(0.02)
        if progress_cb:
            await progress_cb(100, "finished", None)
        return {"ok": True, "count": 3, "tab_id": "tab-0"}

    monkeypatch.setattr(routes, "search_and_extract", fake_search_and_extract)
    req = routes.SearchAndExtractRequest(task="salesnav_search_account", query="acme", limit=120)
    pending = _run(routes.browser_search_and_extract(req))
    assert pending.get("status") == "pending"
    task_id = str(pending.get("task_id") or "")
    assert task_id

    async def _wait_status() -> dict:
        for _ in range(40):
            row = await routes.browser_workflow_status(task_id)
            if row.get("status") in {"finished", "failed"}:
                return row
            await asyncio.sleep(0.02)
        return await routes.browser_workflow_status(task_id)

    row = _run(_wait_status())
    assert row.get("status") in {"running", "finished", "failed"}
    if row.get("status") == "finished":
        assert isinstance(row.get("result"), dict)
        assert row["result"].get("ok") is True


def test_search_and_extract_sync_timeout_returns_structured_error(monkeypatch):
    monkeypatch.setenv("BROWSER_WORKFLOW_ASYNC_ENABLED", "false")
    monkeypatch.setattr(routes, "sync_workflow_timeout_ms", lambda: 20)

    async def fake_search_and_extract(**_kwargs):
        await asyncio.sleep(0.08)
        return {"ok": True}

    monkeypatch.setattr(routes, "search_and_extract", fake_search_and_extract)
    req = routes.SearchAndExtractRequest(task="salesnav_search_account", query="acme", limit=5)
    out = _run(routes.browser_search_and_extract(req))
    assert out.get("ok") is False
    err = out.get("error") or {}
    assert err.get("code") == "workflow_timeout"


def test_status_unknown_task_raises_404():
    with pytest.raises(HTTPException) as exc:
        _run(routes.browser_workflow_status("missing-task-id"))
    assert exc.value.status_code == 404


def test_tasks_list_endpoint_returns_rows(monkeypatch):
    monkeypatch.setenv("BROWSER_WORKFLOW_ASYNC_ENABLED", "true")

    async def fake_search_and_extract(**kwargs):
        progress_cb = kwargs.get("progress_cb")
        if progress_cb:
            await progress_cb(25, "navigating", {"tab_id": "tab-9"})
        await asyncio.sleep(0.01)
        return {"ok": True, "tab_id": "tab-9"}

    monkeypatch.setattr(routes, "search_and_extract", fake_search_and_extract)
    req = routes.SearchAndExtractRequest(task="salesnav_search_account", query="acme", limit=120)
    pending = _run(routes.browser_search_and_extract(req))
    assert pending.get("status") == "pending"

    rows = _run(routes.browser_workflow_tasks(include_finished=True, limit=20))
    assert rows.get("ok") is True
    assert isinstance(rows.get("tasks"), list)
    assert len(rows["tasks"]) >= 1
