import asyncio

from api.routes import browser_nav
from services.web_automation.browser.workflows.task_manager import workflow_task_manager


def _run(coro):
    return asyncio.run(coro)


def test_browser_navigate_passes_timeout_to_backend(monkeypatch):
    calls = {}

    class _FakeBackend:
        async def navigate(self, *, url, tab_id=None, timeout_ms=None):
            calls["url"] = url
            calls["tab_id"] = tab_id
            calls["timeout_ms"] = timeout_ms
            return {"ok": True, "tab_id": tab_id or "tab-0", "url": url}

        async def health(self):
            return {"ok": True}

        async def tabs(self):
            return {"tabs": []}

        async def snapshot(self, *, tab_id=None, mode=None):
            return {"ok": True}

        async def find_ref(self, *, text, role=None, tab_id=None, timeout_ms=8000, poll_ms=400):
            return {"ok": True, "ref": "e1"}

        async def act(self, *, action, ref=None, value=None, tab_id=None):
            return {"ok": True}

        async def wait(self, *, ms, tab_id=None):
            return {"ok": True}

        async def screenshot(self, *, tab_id=None, full_page=None):
            return {"ok": True}

    monkeypatch.setattr(browser_nav, "get_browser_backend", lambda: _FakeBackend())

    req = browser_nav.BrowserNavigateRequest(url="https://example.com", tab_id="tab-2", timeout_ms=12345)
    out = _run(browser_nav.browser_navigate(req))
    assert out.get("ok") is True
    assert isinstance(out.get("task_id"), str)
    assert calls["url"] == "https://example.com"
    assert calls["tab_id"] == "tab-2"
    assert calls["timeout_ms"] == 12345


def test_browser_navigate_creates_tracked_task(monkeypatch):
    class _FakeBackend:
        async def navigate(self, *, url, tab_id=None, timeout_ms=None):
            return {"ok": True, "tab_id": tab_id or "tab-0", "url": url}

        async def health(self):
            return {"ok": True}

        async def tabs(self):
            return {"tabs": []}

        async def snapshot(self, *, tab_id=None, mode=None):
            return {"ok": True}

        async def find_ref(self, *, text, role=None, tab_id=None, timeout_ms=8000, poll_ms=400):
            return {"ok": True, "ref": "e1"}

        async def act(self, *, action, ref=None, value=None, tab_id=None):
            return {"ok": True}

        async def wait(self, *, ms, tab_id=None):
            return {"ok": True}

        async def screenshot(self, *, tab_id=None, full_page=None):
            return {"ok": True}

    monkeypatch.setattr(browser_nav, "get_browser_backend", lambda: _FakeBackend())
    req = browser_nav.BrowserNavigateRequest(url="https://example.com", tab_id="tab-9", timeout_ms=15000)
    out = _run(browser_nav.browser_navigate(req))
    task_id = str(out.get("task_id") or "")
    assert task_id

    rows = _run(workflow_task_manager.list(include_finished=True, limit=200))
    row = next((r for r in rows if r.get("task_id") == task_id), None)
    assert row is not None
    assert row.get("status") == "finished"
    diagnostics = row.get("diagnostics") or {}
    assert diagnostics.get("operation") == "browser_navigate"
