import asyncio

from services.browser_workflows import recipes


class _FakeWorkflow:
    def __init__(self, challenge):
        self._challenge = challenge
        self.tab_id = "tab-1"
        self.skill_id = None
        self.skill_meta = {}

    async def wait_through_interstitials(self, **_kwargs):
        return self._challenge

    async def current_url(self):
        return "https://localhost/challenge"


def _run(coro):
    return asyncio.run(coro)


def test_guard_challenges_reports_solver_disabled():
    wf = _FakeWorkflow(
        {
            "kind": "visible_image",
            "resolver_reason": "feature_disabled_or_non_research_host",
            "url": "https://localhost/challenge",
        }
    )
    out = _run(recipes._guard_challenges(wf, stage="test"))
    assert out is not None
    assert out.get("ok") is False
    assert (out.get("error") or {}).get("code") == "challenge_solver_disabled"


def test_guard_challenges_reports_human_fallback_disabled():
    wf = _FakeWorkflow(
        {
            "kind": "behavioral_or_invisible",
            "resolver_reason": "human_fallback_disabled",
            "url": "https://localhost/challenge",
        }
    )
    out = _run(recipes._guard_challenges(wf, stage="test"))
    assert out is not None
    assert out.get("ok") is False
    assert (out.get("error") or {}).get("code") == "challenge_human_fallback_disabled"
