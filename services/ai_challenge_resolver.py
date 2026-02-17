from __future__ import annotations

import asyncio
import base64
import json
import random
import re
import time
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI

from services.challenge_detector import detect_challenge, DetectedChallenge
from services.challenge_resolver_config import ChallengeResolverConfig


@dataclass(frozen=True)
class AiResolveResult:
    ok: bool
    reason: str
    rounds: int
    actions_executed: int
    latency_ms: int
    details: dict[str, Any]


def _extract_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    text = text.strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _clamp_point(x: int, y: int, viewport: dict[str, int] | None) -> tuple[int, int]:
    if not isinstance(viewport, dict):
        return max(1, x), max(1, y)
    width = max(1, int(viewport.get("width") or 0))
    height = max(1, int(viewport.get("height") or 0))
    return max(1, min(width - 1, x)), max(1, min(height - 1, y))


async def _query_vision_plan(
    *,
    screenshot_b64: str,
    detection: DetectedChallenge,
    model: str,
) -> dict[str, Any] | None:
    client = AsyncOpenAI()
    msg = {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": (
                    "You are helping in a RESEARCH-ONLY browser challenge lab.\n"
                    "Return JSON only, no prose.\n"
                    "Schema:\n"
                    "{"
                    "\"decision\":\"solve|needs_human|noop\","
                    "\"confidence\":0.0,"
                    "\"actions\":[{\"type\":\"click\",\"x\":123,\"y\":456,\"reason\":\"short\"}],"
                    "\"notes\":\"short\""
                    "}\n"
                    f"Challenge metadata: provider={detection.provider}, variant={detection.variant}, "
                    f"kind={detection.kind}, matched={detection.matched[:4]}.\n"
                    "Rules: only return click actions for visible checkbox/image challenge elements."
                ),
            },
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{screenshot_b64}"},
            },
        ],
    }
    resp = await client.chat.completions.create(
        model=model,
        temperature=0,
        messages=[msg],
    )
    choice = resp.choices[0] if resp and resp.choices else None
    content = ""
    if choice and choice.message and isinstance(choice.message.content, str):
        content = choice.message.content
    return _extract_json_object(content)


async def try_resolve_visible_challenge_with_ai(
    page: Any,
    *,
    detection: DetectedChallenge,
    config: ChallengeResolverConfig,
) -> AiResolveResult:
    started = time.time()
    if detection.kind != "visible_image":
        return AiResolveResult(
            ok=False,
            reason="not_visible_image",
            rounds=0,
            actions_executed=0,
            latency_ms=0,
            details={},
        )

    if not config.ai_enabled:
        return AiResolveResult(
            ok=False,
            reason="ai_disabled",
            rounds=0,
            actions_executed=0,
            latency_ms=0,
            details={},
        )

    rounds = 0
    actions_executed = 0
    last_plan: dict[str, Any] | None = None
    for _ in range(config.ai_max_rounds):
        rounds += 1
        img_bytes = await page.screenshot(full_page=True, type="jpeg", quality=70)
        image_b64 = base64.b64encode(img_bytes).decode("ascii")
        plan = await _query_vision_plan(
            screenshot_b64=image_b64,
            detection=detection,
            model=config.ai_model,
        )
        last_plan = plan or {}
        if not isinstance(plan, dict):
            break

        decision = str(plan.get("decision") or "noop").lower()
        if decision in {"needs_human", "noop"}:
            break

        actions = plan.get("actions")
        if not isinstance(actions, list):
            break

        viewport = getattr(page, "viewport_size", None)
        if callable(viewport):
            try:
                viewport = viewport()
            except Exception:
                viewport = None
        for action in actions[: config.ai_max_actions_per_round]:
            if not isinstance(action, dict):
                continue
            if str(action.get("type") or "").lower() != "click":
                continue
            try:
                x = int(float(action.get("x")))
                y = int(float(action.get("y")))
            except Exception:
                continue
            x += random.randint(-2, 2)
            y += random.randint(-2, 2)
            x, y = _clamp_point(x, y, viewport if isinstance(viewport, dict) else None)
            try:
                await page.mouse.move(x, y, steps=random.randint(8, 22))
                await asyncio.sleep(random.uniform(0.05, 0.20))
                await page.mouse.click(x, y, delay=random.randint(35, 150))
                actions_executed += 1
            except Exception:
                continue
            await asyncio.sleep(random.uniform(0.5, 1.5))

        after = await detect_challenge(page)
        if after is None:
            latency_ms = int((time.time() - started) * 1000)
            return AiResolveResult(
                ok=True,
                reason="resolved",
                rounds=rounds,
                actions_executed=actions_executed,
                latency_ms=latency_ms,
                details={"plan": last_plan},
            )

    latency_ms = int((time.time() - started) * 1000)
    return AiResolveResult(
        ok=False,
        reason="ai_unresolved",
        rounds=rounds,
        actions_executed=actions_executed,
        latency_ms=latency_ms,
        details={"last_plan": last_plan or {}},
    )
