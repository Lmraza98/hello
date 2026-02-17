"""Google browser research workflows built on generic browser primitives."""

from __future__ import annotations

from dataclasses import dataclass
import random
import os
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

from api.routes.browser_nav import (
    BrowserActRequest,
    BrowserFindRefRequest,
    BrowserNavigateRequest,
    BrowserSnapshotRequest,
    BrowserWaitRequest,
    browser_act,
    browser_find_ref,
    browser_navigate,
    browser_snapshot,
    browser_wait,
)


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _as_dict_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _normalize_outbound_url(raw_url: str) -> str:
    text = _clean_text(raw_url)
    if not text:
        return ""

    parsed = urlparse(text)
    host = parsed.netloc.lower()
    if host.endswith("google.com") and parsed.path == "/url":
        q = parse_qs(parsed.query).get("q", [])
        if q:
            return unquote(q[0]).strip()
    return text


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on", "y"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _is_google_host(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    return host.endswith("google.com")


def _is_probable_ad(label: str, href: str) -> bool:
    lower_label = label.lower()
    if lower_label == "ad" or lower_label.startswith("ads"):
        return True
    if "googleadservices.com" in href.lower():
        return True
    return False


def _extract_organic_results(snapshot: dict[str, Any], *, limit: int) -> list[dict[str, Any]]:
    refs = _as_dict_list(snapshot.get("refs"))
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in refs:
        if len(rows) >= limit:
            break
        raw_href = _clean_text(item.get("href") or item.get("url"))
        href = _normalize_outbound_url(raw_href)
        if not href:
            continue
        if _is_google_host(href):
            continue

        label = _clean_text(item.get("label") or item.get("text"))
        if not label or len(label) < 4:
            continue
        if _is_probable_ad(label, href):
            continue

        key = href.split("#", 1)[0]
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "rank": len(rows) + 1,
                "title": label,
                "url": href,
                "snippet": _clean_text(item.get("subtitle")),
            }
        )
    return rows


class GoogleHumanVerificationRequired(RuntimeError):
    def __init__(self, message: str, *, url: str | None = None):
        super().__init__(message)
        self.url = url or ""


def _is_human_verification_page(snapshot: dict[str, Any]) -> bool:
    text = _clean_text(snapshot.get("snapshot_text")).lower()
    url = _clean_text(snapshot.get("url")).lower()
    indicators = (
        "our systems have detected unusual traffic",
        "this page checks to see if it's really you",
        "sorry, but your computer or network may be sending automated queries",
        "recaptcha",
        "/sorry/index",
    )
    if any(token in text for token in indicators):
        return True
    if any(token in url for token in ("/sorry/index", "captcha")):
        return True
    return False


def _char_to_key(char: str) -> str:
    if char == " ":
        return "Space"
    return char


def _wrong_char_for(char: str) -> str:
    if char.isalpha():
        alphabet = "abcdefghijklmnopqrstuvwxyz"
        pool = [c for c in alphabet if c != char.lower()]
        return random.choice(pool) if pool else char
    if char.isdigit():
        digits = "0123456789"
        pool = [d for d in digits if d != char]
        return random.choice(pool) if pool else char
    return char


def _build_human_typing_keystrokes(
    query: str,
    *,
    typo_enabled: bool,
    typo_probability: float,
) -> list[str]:
    out: list[str] = []
    probability = max(0.0, min(0.5, float(typo_probability)))
    for ch in query:
        if typo_enabled and ch.isalnum() and random.random() < probability:
            wrong = _wrong_char_for(ch)
            out.append(_char_to_key(wrong))
            out.append("Backspace")
        out.append(_char_to_key(ch))
    return out


def _extract_ai_overview(snapshot: dict[str, Any]) -> tuple[bool, str | None, list[dict[str, str]]]:
    raw_snapshot_text = str(snapshot.get("snapshot_text") or "")
    lower = raw_snapshot_text.lower()
    has_ai_overview = "ai overview" in lower

    summary: str | None = None
    if has_ai_overview:
        lines = [line.strip() for line in raw_snapshot_text.splitlines() if line.strip()]
        start = -1
        for idx, line in enumerate(lines):
            if "ai overview" in line.lower():
                start = idx
                break
        if start >= 0:
            summary_lines: list[str] = []
            for line in lines[start + 1 :]:
                lowered = line.lower()
                if len(summary_lines) >= 4:
                    break
                if lowered.startswith(("people also ask", "images", "videos", "shopping", "news")):
                    break
                summary_lines.append(line)
            if summary_lines:
                summary = " ".join(summary_lines).strip()

    citations: list[dict[str, str]] = []
    if has_ai_overview:
        refs = _as_dict_list(snapshot.get("refs"))
        seen: set[str] = set()
        for item in refs:
            raw_href = _clean_text(item.get("href") or item.get("url"))
            href = _normalize_outbound_url(raw_href)
            if not href or _is_google_host(href):
                continue
            title = _clean_text(item.get("label") or item.get("text"))
            if not title:
                continue
            norm = href.split("#", 1)[0]
            if norm in seen:
                continue
            seen.add(norm)
            citations.append({"title": title, "url": href})
            if len(citations) >= 6:
                break

    return has_ai_overview, summary, citations


@dataclass
class GoogleSearchWorkflowResult:
    query: str
    tab_id: str | None
    url: str
    ai_overview_present: bool
    ai_overview_summary: str | None
    ai_overview_citations: list[dict[str, str]]
    organic_results: list[dict[str, Any]]
    source_strategy: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "tab_id": self.tab_id,
            "url": self.url,
            "ai_overview_present": self.ai_overview_present,
            "ai_overview_summary": self.ai_overview_summary,
            "ai_overview_citations": self.ai_overview_citations,
            "organic_results": self.organic_results,
            "source_strategy": self.source_strategy,
        }


async def _search_with_input(query: str, tab_id: str | None) -> str | None:
    roles = ["combobox", "searchbox", "textbox", "input", None]
    ref: str | None = None
    for role in roles:
        try:
            found = await browser_find_ref(
                BrowserFindRefRequest(
                    text="Search",
                    role=role,
                    tab_id=tab_id,
                    timeout_ms=2500,
                    poll_ms=300,
                )
            )
        except Exception:
            continue
        candidate = _clean_text((found or {}).get("ref") if isinstance(found, dict) else "")
        if candidate:
            ref = candidate
            if isinstance(found, dict) and found.get("tab_id"):
                tab_id = str(found["tab_id"])
            break

    if not ref:
        return tab_id

    # Human-like cadence: hesitation -> focus -> optional typo/correction keystrokes -> submit.
    await browser_wait(BrowserWaitRequest(ms=random.randint(220, 680), tab_id=tab_id))
    typo_enabled = _env_bool("GOOGLE_MICRO_TYPO_ENABLED", True)
    typo_probability = _env_float("GOOGLE_MICRO_TYPO_PROBABILITY", 0.08)
    use_keystrokes = _env_bool("GOOGLE_KEYPRESS_TYPING_ENABLED", True)

    if use_keystrokes:
        try:
            await browser_act(BrowserActRequest(ref=ref, action="click", tab_id=tab_id))
            await browser_wait(BrowserWaitRequest(ms=random.randint(70, 180), tab_id=tab_id))
            await browser_act(BrowserActRequest(ref=ref, action="press", value="Control+A", tab_id=tab_id))
            await browser_act(BrowserActRequest(ref=ref, action="press", value="Backspace", tab_id=tab_id))
            await browser_wait(BrowserWaitRequest(ms=random.randint(80, 180), tab_id=tab_id))
            for key in _build_human_typing_keystrokes(
                query,
                typo_enabled=typo_enabled,
                typo_probability=typo_probability,
            ):
                await browser_act(BrowserActRequest(ref=ref, action="press", value=key, tab_id=tab_id))
                await browser_wait(BrowserWaitRequest(ms=random.randint(35, 140), tab_id=tab_id))
        except Exception:
            # Safe fallback: if keypress typing fails on a backend/site, use regular type.
            await browser_act(BrowserActRequest(ref=ref, action="type", value=query, tab_id=tab_id))
    else:
        await browser_act(BrowserActRequest(ref=ref, action="type", value=query, tab_id=tab_id))

    await browser_wait(BrowserWaitRequest(ms=random.randint(180, 520), tab_id=tab_id))
    await browser_act(BrowserActRequest(ref=ref, action="press", value="Enter", tab_id=tab_id))
    return tab_id


async def google_search_workflow(
    *,
    query: str,
    tab_id: str | None = None,
    max_results: int = 5,
    wait_for_ai_overview_ms: int = 8000,
) -> dict[str, Any]:
    cleaned_query = _clean_text(query)
    if not cleaned_query:
        raise ValueError("query is required")

    navigate = await browser_navigate(BrowserNavigateRequest(url="https://www.google.com", tab_id=tab_id))
    if isinstance(navigate, dict) and navigate.get("tab_id"):
        tab_id = str(navigate["tab_id"])
    await browser_wait(BrowserWaitRequest(ms=random.randint(350, 950), tab_id=tab_id))

    try:
        tab_id = await _search_with_input(cleaned_query, tab_id)
    except Exception:
        fallback_url = f"https://www.google.com/search?q={quote_plus(cleaned_query)}&hl=en"
        navigate = await browser_navigate(BrowserNavigateRequest(url=fallback_url, tab_id=tab_id))
        if isinstance(navigate, dict) and navigate.get("tab_id"):
            tab_id = str(navigate["tab_id"])

    snapshot_mode = "ai"
    interval_ms = 900
    waited_ms = 0
    latest_snapshot: dict[str, Any] = {}
    ai_overview_present = False
    ai_overview_summary: str | None = None
    ai_overview_citations: list[dict[str, str]] = []

    while waited_ms <= max(0, int(wait_for_ai_overview_ms)):
        snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=tab_id, mode=snapshot_mode))
        latest_snapshot = snap if isinstance(snap, dict) else {}
        if latest_snapshot.get("tab_id"):
            tab_id = str(latest_snapshot["tab_id"])
        if _is_human_verification_page(latest_snapshot):
            raise GoogleHumanVerificationRequired(
                "Google requires human verification for this browser session.",
                url=_clean_text(latest_snapshot.get("url")),
            )
        ai_overview_present, ai_overview_summary, ai_overview_citations = _extract_ai_overview(latest_snapshot)
        if ai_overview_present:
            break
        if waited_ms >= wait_for_ai_overview_ms:
            break
        await browser_wait(BrowserWaitRequest(ms=interval_ms, tab_id=tab_id))
        waited_ms += interval_ms

    organic_results = _extract_organic_results(latest_snapshot, limit=max(1, min(int(max_results), 20)))
    final_url = _clean_text(latest_snapshot.get("url")) or _clean_text((navigate or {}).get("url"))
    result = GoogleSearchWorkflowResult(
        query=cleaned_query,
        tab_id=tab_id,
        url=final_url,
        ai_overview_present=bool(ai_overview_present),
        ai_overview_summary=ai_overview_summary,
        ai_overview_citations=ai_overview_citations,
        organic_results=organic_results,
        source_strategy="ai_overview_then_organic",
    )
    return result.to_dict()
