"""Challenge detection AND resolution for skill-driven browser automation.

Layer 1 — **Detection** (``classify_challenge``)
    Best-effort classification from a lightweight DOM probe.  Returns a
    ``ChallengeMatch`` with kind/confidence/matched metadata.

Layer 2 — **Resolution** (``resolve_challenge``)
    Attempts to autonomously clear a detected challenge:
    - ``interstitial_wait``: wait for Cloudflare "checking your browser" to clear.
    - ``human_verification``: click checkboxes, press-and-hold for Turnstile.
    - ``blocked``: back off + retry.

    If resolution fails after all retries the caller gets a structured error —
    no human in the loop required.  The resolver works directly with a
    Playwright page/locator so it stays independent of the high-level
    ``BrowserWorkflow`` API (avoids circular imports).

All challenge patterns are hardcoded here.  There are only a handful of
common types and they change slowly.  If the list needs updating, edit the
``CHALLENGE_PATTERNS`` table or the ``*_PHRASES`` lists below.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from typing import Any

from services.web_automation.browser.core.stealth import (
    StealthConfig,
    human_click,
    human_delay,
    human_mouse_move,
    human_press_and_hold,
    human_scroll,
)

logger = logging.getLogger(__name__)


# ───────────────────────────────────────────────────────────────────────────
# Detection
# ───────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ChallengeMatch:
    kind: str  # interstitial_wait | human_verification | blocked
    confidence: float
    matched: list[str]


def _lower(value: Any) -> str:
    return str(value or "").lower()


def _contains_any(text: str, phrases: list[str]) -> list[str]:
    hits: list[str] = []
    if not text:
        return hits
    for phrase in phrases:
        p = (phrase or "").strip().lower()
        if not p:
            continue
        if p in text:
            hits.append(phrase)
    return hits


# Broad, common signals.  Keep them short and locale-agnostic.
INTERSTITIAL_PHRASES = [
    "checking your browser",
    "just a moment",
    "please wait",
    "one more step",
    "security check",
    "verifying your browser",
    "enable javascript",
    "checking if the site connection is secure",
    "performing a security check",
    "ddos protection",
]

HUMAN_VERIFICATION_PHRASES = [
    "verify you are human",
    "i am not a robot",
    "i'm not a robot",
    "captcha",
    "recaptcha",
    "hcaptcha",
    "turnstile",
    "press and hold",
    "press & hold",
    "select all images",
    "click each image",
    "confirm you are not a robot",
    "human verification",
    "bot detection",
]

BLOCK_PHRASES = [
    "access denied",
    "unusual traffic",
    "too many requests",
    "rate limit",
    "temporarily blocked",
    "forbidden",
    "pardon our interruption",
    "you have been blocked",
    "automated access",
    "suspected bot",
]

CAPTCHA_FRAME_MARKERS = [
    "recaptcha",
    "hcaptcha",
    "turnstile",
    "captcha",
    "challenges.cloudflare.com",
    "google.com/recaptcha",
]


def classify_challenge(
    *,
    url: str | None,
    title: str | None,
    text_snippet: str | None,
    frame_urls: list[str] | None = None,
) -> ChallengeMatch | None:
    """Best-effort classification from a lightweight DOM probe."""
    u = _lower(url)
    t = _lower(title)
    body = _lower(text_snippet)
    frames = [_lower(x) for x in (frame_urls or []) if x]

    matched_interstitial: list[str] = []
    matched_human: list[str] = []
    matched_block: list[str] = []

    matched_interstitial += _contains_any(t, INTERSTITIAL_PHRASES)
    matched_interstitial += _contains_any(body, INTERSTITIAL_PHRASES)

    matched_human += _contains_any(t, HUMAN_VERIFICATION_PHRASES)
    matched_human += _contains_any(body, HUMAN_VERIFICATION_PHRASES)

    matched_block += _contains_any(t, BLOCK_PHRASES)
    matched_block += _contains_any(body, BLOCK_PHRASES)

    frame_hits: list[str] = []
    for f in frames:
        for marker in CAPTCHA_FRAME_MARKERS:
            if marker and marker in f:
                frame_hits.append(marker)
                break

    # Score each class.  Frames are a strong signal for CAPTCHA widgets.
    score_interstitial = 0.0
    score_human = 0.0
    score_block = 0.0

    if matched_interstitial:
        score_interstitial += 0.35
        if any("checking your browser" in _lower(x) for x in matched_interstitial):
            score_interstitial += 0.15
        if any("checking if the site connection" in _lower(x) for x in matched_interstitial):
            score_interstitial += 0.15
    if matched_human:
        score_human += 0.45
        if any("captcha" in _lower(x) for x in matched_human):
            score_human += 0.15
    if frame_hits:
        score_human += 0.55
    if matched_block:
        score_block += 0.55
        if any("too many requests" in _lower(x) for x in matched_block):
            score_block += 0.15

    if "challenge" in u or "captcha" in u:
        score_human += 0.1
    if "accessdenied" in u or "blocked" in u:
        score_block += 0.1

    best_kind = None
    best_score = 0.0
    best_matched: list[str] = []

    for kind, score, matched in [
        ("blocked", score_block, matched_block),
        ("human_verification", score_human, matched_human + frame_hits),
        ("interstitial_wait", score_interstitial, matched_interstitial),
    ]:
        if score > best_score:
            best_kind = kind
            best_score = score
            best_matched = matched

    # Threshold tuned to avoid false positives.
    if not best_kind or best_score < 0.55:
        return None

    # If we think it's blocked, prefer that over interstitial/human.
    if best_kind != "blocked" and score_block >= 0.8:
        best_kind = "blocked"
        best_score = max(best_score, score_block)
        best_matched = matched_block

    return ChallengeMatch(kind=best_kind, confidence=min(1.0, best_score), matched=best_matched[:6])


# ───────────────────────────────────────────────────────────────────────────
# Resolution — structured challenge patterns + handlers
# ───────────────────────────────────────────────────────────────────────────

# Each pattern is tried against the visible text of the page.  When matched,
# the corresponding ``action`` determines how we handle it.
CHALLENGE_PATTERNS: list[dict[str, Any]] = [
    # Cloudflare interstitial — just wait it out
    {"text": "checking your browser",           "action": "wait"},
    {"text": "checking if the site connection",  "action": "wait"},
    {"text": "performing a security check",      "action": "wait"},
    {"text": "just a moment",                    "action": "wait"},
    {"text": "ddos protection",                  "action": "wait"},
    # "I'm not a robot" / "Verify you are human" checkboxes
    {"text": "verify you are human",             "action": "checkbox"},
    {"text": "i'm not a robot",                  "action": "checkbox"},
    {"text": "i am not a robot",                 "action": "checkbox"},
    {"text": "confirm you are not a robot",      "action": "checkbox"},
    # Cloudflare Turnstile press-and-hold
    {"text": "press & hold",                     "action": "press_hold"},
    {"text": "press and hold",                   "action": "press_hold"},
    # Turnstile / Cloudflare managed challenge (iframe-based)
    {"text": "challenges.cloudflare.com",        "action": "turnstile_frame", "match_in": "frames"},
    {"text": "turnstile",                        "action": "turnstile_frame", "match_in": "frames"},
]


async def _detect_challenge_pattern(
    page: Any,
    *,
    max_text_chars: int = 6000,
) -> dict[str, Any] | None:
    """Detect a challenge pattern directly from the page DOM.

    Returns ``{"action": str, "text": str, ...}`` if a known pattern is found,
    or ``None`` if the page looks clean.
    """
    try:
        probe = await page.evaluate(
            """
            (() => {
                const title = (document.title || '').toString().toLowerCase();
                const body = document.body;
                const text = (body && body.innerText ? body.innerText : '').toString()
                    .replace(/\\s+/g, ' ').trim().slice(0, MAX_CHARS).toLowerCase();
                const frames = Array.from(document.querySelectorAll('iframe'))
                    .map(f => (f.src || '').toLowerCase())
                    .filter(Boolean)
                    .slice(0, 20);
                return { title, text, frames };
            })()
            """.replace("MAX_CHARS", str(max_text_chars))
        )
    except Exception:
        return None

    if not isinstance(probe, dict):
        return None

    title = str(probe.get("title") or "")
    text = str(probe.get("text") or "")
    frames = probe.get("frames") or []
    combined_text = f"{title} {text}"

    for pattern in CHALLENGE_PATTERNS:
        needle = (pattern["text"] or "").lower()
        match_in = pattern.get("match_in", "text")

        if match_in == "frames":
            if any(needle in f for f in frames):
                return {**pattern, "probe": probe}
        else:
            if needle in combined_text:
                return {**pattern, "probe": probe}
    return None


# ───────────────────────────────────────────────────────────────────────────
# Individual action handlers
# ───────────────────────────────────────────────────────────────────────────

async def _handle_wait(page: Any, pattern: dict[str, Any], cfg: StealthConfig) -> bool:
    """Cloudflare "checking your browser" — just wait for it to clear."""
    for attempt in range(18):  # up to ~36 seconds
        await asyncio.sleep(random.uniform(1.5, 2.5))
        remaining = await _detect_challenge_pattern(page)
        if not remaining:
            logger.info("Interstitial cleared after %d polls", attempt + 1)
            return True
        # If it morphed into a different challenge type, let the caller re-dispatch.
        if remaining.get("action") != "wait":
            return False
    logger.warning("Interstitial did not clear after waiting")
    return False


async def _handle_checkbox(page: Any, pattern: dict[str, Any], cfg: StealthConfig) -> bool:
    """Click an "I'm not a robot" / "Verify you are human" checkbox.

    Strategy:
    1. Look for a checkbox/button in the main page or inside a challenge iframe.
    2. Add a human-like pause before clicking.
    3. Use the stealth click with jitter so it doesn't land dead-centre.
    """
    await human_delay(600, 1800)

    # Try clicking checkboxes/buttons whose text matches common patterns
    selectors = [
        # Turnstile / Cloudflare managed challenge
        'input[type="checkbox"]',
        '[role="checkbox"]',
        # reCAPTCHA anchor checkbox
        '.recaptcha-checkbox-border',
        '#recaptcha-anchor',
        # hCaptcha checkbox
        '#checkbox',
        '[data-hcaptcha-widget-id]',
        # Generic "verify" / "not a robot" buttons
        'button',
    ]

    verify_phrases = [
        "verify", "not a robot", "human", "i am not", "i'm not",
        "confirm", "continue", "check",
    ]

    # First try inside iframes (Turnstile, reCAPTCHA, hCaptcha embed in iframes)
    try:
        frames = page.frames
        for frame in frames:
            frame_url = (frame.url or "").lower()
            is_challenge_frame = any(
                marker in frame_url
                for marker in ["captcha", "turnstile", "challenges.cloudflare", "recaptcha", "hcaptcha"]
            )
            if not is_challenge_frame:
                continue
            for sel in selectors:
                try:
                    loc = frame.locator(sel).first
                    if await loc.is_visible(timeout=1500):
                        await human_click(page, loc, cfg, timeout=8_000)
                        await human_delay(1000, 2500)
                        remaining = await _detect_challenge_pattern(page)
                        if not remaining:
                            logger.info("Checkbox challenge resolved via iframe click")
                            return True
                except Exception:
                    continue
    except Exception:
        pass

    # Then try in the main page
    for sel in selectors:
        try:
            elements = page.locator(sel)
            count = await elements.count()
            for i in range(min(count, 8)):
                el = elements.nth(i)
                try:
                    visible = await el.is_visible(timeout=800)
                    if not visible:
                        continue
                except Exception:
                    continue
                # For buttons, check that the label relates to verification
                if sel == "button":
                    try:
                        text = (await el.inner_text(timeout=1000) or "").lower()
                    except Exception:
                        text = ""
                    if not any(phrase in text for phrase in verify_phrases):
                        continue
                await human_click(page, el, cfg, timeout=8_000)
                await human_delay(1200, 3000)
                remaining = await _detect_challenge_pattern(page)
                if not remaining:
                    logger.info("Checkbox challenge resolved via main-page click on %s", sel)
                    return True
        except Exception:
            continue

    logger.warning("Checkbox challenge: could not find a clickable target")
    return False


async def _handle_press_hold(page: Any, pattern: dict[str, Any], cfg: StealthConfig) -> bool:
    """Cloudflare Turnstile press-and-hold challenge."""
    await human_delay(500, 1200)

    # Look for the press-and-hold target in iframes first, then main page
    hold_selectors = [
        '[id*="turnstile"]',
        '[class*="turnstile"]',
        'input[type="checkbox"]',
        '[role="checkbox"]',
        'button',
        'div[class*="challenge"]',
    ]

    targets: list[tuple[Any, Any]] = []  # (frame_or_page, locator)

    # Iframe targets
    try:
        for frame in page.frames:
            frame_url = (frame.url or "").lower()
            if any(m in frame_url for m in ["turnstile", "challenges.cloudflare", "captcha"]):
                for sel in hold_selectors:
                    try:
                        loc = frame.locator(sel).first
                        if await loc.is_visible(timeout=1000):
                            targets.append((frame, loc))
                    except Exception:
                        continue
    except Exception:
        pass

    # Main page targets
    for sel in hold_selectors:
        try:
            loc = page.locator(sel).first
            if await loc.is_visible(timeout=800):
                targets.append((page, loc))
        except Exception:
            continue

    for _frame, loc in targets:
        try:
            await human_press_and_hold(page, loc, cfg, hold_min_s=2.0, hold_max_s=5.0)
            await human_delay(1500, 3000)
            remaining = await _detect_challenge_pattern(page)
            if not remaining:
                logger.info("Press-and-hold challenge resolved")
                return True
        except Exception:
            continue

    logger.warning("Press-and-hold challenge: no target resolved the challenge")
    return False


async def _handle_turnstile_frame(page: Any, pattern: dict[str, Any], cfg: StealthConfig) -> bool:
    """Handle Cloudflare Turnstile embedded in an iframe.

    Turnstile can present as:
    - A simple checkbox (handled like _handle_checkbox)
    - A press-and-hold (handled like _handle_press_hold)
    - A non-interactive managed challenge (just wait)

    We try all three strategies sequentially.
    """
    # First wait a bit — Turnstile sometimes auto-resolves with good fingerprints
    await human_delay(2000, 4000)
    remaining = await _detect_challenge_pattern(page)
    if not remaining:
        logger.info("Turnstile frame resolved on its own (stealth fingerprint passed)")
        return True

    # Try checkbox approach
    if await _handle_checkbox(page, pattern, cfg):
        return True

    # Try press-and-hold approach
    if await _handle_press_hold(page, pattern, cfg):
        return True

    # Last resort: wait longer (managed challenge can take 5-15s)
    for _ in range(8):
        await asyncio.sleep(random.uniform(1.5, 3.0))
        remaining = await _detect_challenge_pattern(page)
        if not remaining:
            logger.info("Turnstile frame eventually cleared after extended wait")
            return True

    return False


# Handler dispatch table
_ACTION_HANDLERS = {
    "wait":            _handle_wait,
    "checkbox":        _handle_checkbox,
    "press_hold":      _handle_press_hold,
    "turnstile_frame": _handle_turnstile_frame,
}


# ───────────────────────────────────────────────────────────────────────────
# Public API
# ───────────────────────────────────────────────────────────────────────────

async def detect_and_classify(page: Any) -> tuple[dict[str, Any] | None, ChallengeMatch | None]:
    """Run both the pattern detector and the classifier.

    Returns ``(pattern, classification)`` — either or both may be ``None``.
    The pattern dict is used by the resolver; the ChallengeMatch is used by
    existing BrowserWorkflow.detect_challenge() callers.
    """
    pattern = await _detect_challenge_pattern(page)
    probe = pattern.get("probe", {}) if pattern else {}

    classification = classify_challenge(
        url=str(page.url or ""),
        title=str(probe.get("title") or ""),
        text_snippet=str(probe.get("text") or ""),
        frame_urls=probe.get("frames") if isinstance(probe.get("frames"), list) else None,
    )
    return pattern, classification


async def resolve_challenge(
    page: Any,
    *,
    cfg: StealthConfig | None = None,
    max_attempts: int = 3,
) -> bool:
    """Detect and attempt to resolve any challenge on *page*.

    Returns ``True`` if the page is now challenge-free (or was never blocked).
    Returns ``False`` if resolution failed after all attempts.
    """
    if cfg is None:
        cfg = StealthConfig()

    for attempt in range(max(1, max_attempts)):
        pattern = await _detect_challenge_pattern(page)
        if not pattern:
            return True  # No challenge — page is clean.

        action = pattern.get("action", "wait")
        handler = _ACTION_HANDLERS.get(action, _handle_wait)

        logger.info(
            "Challenge attempt %d/%d: action=%s text=%r",
            attempt + 1, max_attempts, action, pattern.get("text", "")[:60],
        )

        try:
            resolved = await handler(page, pattern, cfg)
        except Exception:
            logger.exception("Challenge handler %s raised an exception", action)
            resolved = False

        if resolved:
            # Double-check: make sure the page is truly clear
            await human_delay(500, 1500)
            recheck = await _detect_challenge_pattern(page)
            if not recheck:
                logger.info("Challenge resolved on attempt %d", attempt + 1)
                return True
            logger.info("Challenge reappeared after resolution — retrying")

        # Small backoff between retries
        await human_delay(1000, 3000)

    logger.warning("Challenge not resolved after %d attempts", max_attempts)
    return False


async def resolve_on_navigate(
    page: Any,
    *,
    cfg: StealthConfig | None = None,
    settle_ms: int = 1500,
) -> bool:
    """Convenience wrapper: wait for the page to settle, then resolve challenges.

    Intended to be called immediately after ``page.goto()`` or after any
    navigation that might trigger a challenge.
    """
    await asyncio.sleep(max(200, settle_ms) / 1000.0)
    return await resolve_challenge(page, cfg=cfg, max_attempts=3)
