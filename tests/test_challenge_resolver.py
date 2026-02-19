import asyncio
from pathlib import Path
from uuid import uuid4

from services.web_automation.browser.challenges.detector import detect_challenge
from services.web_automation.browser.challenges.handler import handle_challenge_if_present
from services.web_automation.browser.challenges.resolver_config import ChallengeResolverConfig


class _FakeMouse:
    async def move(self, *_args, **_kwargs):
        return None

    async def click(self, *_args, **_kwargs):
        return None


class _FakePage:
    def __init__(self, probes: list[dict], *, url: str):
        self._probes = list(probes)
        self.url = url
        self.mouse = _FakeMouse()

    async def evaluate(self, _script):
        if self._probes:
            return self._probes.pop(0)
        return {"title": "", "text": "", "frames": []}

    async def screenshot(self, **kwargs):
        path = kwargs.get("path")
        if path:
            Path(path).write_bytes(b"fake-jpg")
            return b""
        return b"fake-jpg"


def _run(coro):
    return asyncio.run(coro)


def _tmp_dir() -> Path:
    path = Path("data/debug") / f"test_challenge_resolver_{uuid4().hex[:8]}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_detector_classifies_recaptcha_v2_as_visible():
    page = _FakePage(
        [
            {
                "title": "Verify you are human",
                "text": "Please complete the challenge",
                "frames": ["https://www.google.com/recaptcha/api2/anchor?k=abc"],
            }
        ],
        url="https://localhost/challenge",
    )
    out = _run(detect_challenge(page))
    assert out is not None
    assert out.kind == "visible_image"
    assert out.provider == "google"


def test_detector_classifies_turnstile_as_behavioral():
    page = _FakePage(
        [
            {
                "title": "Checking your browser",
                "text": "Turnstile challenge",
                "frames": ["https://challenges.cloudflare.com/turnstile/v0/api.js"],
            }
        ],
        url="https://localhost/challenge",
    )
    out = _run(detect_challenge(page))
    assert out is not None
    assert out.kind == "behavioral_or_invisible"
    assert out.provider == "cloudflare"


def test_handler_respects_research_host_gate():
    tmp_path = _tmp_dir()
    page = _FakePage(
        [{"title": "Verify you are human", "text": "captcha", "frames": []}],
        url="https://example.com/challenge",
    )
    cfg = ChallengeResolverConfig(
        enabled=True,
        research_mode=True,
        allow_live_hosts=False,
        allowed_hosts=["localhost"],
        ai_enabled=False,
        ai_model="gpt-4o-mini",
        ai_max_rounds=1,
        ai_max_actions_per_round=1,
        human_fallback_enabled=True,
        human_wait_timeout_ms=1000,
        human_poll_interval_ms=50,
        log_jsonl_path=tmp_path / "events.jsonl",
        handoff_dir=tmp_path / "handoffs",
        notify_webhook_url=None,
    )
    out = _run(handle_challenge_if_present(page, config=cfg))
    assert out.resolved is False
    assert out.mode == "disabled"
    assert out.reason == "feature_disabled_or_non_research_host"


def test_handler_hands_off_behavioral_and_resumes_when_cleared():
    tmp_path = _tmp_dir()
    page = _FakePage(
        [
            {
                "title": "Please verify",
                "text": "turnstile",
                "frames": ["https://challenges.cloudflare.com/turnstile/v0/"],
            },
            {
                "title": "Please verify",
                "text": "turnstile",
                "frames": ["https://challenges.cloudflare.com/turnstile/v0/"],
            },
            {"title": "Welcome", "text": "home", "frames": []},
        ],
        url="https://localhost/challenge",
    )
    cfg = ChallengeResolverConfig(
        enabled=True,
        research_mode=True,
        allow_live_hosts=False,
        allowed_hosts=["localhost"],
        ai_enabled=False,
        ai_model="gpt-4o-mini",
        ai_max_rounds=1,
        ai_max_actions_per_round=1,
        human_fallback_enabled=True,
        human_wait_timeout_ms=2000,
        human_poll_interval_ms=10,
        log_jsonl_path=tmp_path / "events.jsonl",
        handoff_dir=tmp_path / "handoffs",
        notify_webhook_url=None,
    )
    out = _run(handle_challenge_if_present(page, config=cfg))
    assert out.mode == "human_handoff"
    assert out.resolved is True
