from __future__ import annotations

import asyncio
import datetime as dt
import json
import random
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from services.ai_challenge_resolver import try_resolve_visible_challenge_with_ai
from services.browser_challenges import resolve_challenge
from services.browser_stealth import StealthConfig
from services.challenge_detector import DetectedChallenge, detect_challenge
from services.challenge_resolver_config import ChallengeResolverConfig, append_jsonl

HumanNotifyCallback = Callable[[dict[str, Any]], Awaitable[None]] | None


@dataclass(frozen=True)
class ChallengeHandleResult:
    resolved: bool
    mode: str  # none | interstitial_wait | ai_vision | human_handoff | legacy | blocked | disabled
    detection: dict[str, Any] | None
    reason: str | None
    attempts: int
    latency_ms: int


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _to_dict(challenge: DetectedChallenge | None) -> dict[str, Any] | None:
    return asdict(challenge) if challenge else None


async def _wait_for_clear(
    page: Any,
    *,
    timeout_ms: int,
    poll_ms: int,
) -> bool:
    deadline = asyncio.get_event_loop().time() + (max(250, timeout_ms) / 1000.0)
    sleep_s = max(0.15, poll_ms / 1000.0)
    while True:
        found = await detect_challenge(page)
        if not found:
            return True
        if asyncio.get_event_loop().time() >= deadline:
            return False
        await asyncio.sleep(sleep_s + random.uniform(-0.08, 0.08))


async def _notify_human(
    *,
    page: Any,
    challenge: DetectedChallenge,
    config: ChallengeResolverConfig,
    reason: str,
    notify_cb: HumanNotifyCallback,
) -> dict[str, Any]:
    ticket_id = f"challenge-{uuid.uuid4().hex[:12]}"
    config.handoff_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = config.handoff_dir / f"{ticket_id}.jpg"
    meta_path = config.handoff_dir / f"{ticket_id}.json"
    try:
        await page.screenshot(path=str(screenshot_path), full_page=True, type="jpeg", quality=80)
    except Exception:
        screenshot_path = Path("")
    payload = {
        "ticket_id": ticket_id,
        "created_at": _now_iso(),
        "reason": reason,
        "challenge": _to_dict(challenge),
        "url": challenge.url,
        "screenshot_path": str(screenshot_path) if screenshot_path else None,
    }
    meta_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")

    if notify_cb:
        try:
            await notify_cb(payload)
        except Exception:
            pass

    if config.notify_webhook_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(config.notify_webhook_url, json=payload)
        except Exception:
            pass
    return payload


async def handle_challenge_if_present(
    page: Any,
    *,
    cfg: StealthConfig | None = None,
    config: ChallengeResolverConfig | None = None,
    notify_cb: HumanNotifyCallback = None,
) -> ChallengeHandleResult:
    started = asyncio.get_event_loop().time()
    cfg = cfg or StealthConfig()
    config = config or ChallengeResolverConfig.from_env()

    detection = await detect_challenge(page)
    if detection is None:
        return ChallengeHandleResult(
            resolved=True,
            mode="none",
            detection=None,
            reason=None,
            attempts=0,
            latency_ms=0,
        )

    base_event = {
        "timestamp": _now_iso(),
        "url": detection.url,
        "challenge": _to_dict(detection),
        "research_mode": config.research_mode,
    }

    if not config.feature_enabled_for_url(detection.url):
        append_jsonl(
            config.log_jsonl_path,
            {
                **base_event,
                "event": "challenge_detected_but_disabled",
                "reason": "feature_disabled_or_non_research_host",
            },
        )
        latency_ms = int((asyncio.get_event_loop().time() - started) * 1000)
        return ChallengeHandleResult(
            resolved=False,
            mode="disabled",
            detection=_to_dict(detection),
            reason="feature_disabled_or_non_research_host",
            attempts=0,
            latency_ms=latency_ms,
        )

    if detection.kind == "interstitial_wait":
        ok = await _wait_for_clear(
            page,
            timeout_ms=min(config.human_wait_timeout_ms, 40_000),
            poll_ms=config.human_poll_interval_ms,
        )
        append_jsonl(
            config.log_jsonl_path,
            {
                **base_event,
                "event": "interstitial_wait",
                "resolved": ok,
            },
        )
        latency_ms = int((asyncio.get_event_loop().time() - started) * 1000)
        return ChallengeHandleResult(
            resolved=ok,
            mode="interstitial_wait",
            detection=_to_dict(detection),
            reason=None if ok else "interstitial_timeout",
            attempts=1,
            latency_ms=latency_ms,
        )

    if detection.kind == "blocked":
        append_jsonl(config.log_jsonl_path, {**base_event, "event": "blocked"})
        latency_ms = int((asyncio.get_event_loop().time() - started) * 1000)
        return ChallengeHandleResult(
            resolved=False,
            mode="blocked",
            detection=_to_dict(detection),
            reason="blocked_or_rate_limited",
            attempts=1,
            latency_ms=latency_ms,
        )

    if detection.kind == "visible_image":
        ai_out = await try_resolve_visible_challenge_with_ai(
            page,
            detection=detection,
            config=config,
        )
        append_jsonl(
            config.log_jsonl_path,
            {
                **base_event,
                "event": "ai_visible_attempt",
                "ai": asdict(ai_out),
            },
        )
        if ai_out.ok:
            latency_ms = int((asyncio.get_event_loop().time() - started) * 1000)
            return ChallengeHandleResult(
                resolved=True,
                mode="ai_vision",
                detection=_to_dict(detection),
                reason=None,
                attempts=max(1, ai_out.rounds),
                latency_ms=latency_ms,
            )

    # Preserve backward compatibility for local checkbox/press-and-hold routines.
    if detection.kind == "visible_image":
        legacy_ok = await resolve_challenge(page, cfg=cfg, max_attempts=2)
        append_jsonl(
            config.log_jsonl_path,
            {
                **base_event,
                "event": "legacy_visible_attempt",
                "resolved": legacy_ok,
            },
        )
        if legacy_ok:
            latency_ms = int((asyncio.get_event_loop().time() - started) * 1000)
            return ChallengeHandleResult(
                resolved=True,
                mode="legacy",
                detection=_to_dict(detection),
                reason=None,
                attempts=1,
                latency_ms=latency_ms,
            )

    if not config.human_fallback_enabled:
        latency_ms = int((asyncio.get_event_loop().time() - started) * 1000)
        return ChallengeHandleResult(
            resolved=False,
            mode="human_handoff",
            detection=_to_dict(detection),
            reason="human_fallback_disabled",
            attempts=1,
            latency_ms=latency_ms,
        )

    handoff = await _notify_human(
        page=page,
        challenge=detection,
        config=config,
        reason="behavioral_or_ai_unresolved",
        notify_cb=notify_cb,
    )
    append_jsonl(
        config.log_jsonl_path,
        {
            **base_event,
            "event": "human_handoff_requested",
            "handoff": handoff,
        },
    )

    resolved = await _wait_for_clear(
        page,
        timeout_ms=config.human_wait_timeout_ms,
        poll_ms=config.human_poll_interval_ms,
    )
    append_jsonl(
        config.log_jsonl_path,
        {
            **base_event,
            "event": "human_handoff_wait_complete",
            "resolved": resolved,
            "handoff_ticket_id": handoff.get("ticket_id"),
        },
    )
    latency_ms = int((asyncio.get_event_loop().time() - started) * 1000)
    return ChallengeHandleResult(
        resolved=resolved,
        mode="human_handoff",
        detection=_to_dict(detection),
        reason=None if resolved else "human_handoff_timeout",
        attempts=1,
        latency_ms=latency_ms,
    )
