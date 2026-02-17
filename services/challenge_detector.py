from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DetectedChallenge:
    kind: str  # interstitial_wait | visible_image | behavioral_or_invisible | blocked
    provider: str | None
    variant: str | None
    confidence: float
    matched: list[str]
    url: str
    title: str
    text_snippet: str
    frame_urls: list[str]


INTERSTITIAL_PHRASES = [
    "checking your browser",
    "just a moment",
    "performing a security check",
    "checking if the site connection is secure",
]

BLOCK_PHRASES = [
    "access denied",
    "you have been blocked",
    "too many requests",
    "unusual traffic",
    "automated access",
]

VISIBLE_IMAGE_PHRASES = [
    "select all images",
    "click each image",
    "verify you are human",
    "i am not a robot",
    "i'm not a robot",
    "hcaptcha",
    "recaptcha",
]

BEHAVIORAL_PHRASES = [
    "turnstile",
    "recaptcha v3",
    "security check failed",
    "suspicious traffic",
]


def _contains_any(text: str, phrases: list[str]) -> list[str]:
    lower = (text or "").lower()
    return [p for p in phrases if p in lower]


def _provider_from_frames(frames: list[str]) -> tuple[str | None, str | None]:
    blob = " ".join((x or "").lower() for x in frames)
    if "challenges.cloudflare.com" in blob or "turnstile" in blob:
        return "cloudflare", "turnstile"
    if "google.com/recaptcha" in blob or "recaptcha" in blob:
        if "enterprise" in blob or "api2/anchor" not in blob:
            return "google", "recaptcha_v3_or_enterprise"
        return "google", "recaptcha_v2"
    if "hcaptcha" in blob:
        return "hcaptcha", "checkbox_or_grid"
    return None, None


async def detect_challenge(
    page: Any,
    *,
    max_text_chars: int = 6000,
) -> DetectedChallenge | None:
    try:
        probe = await page.evaluate(
            """
            (() => {
                const title = (document.title || '').toString();
                const body = document.body;
                const text = (body && body.innerText ? body.innerText : '').toString()
                    .replace(/\\s+/g, ' ')
                    .trim()
                    .slice(0, MAX_CHARS);
                const frames = Array.from(document.querySelectorAll('iframe'))
                    .map(f => (f.src || '').toString())
                    .filter(Boolean)
                    .slice(0, 40);
                return { title, text, frames };
            })()
            """.replace("MAX_CHARS", str(max(200, min(max_text_chars, 40_000))))
        )
    except Exception:
        return None

    if not isinstance(probe, dict):
        return None
    title = str(probe.get("title") or "")
    text = str(probe.get("text") or "")
    frames_raw = probe.get("frames") or []
    frames = [str(x) for x in frames_raw if x]
    combined = f"{title}\n{text}".lower()
    url = str(getattr(page, "url", "") or "")

    interstitial_hits = _contains_any(combined, INTERSTITIAL_PHRASES)
    block_hits = _contains_any(combined, BLOCK_PHRASES)
    visible_hits = _contains_any(combined, VISIBLE_IMAGE_PHRASES)
    behavioral_hits = _contains_any(combined, BEHAVIORAL_PHRASES)
    provider, variant = _provider_from_frames(frames)

    frame_blob = " ".join(x.lower() for x in frames)
    has_recaptcha_frame = "recaptcha" in frame_blob
    has_hcaptcha_frame = "hcaptcha" in frame_blob
    has_turnstile_frame = "turnstile" in frame_blob or "challenges.cloudflare.com" in frame_blob

    if block_hits:
        return DetectedChallenge(
            kind="blocked",
            provider=provider,
            variant=variant,
            confidence=0.9,
            matched=block_hits[:6],
            url=url,
            title=title,
            text_snippet=text,
            frame_urls=frames,
        )

    if interstitial_hits and not (has_recaptcha_frame or has_hcaptcha_frame or has_turnstile_frame):
        return DetectedChallenge(
            kind="interstitial_wait",
            provider=provider,
            variant=variant,
            confidence=0.8,
            matched=interstitial_hits[:6],
            url=url,
            title=title,
            text_snippet=text,
            frame_urls=frames,
        )

    if has_turnstile_frame or "turnstile" in behavioral_hits:
        return DetectedChallenge(
            kind="behavioral_or_invisible",
            provider=provider or "cloudflare",
            variant=variant or "turnstile",
            confidence=0.85,
            matched=(behavioral_hits or ["turnstile"])[:6],
            url=url,
            title=title,
            text_snippet=text,
            frame_urls=frames,
        )

    if has_recaptcha_frame:
        if "v3" in combined or "score-based" in combined or "enterprise" in frame_blob:
            return DetectedChallenge(
                kind="behavioral_or_invisible",
                provider=provider or "google",
                variant=variant or "recaptcha_v3_or_enterprise",
                confidence=0.8,
                matched=(behavioral_hits or ["recaptcha"])[:6],
                url=url,
                title=title,
                text_snippet=text,
                frame_urls=frames,
            )
        return DetectedChallenge(
            kind="visible_image",
            provider=provider or "google",
            variant=variant or "recaptcha_v2",
            confidence=0.85,
            matched=(visible_hits or ["recaptcha"])[:6],
            url=url,
            title=title,
            text_snippet=text,
            frame_urls=frames,
        )

    if has_hcaptcha_frame or "hcaptcha" in combined:
        return DetectedChallenge(
            kind="visible_image",
            provider=provider or "hcaptcha",
            variant=variant or "checkbox_or_grid",
            confidence=0.85,
            matched=(visible_hits or ["hcaptcha"])[:6],
            url=url,
            title=title,
            text_snippet=text,
            frame_urls=frames,
        )

    if visible_hits:
        return DetectedChallenge(
            kind="visible_image",
            provider=provider,
            variant=variant or "checkbox_or_grid",
            confidence=0.65,
            matched=visible_hits[:6],
            url=url,
            title=title,
            text_snippet=text,
            frame_urls=frames,
        )

    if behavioral_hits:
        return DetectedChallenge(
            kind="behavioral_or_invisible",
            provider=provider,
            variant=variant,
            confidence=0.65,
            matched=behavioral_hits[:6],
            url=url,
            title=title,
            text_snippet=text,
            frame_urls=frames,
        )

    return None
