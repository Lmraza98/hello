import asyncio
import types

from services.web_automation.browser.core.workflow import BrowserWorkflow


def _run(coro):
    return asyncio.run(coro)


def test_dismiss_common_overlays_closes_salesnav_notifications_panel(monkeypatch):
    wf = BrowserWorkflow(tab_id="tab-1")
    calls = {"evaluate": 0, "acts": []}

    class _FakePage:
        async def evaluate(self, _script):
            calls["evaluate"] += 1
            return calls["evaluate"] == 1

    async def fake_raw_page(self):
        return _FakePage()

    async def fake_snapshot(self):
        return []

    async def fake_wait(self, _ms=900):
        return None

    async def fake_browser_act(req):
        calls["acts"].append((req.action, req.value))
        return {"ok": True}

    wf._raw_page = types.MethodType(fake_raw_page, wf)
    wf.snapshot = types.MethodType(fake_snapshot, wf)
    wf.wait = types.MethodType(fake_wait, wf)
    monkeypatch.setattr("services.web_automation.browser.core.workflow.browser_act", fake_browser_act)

    out = _run(wf.dismiss_common_overlays(max_passes=2))
    assert out["count"] == 1
    assert out["closed"][0]["source"] == "salesnav_notifications_panel"
    assert any(action == "press" and value == "Escape" for action, value in calls["acts"])

