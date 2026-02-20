"""Generic skill-driven browser workflow engine (LeadPilot-style).

All website-specific knowledge (entry URLs, element find hints, extraction patterns)
lives in markdown skills under `skills/` and is loaded via `services.web_automation.browser.skills.store`.

This module only orchestrates generic primitives exposed by `api.routes.browser_nav`:
- navigate
- snapshot
- find_ref
- act (click/type/press)
- wait
"""

from __future__ import annotations

import datetime as dt
import logging
import asyncio
import os
import random
import re
from typing import Any

from fastapi import HTTPException

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
    browser_tabs,
    browser_wait,
)
from services.web_automation.browser.skills.store import append_repair_note, get_action_hints, get_skill, match_skill
from services.web_automation.browser.challenges.classifiers import classify_challenge
from services.web_automation.browser.challenges.handler import handle_challenge_if_present
from services.web_automation.browser.challenges.resolver_config import ChallengeResolverConfig
from services.web_automation.browser.core.stealth import (
    StealthConfig,
    action_delay,
    human_click,
    human_delay,
    human_scroll,
    human_type,
)
from services.web_automation.browser.core.policy import AgentState, BrowserPolicy

logger = logging.getLogger(__name__)


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_list_of_dicts(value: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(value):
        if isinstance(item, dict):
            out.append(item)
    return out


def _as_string_list(value: Any) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, list):
        return [str(v).strip() for v in value if isinstance(v, str) and v.strip()]
    return []


def _as_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except Exception:
        return fallback


def _as_bool_flag(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y", "on"}:
            return True
        if lowered in {"false", "0", "no", "n", "off"}:
            return False
    return default


def _role_candidates_for_input(role: str | None) -> list[str | None]:
    cleaned = _clean_text(role).lower() or None
    inputish = ["input", "combobox", "textbox", "searchbox"]
    if cleaned in inputish:
        ordered: list[str | None] = [cleaned]
        ordered.extend([r for r in inputish if r != cleaned])
        ordered.append(None)
        return ordered
    if cleaned:
        return [cleaned, None]
    return [None]


def _label_is_banned(
    label: str,
    *,
    banned_prefixes: list[str],
    banned_contains: list[str],
    banned_exact: list[str],
    min_len: int,
) -> bool:
    text = _clean_text(label)
    lower = text.lower().strip()
    if not lower or len(lower) < min_len:
        return True
    if banned_exact:
        if lower in {x.lower().strip() for x in banned_exact if x}:
            return True
    for p in banned_prefixes:
        if p and lower.startswith(p.lower().strip()):
            return True
    for c in banned_contains:
        if c and c.lower().strip() in lower:
            return True
    return False


def _strip_suffixes(label: str, suffixes: list[str]) -> str:
    text = _clean_text(label)
    lower = text.lower()
    for suf in suffixes:
        s = (suf or "").strip().lower()
        if not s:
            continue
        if lower.endswith(s):
            text = text[: -len(s)].strip()
            lower = text.lower()
    return text


def _normalize_for_match(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _score_name_match(candidate: str, target: str) -> int:
    c = _normalize_for_match(candidate)
    t = _normalize_for_match(target)
    if not c or not t:
        return 0
    if c == t:
        return 100
    if t in c:
        return 80
    c_tokens = {x for x in c.split() if len(x) >= 2}
    t_tokens = [x for x in t.split() if len(x) >= 2]
    if not c_tokens or not t_tokens:
        return 0
    return min(70, sum(1 for x in t_tokens if x in c_tokens) * 15)


class BrowserWorkflow:
    """Generic, skill-driven browser workflow engine."""

    def __init__(self, *, tab_id: str | None = None, stealth: StealthConfig | None = None):
        self.tab_id = tab_id
        self.skill_id: str | None = None
        self.skill_meta: dict[str, Any] = {}
        self.frontmatter: dict[str, Any] = {}
        self.stealth = stealth or StealthConfig()
        # Default to policy-constrained interaction without fingerprint spoofing.
        if os.getenv("BROWSER_STEALTH_ENABLED", "false").strip().lower() in {"false", "0", "no", "off"}:
            self.stealth.enabled = False
        self.policy = BrowserPolicy()
        # Small debug breadcrumbs for UI/logging. Keep it compact.
        self.last_debug: dict[str, Any] = {}
        self.challenge_config = ChallengeResolverConfig.from_env()

    async def current_url(self) -> str | None:
        if not self.tab_id:
            return None
        tabs = await browser_tabs()
        for row in _as_list_of_dicts(tabs.get("tabs") if isinstance(tabs, dict) else None):
            if str(row.get("id") or "") == self.tab_id:
                url = row.get("url")
                return str(url) if isinstance(url, str) else None
        return None

    async def bind_skill(
        self,
        *,
        task: str,
        url: str | None = None,
        query: str | None = None,
        observation: dict[str, Any] | None = None,
    ) -> bool:
        """Bind this workflow to a matched skill (based on url/task/query)."""
        url = url or await self.current_url()
        matched = match_skill(url=url, task=task, query=query, observation=observation)
        if (not isinstance(matched, dict) or not matched.get("skill_id")) and observation is None and self.tab_id:
            # Fallback: lightweight runtime fingerprint from current role snapshot.
            try:
                snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=self.tab_id, mode="role"))
                obs = {
                    "url": url or (snap.get("url") if isinstance(snap, dict) else "") or "",
                    "dom": {
                        "role_refs": (snap.get("refs") if isinstance(snap, dict) and isinstance(snap.get("refs"), list) else []),
                        "semantic_nodes": [],
                    },
                }
                matched = match_skill(url=url, task=task, query=query, observation=obs)
            except Exception:
                matched = None
        if not isinstance(matched, dict) or not matched.get("skill_id"):
            return False
        self.skill_id = str(matched["skill_id"])
        self.skill_meta = matched
        skill = get_skill(self.skill_id)
        if isinstance(skill, dict):
            fm = skill.get("frontmatter")
            self.frontmatter = fm if isinstance(fm, dict) else {}
        else:
            self.frontmatter = {}
        # Merge skill-level stealth overrides into the workflow config.
        if self.frontmatter:
            self.stealth = StealthConfig.from_frontmatter(self.frontmatter)
            if os.getenv("BROWSER_STEALTH_ENABLED", "false").strip().lower() in {"false", "0", "no", "off"}:
                self.stealth.enabled = False
        return True

    async def _enforce_policy(self, action_type: str) -> None:
        wait_s = self.policy.wait_seconds_for(action_type)
        if wait_s > 0:
            self.last_debug.setdefault("policy_waits", []).append(
                {"action": action_type, "wait_ms": int(wait_s * 1000)}
            )
            await asyncio.sleep(wait_s)
        # Consume after waiting; if still blocked, record and continue with a tiny backoff.
        if not self.policy.consume(action_type):
            self.last_debug.setdefault("policy_blocked", []).append(action_type)
            await asyncio.sleep(0.35)

    def _repair(self, issue: str, *, action: str | None = None, context: dict[str, Any] | None = None) -> None:
        if not self.skill_id:
            return
        try:
            append_repair_note(self.skill_id, issue, action=action, context=context)
        except Exception:
            logger.debug("append_repair_note failed", exc_info=True)

    async def _raw_page(self) -> Any | None:
        """Return the raw Playwright page for the current tab (local mode only).

        Returns ``None`` if running in proxy mode or if the session isn't
        established yet.  Callers must tolerate ``None`` gracefully.
        """
        try:
            from services.web_automation.browser.backends.factory import get_browser_backend

            backend = get_browser_backend()
            get_raw = getattr(backend, "get_raw_page", None)
            if not callable(get_raw):
                return None
            return await get_raw(self.tab_id)
        except Exception:
            return None

    async def navigate(self, url: str, *, timeout_ms: int | None = None) -> dict[str, Any]:
        await self._enforce_policy("navigate")
        out = await browser_navigate(BrowserNavigateRequest(url=url, tab_id=self.tab_id, timeout_ms=timeout_ms))
        if isinstance(out, dict) and out.get("tab_id"):
            self.tab_id = str(out["tab_id"])
        lower_url = str((out.get("url") if isinstance(out, dict) else "") or url).lower()
        if "/sales/" in lower_url:
            self.policy.transition(AgentState.HOME_READY)
        else:
            self.policy.transition(AgentState.AUTH_CHECK)
        # Auto-resolve challenges after every navigation.
        await self._auto_resolve_challenges()
        return out if isinstance(out, dict) else {"ok": True, "tab_id": self.tab_id, "url": url}

    async def _auto_resolve_challenges(self) -> bool:
        """Attempt to resolve any challenge on the current page.

        Returns True if the page is clear, False if resolution failed.
        This is called automatically after navigations and can be called
        manually at any point.
        """
        page = await self._raw_page()
        if page is None:
            # Proxy mode or no session — fall back to the old wait-through approach.
            return True
        await asyncio.sleep(0.8)
        handled = await handle_challenge_if_present(
            page,
            cfg=self.stealth,
            config=self.challenge_config,
        )
        if handled.resolved:
            self.last_debug.pop("challenge", None)
        else:
            self.last_debug["challenge"] = {
                "resolved": False,
                "url": str(getattr(page, "url", "") or ""),
                "mode": handled.mode,
                "reason": handled.reason,
                "detection": handled.detection,
            }
            self.policy.note_friction()
            self.policy.transition(AgentState.RECOVERY)
        return handled.resolved

    async def probe_page(self, *, max_text_chars: int = 4000) -> dict[str, Any]:
        """Lightweight page probe for diagnostics + challenge detection."""
        if max_text_chars <= 0:
            max_text_chars = 1
        if max_text_chars > 20_000:
            max_text_chars = 20_000
        try:
            evaluated = await browser_act(
                BrowserActRequest(
                    action="evaluate",
                    value=(
                        """
(() => {
  const title = (document.title || '').toString();
  const body = document.body;
  const text = (body && body.innerText ? body.innerText : '').toString();
  const frames = Array.from(document.querySelectorAll('iframe')).map((f) => f.src || '').filter(Boolean).slice(0, 20);
  return {
    title,
    text_snippet: text.replace(/\\s+/g, ' ').trim().slice(0, MAX_CHARS),
    frame_urls: frames,
  };
})()
                        """.replace("MAX_CHARS", str(max_text_chars)).strip()
                    ),
                    tab_id=self.tab_id,
                )
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc), "tab_id": self.tab_id, "url": (await self.current_url()) or ""}

        if isinstance(evaluated, dict) and evaluated.get("tab_id"):
            self.tab_id = str(evaluated["tab_id"])

        obj = evaluated.get("result") if isinstance(evaluated, dict) else None
        payload = obj if isinstance(obj, dict) else {}
        return {
            "ok": True,
            "tab_id": self.tab_id,
            "url": (await self.current_url()) or (evaluated.get("url") if isinstance(evaluated, dict) else "") or "",
            "title": payload.get("title") if isinstance(payload, dict) else "",
            "text_snippet": payload.get("text_snippet") if isinstance(payload, dict) else "",
            "frame_urls": payload.get("frame_urls") if isinstance(payload, dict) else [],
        }

    async def detect_challenge(self) -> dict[str, Any] | None:
        """Detect common anti-bot challenges and return structured metadata.

        This does not attempt to solve or bypass challenges. Callers should
        either wait (for transient interstitials) or request user intervention.
        """
        probe = await self.probe_page(max_text_chars=4000)
        if not isinstance(probe, dict) or not probe.get("ok"):
            return None
        match = classify_challenge(
            url=str(probe.get("url") or ""),
            title=str(probe.get("title") or ""),
            text_snippet=str(probe.get("text_snippet") or ""),
            frame_urls=probe.get("frame_urls") if isinstance(probe.get("frame_urls"), list) else None,
        )
        if not match:
            return None
        return {
            "kind": match.kind,
            "confidence": match.confidence,
            "matched": match.matched,
            "url": probe.get("url") or "",
            "title": probe.get("title") or "",
        }

    async def wait_through_interstitials(
        self,
        *,
        max_wait_ms: int = 25_000,
        poll_ms: int = 1_600,
    ) -> dict[str, Any] | None:
        """Detect and attempt to resolve any challenge on the current page.

        Returns:
        - None if no challenge was detected (or it was resolved)
        - A challenge dict only if resolution failed after all retries
        """
        # First try the active resolver (works on raw Playwright page).
        page = await self._raw_page()
        if page is not None:
            handled = await handle_challenge_if_present(
                page,
                cfg=self.stealth,
                config=self.challenge_config,
            )
            if handled.resolved:
                self.last_debug.pop("challenge", None)
                return None
            if handled.detection:
                enriched = {
                    **handled.detection,
                    "resolver_mode": handled.mode,
                    "resolver_reason": handled.reason,
                    "resolver_attempts": handled.attempts,
                    "resolver_latency_ms": handled.latency_ms,
                }
                self.last_debug["challenge"] = enriched
                if handled.reason == "human_handoff_timeout":
                    return {**enriched, "kind": "human_handoff_timeout"}
                return enriched

        deadline = asyncio.get_event_loop().time() + max(0, min(int(max_wait_ms), 120_000)) / 1000.0
        poll = max(800, min(int(poll_ms), 10_000))

        last: dict[str, Any] | None = None
        while True:
            challenge = await self.detect_challenge()
            if not challenge:
                self.last_debug.pop("challenge", None)
                return None
            self.last_debug["challenge"] = challenge
            last = challenge

            if challenge.get("kind") == "interstitial_wait":
                if asyncio.get_event_loop().time() >= deadline:
                    return {
                        **challenge,
                        "kind": "interstitial_timeout",
                    }
                jitter = random.randint(-250, 250)
                await self.wait(max(500, poll + jitter))
                continue

            return challenge

    async def dismiss_common_overlays(self, *, max_passes: int = 3) -> dict[str, Any]:
        """Best-effort close of generic overlays/drawers/modals.

        Intentionally site-agnostic. Helps workflows recover when an action
        opens an unrelated drawer that blocks results.
        """
        closed: list[dict[str, Any]] = []
        for _ in range(max(1, max_passes)):
            # Many UIs close dialogs on ESC.
            try:
                await browser_act(
                    BrowserActRequest(ref=0, action="press", value="Escape", tab_id=self.tab_id)
                )
            except Exception:
                pass

            try:
                refs = await self.snapshot()
            except Exception:
                refs = []

            candidates: list[str] = []
            for item in refs:
                label = _clean_text(item.get("label")).lower()
                role = _clean_text(item.get("role")).lower()
                if role not in {"button", "a", "link", "div", "span"}:
                    continue
                if not label:
                    continue
                if (
                    "close" in label
                    or label == "x"
                    or "dismiss" in label
                    or label == "cancel"
                    or label.startswith("cancel ")
                ):
                    ref = item.get("ref")
                    if ref is not None:
                        candidates.append(str(ref))

            if not candidates:
                break

            clicked_any = False
            for ref in candidates[:2]:
                try:
                    await browser_act(BrowserActRequest(ref=ref, action="click", tab_id=self.tab_id))
                    await self.wait(450)
                    closed.append({"ref": ref, "label": "close"})
                    clicked_any = True
                except Exception:
                    continue
            if not clicked_any:
                break

        return {"attempted": True, "closed": closed, "count": len(closed)}

    async def navigate_to_entry(self, *, timeout_ms: int | None = None) -> bool:
        """Navigate to the skill's entry URL, unless already on a matching page."""
        entry_url = self.frontmatter.get("entry_url")
        if not isinstance(entry_url, str) or not entry_url.strip():
            return False

        # Check if browser is already on a matching domain — skip navigation
        # to avoid clearing an existing search/results page.
        try:
            current = await self.current_url()
            if current:
                domains = self.frontmatter.get("domains") or []
                if isinstance(domains, list):
                    current_lower = current.lower()
                    for pattern in domains:
                        if isinstance(pattern, str) and pattern.strip().lower() in current_lower:
                            logger.info(
                                "Already on matching domain (%s), skipping navigation to entry URL",
                                pattern.strip(),
                            )
                            return True
        except Exception:
            pass

        await self.navigate(entry_url.strip(), timeout_ms=timeout_ms)
        return True

    async def wait(self, ms: int = 900) -> None:
        await browser_wait(BrowserWaitRequest(ms=max(100, min(int(ms), 60_000)), tab_id=self.tab_id))

    async def wait_jitter(
        self,
        base_ms: int = 900,
        *,
        variance_ratio: float = 0.35,
        min_ms: int = 200,
        max_ms: int = 60_000,
    ) -> int:
        """
        Wait with bounded jitter to avoid repetitive fixed-interval action cadence.
        Returns the effective wait time (ms).
        """
        base = max(50, int(base_ms))
        spread = max(0.0, float(variance_ratio)) * base
        sampled = int(random.gauss(base, spread))
        effective = max(int(min_ms), min(int(max_ms), sampled))
        await self.wait(effective)
        return effective

    async def wait_for_url_contains(self, needle: str, *, timeout_ms: int = 15_000, poll_ms: int = 400) -> bool:
        target = (needle or "").strip().lower()
        if not target:
            return False
        deadline = asyncio.get_event_loop().time() + max(100, timeout_ms) / 1000.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                url = ((await self.current_url()) or "").lower()
                if target in url:
                    return True
            except Exception:
                pass
            await self.wait(max(150, min(1200, poll_ms)))
        return False

    async def wait_for_salesnav_shell(self, *, timeout_ms: int = 20_000) -> bool:
        if not await self.wait_for_url_contains("/sales/", timeout_ms=timeout_ms, poll_ms=450):
            return False
        deadline = asyncio.get_event_loop().time() + max(1000, timeout_ms) / 1000.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                refs = await self.snapshot()
                for item in refs:
                    role = _clean_text(item.get("role")).lower()
                    label = _clean_text(item.get("label")).lower()
                    if role in {"input", "combobox", "searchbox", "textbox"} and "search" in label:
                        self.policy.transition(AgentState.HOME_READY)
                        return True
            except Exception:
                pass
            await self.wait(450)
        return False

    async def wait_for_results_container(self, *, timeout_ms: int = 20_000) -> bool:
        deadline = asyncio.get_event_loop().time() + max(1000, timeout_ms) / 1000.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                refs = await self.snapshot()
                for item in refs:
                    label = _clean_text(item.get("label")).lower()
                    if "results" in label and ("search" in label or "result" in label):
                        self.policy.transition(AgentState.RESULTS_READY)
                        return True
            except Exception:
                pass
            await self.wait(500)
        return False

    async def wait_for_company_cards(self, *, min_count: int = 1, timeout_ms: int = 20_000) -> bool:
        target = max(1, int(min_count))
        deadline = asyncio.get_event_loop().time() + max(1000, timeout_ms) / 1000.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                companies = await self.extract("company", max(10, target))
                if len(companies) >= target:
                    self.policy.transition(AgentState.RESULTS_READY)
                    return True
            except Exception:
                pass
            await self.wait(600)
        return False

    async def wait_for_lead_cards(self, *, min_count: int = 1, timeout_ms: int = 20_000) -> bool:
        target = max(1, int(min_count))
        deadline = asyncio.get_event_loop().time() + max(1000, timeout_ms) / 1000.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                leads = await self.extract("lead", max(10, target))
                if len(leads) >= target:
                    self.policy.transition(AgentState.RESULTS_READY)
                    return True
            except Exception:
                pass
            await self.wait(600)
        return False

    async def scroll(self, *, direction: str = "down", distance: int = 400) -> None:
        """Scroll the page with human-like variable speed."""
        page = await self._raw_page() if self.stealth.enabled else None
        if page is not None:
            await human_scroll(page, self.stealth, direction=direction, distance=distance)
        else:
            # Fallback: use evaluate for a simple scroll
            delta = distance if direction == "down" else -distance
            await browser_act(
                BrowserActRequest(
                    action="evaluate",
                    value=f"window.scrollBy(0, {delta})",
                    tab_id=self.tab_id,
                )
            )

    async def snapshot(self) -> list[dict[str, Any]]:
        snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=self.tab_id, mode="role"))
        if isinstance(snap, dict) and snap.get("tab_id"):
            self.tab_id = str(snap["tab_id"])
        refs = snap.get("refs") if isinstance(snap, dict) else None
        return _as_list_of_dicts(refs)

    async def _safe_find_ref(self, *, text: str, role: str | None, timeout_ms: int, poll_ms: int) -> str | None:
        try:
            out = await browser_find_ref(
                BrowserFindRefRequest(
                    text=text,
                    role=role,
                    tab_id=self.tab_id,
                    timeout_ms=timeout_ms,
                    poll_ms=poll_ms,
                )
            )
        except HTTPException as exc:
            if exc.status_code == 404:
                return None
            raise
        if isinstance(out, dict):
            ref = out.get("ref")
            if ref is not None:
                return str(ref)
        return None

    async def find_ref(self, action: str, *, timeout_ms: int = 6_000, poll_ms: int = 350) -> str | None:
        """Find a ref using only skill hints for the given action."""
        if not self.skill_id:
            return None
        hints = get_action_hints(self.skill_id, action) or []
        for hint in hints:
            text = _clean_text(hint.get("text"))
            if not text:
                continue
            role = _clean_text(hint.get("role")) or None
            ref = await self._safe_find_ref(text=text, role=role, timeout_ms=timeout_ms, poll_ms=poll_ms)
            if ref:
                return ref
        return None

    async def find_ref_or_repair(self, action: str, *, timeout_ms: int = 6_000, poll_ms: int = 350) -> str | None:
        ref = await self.find_ref(action, timeout_ms=timeout_ms, poll_ms=poll_ms)
        if not ref:
            self._repair(
                f"{action}_not_found",
                action=action,
                context={"tab_id": self.tab_id, "url": (await self.current_url()) or ""},
            )
            self.last_debug.setdefault("missing_actions", [])
            self.last_debug["missing_actions"].append(action)
        return ref

    async def click(self, action: str, *, timeout_ms: int = 6_000) -> bool:
        if not self.skill_id:
            return False
        await self._enforce_policy("click")

        # Try ALL hint variants. A ref can be found but still fail to click (overlay, drift),
        # so keep walking hints until one succeeds.
        hints = get_action_hints(self.skill_id, action) or []
        per_hint_timeout_ms = max(500, min(3_000, int(timeout_ms)))
        last_err: Exception | None = None

        for hint in hints:
            text = _clean_text(hint.get("text"))
            if not text:
                continue
            role = _clean_text(hint.get("role")) or None
            ref = await self._safe_find_ref(
                text=text,
                role=role,
                timeout_ms=per_hint_timeout_ms,
                poll_ms=350,
            )
            if not ref:
                continue
            try:
                await browser_act(BrowserActRequest(ref=ref, action="click", tab_id=self.tab_id))
                await action_delay(self.stealth)
                return True
            except Exception as exc:
                last_err = exc
                self.policy.note_friction()
                continue

        if not hints:
            # Keep repair semantics consistent with other action-resolution methods.
            self._repair(
                f"{action}_not_found",
                action=action,
                context={"tab_id": self.tab_id, "url": (await self.current_url()) or ""},
            )
        else:
            # We had hints but none worked; log drift/failure so the skill can be repaired.
            self._repair(
                f"{action}_failed_all_hints",
                action=action,
                context={
                    "tab_id": self.tab_id,
                    "url": (await self.current_url()) or "",
                    "attempted_hints": [{"role": h.get("role"), "text": h.get("text")} for h in hints][:8],
                    "last_error": str(last_err) if last_err else "",
                },
            )
        logger.exception("click failed action=%s", action, exc_info=last_err)
        return False

    async def fill_input(
        self,
        action: str,
        value: str,
        *,
        submit: bool = True,
        timeout_ms: int = 10_000,
        submit_key: str = "Enter",
    ) -> bool:
        if not self.skill_id:
            return False
        await self._enforce_policy("type")

        # Try ALL hint variants. SalesNav (and other sites) often shifts placeholder/label
        # text between UI states. Also, a ref can be found but still fail to type due to
        # overlays or focus traps, so keep walking hints until one succeeds.
        hints = get_action_hints(self.skill_id, action) or []
        per_hint_timeout_ms = max(800, min(3_000, int(timeout_ms)))
        last_err: Exception | None = None

        for hint in hints:
            text = _clean_text(hint.get("text"))
            if not text:
                continue
            base_role = _clean_text(hint.get("role")) or None
            for role in _role_candidates_for_input(base_role):
                ref = await self._safe_find_ref(
                    text=text,
                    role=role,
                    timeout_ms=per_hint_timeout_ms,
                    poll_ms=350,
                )
                if not ref:
                    continue
                try:
                    await browser_act(BrowserActRequest(ref=ref, action="type", value=value, tab_id=self.tab_id))
                    if submit:
                        await self._enforce_policy("type")
                        await browser_act(BrowserActRequest(ref=ref, action="press", value=submit_key, tab_id=self.tab_id))
                    self.policy.transition(AgentState.SEARCH)
                    await action_delay(self.stealth)
                    return True
                except Exception as exc:
                    last_err = exc
                    self.policy.note_friction()
                    continue

        if not hints:
            self._repair(
                f"{action}_not_found",
                action=action,
                context={"tab_id": self.tab_id, "url": (await self.current_url()) or ""},
            )
        else:
            self._repair(
                f"{action}_failed_all_hints",
                action=action,
                context={
                    "tab_id": self.tab_id,
                    "url": (await self.current_url()) or "",
                    "attempted_hints": [{"role": h.get("role"), "text": h.get("text")} for h in hints][:8],
                    "last_error": str(last_err) if last_err else "",
                },
            )
        logger.exception("fill_input failed action=%s", action, exc_info=last_err)
        return False

    async def click_and_follow_tab(self, action: str, *, wait_ms: int = 1200) -> bool:
        """Click an element; if it opens a new tab, switch to it."""
        await self._enforce_policy("tab")
        raw = await browser_tabs()
        before_ids = {str(t.get("id") or "") for t in _as_list_of_dicts(raw.get("tabs") if isinstance(raw, dict) else None) if t.get("id")}

        ok = await self.click(action)
        if not ok:
            return False
        await self.wait(wait_ms)

        raw2 = await browser_tabs()
        after = _as_list_of_dicts(raw2.get("tabs") if isinstance(raw2, dict) else None)
        for t in after:
            tid = str(t.get("id") or "")
            if tid and tid not in before_ids:
                self.tab_id = tid
                return True
        return True

    def _extract_rules(self, kind: str) -> dict[str, Any]:
        k = (kind or "").strip().lower()
        fm = self.frontmatter or {}
        return {
            "href_contains": _as_string_list(fm.get(f"extract_{k}_href_contains")),
            # Optional text-based extraction (for values not attached to links).
            # When present, recipes can extract from snapshot_text using regex.
            "text_regex": str(fm.get(f"extract_{k}_text_regex") or "").strip(),
            "text_flags": str(fm.get(f"extract_{k}_text_flags") or "").strip(),
            "text_group": fm.get(f"extract_{k}_text_group"),
            "banned_prefixes": _as_string_list(fm.get(f"extract_{k}_banned_prefixes")),
            "banned_contains": _as_string_list(fm.get(f"extract_{k}_banned_contains")),
            "banned_exact": _as_string_list(fm.get(f"extract_{k}_banned_exact")),
            "strip_suffixes": _as_string_list(fm.get(f"extract_{k}_strip_suffixes")),
            "min_label_len": _as_int(fm.get(f"extract_{k}_min_label_len"), 2),
            "label_field": str(fm.get(f"extract_{k}_label_field") or "name"),
            "url_field": str(fm.get(f"extract_{k}_url_field") or "url"),
        }

    def available_extract_kinds(self) -> list[str]:
        """Return all extract kinds supported by the matched skill.

        Discovers kinds by scanning frontmatter for keys like:
        - extract_<kind>_href_contains

        This keeps workflow recipes site-agnostic: they can auto-select a kind
        without hardcoding per-site task knowledge.
        """
        fm = self.frontmatter or {}
        kinds: list[str] = []
        for key, value in fm.items():
            if not isinstance(key, str):
                continue
            if key.startswith("extract_") and key.endswith("_href_contains"):
                # extract_<kind>_href_contains
                kind = key[len("extract_") : -len("_href_contains")].strip().lower()
                if kind and _as_string_list(value):
                    kinds.append(kind)
            if key.startswith("extract_") and key.endswith("_text_regex"):
                # extract_<kind>_text_regex
                kind = key[len("extract_") : -len("_text_regex")].strip().lower()
                if kind and isinstance(value, str) and value.strip():
                    kinds.append(kind)
        # stable order for determinism
        return sorted(set(kinds))

    def _compile_text_regex(self, *, pattern: str, flags: str) -> re.Pattern[str] | None:
        pat = (pattern or "").strip()
        if not pat:
            return None
        fl = 0
        flags = (flags or "").strip().lower()
        if "i" in flags:
            fl |= re.IGNORECASE
        if "m" in flags:
            fl |= re.MULTILINE
        if "s" in flags:
            fl |= re.DOTALL
        try:
            return re.compile(pat, fl)
        except Exception:
            return None

    def extract_from_snapshot_text(self, snapshot_text: str, kind: str, limit: int) -> list[dict[str, Any]]:
        rules = self._extract_rules(kind)
        regex = self._compile_text_regex(pattern=rules.get("text_regex") or "", flags=rules.get("text_flags") or "")
        if regex is None:
            return []

        label_field: str = rules["label_field"]
        url_field: str = rules["url_field"]
        group = rules.get("text_group")

        matches: list[dict[str, Any]] = []
        for m in regex.finditer(snapshot_text or ""):
            if len(matches) >= limit:
                break
            try:
                if isinstance(group, str) and group:
                    value = m.group(group)
                elif isinstance(group, int):
                    value = m.group(group)
                else:
                    value = m.group(1) if m.groups() else m.group(0)
            except Exception:
                value = m.group(0)

            text = _clean_text(value)
            if not text:
                continue
            if _label_is_banned(
                text,
                banned_prefixes=rules["banned_prefixes"],
                banned_contains=rules["banned_contains"],
                banned_exact=rules["banned_exact"],
                min_len=rules["min_label_len"],
            ):
                continue
            matches.append({
                label_field: text,
                url_field: "",
                "source_url": "",
                "extracted_at": dt.datetime.now(tz=dt.timezone.utc).isoformat(),
                "skill_id": self.skill_id or "",
                "match_score": self.skill_meta.get("match_score") if isinstance(self.skill_meta, dict) else None,
            })
        return matches

    def extract_from_refs(self, refs: list[dict[str, Any]], kind: str, limit: int) -> list[dict[str, Any]]:
        rules = self._extract_rules(kind)
        href_contains: list[str] = rules["href_contains"]
        if not href_contains:
            return []

        label_field: str = rules["label_field"]
        url_field: str = rules["url_field"]

        rows: list[dict[str, Any]] = []
        seen: set[str] = set()

        for item in refs:
            if len(rows) >= limit:
                break
            href = _clean_text(item.get("href"))
            if not href or not any(pat in href for pat in href_contains):
                continue
            raw_label = _clean_text(item.get("label"))
            name = _strip_suffixes(raw_label, rules["strip_suffixes"])
            if _label_is_banned(
                name,
                banned_prefixes=rules["banned_prefixes"],
                banned_contains=rules["banned_contains"],
                banned_exact=rules["banned_exact"],
                min_len=rules["min_label_len"],
            ):
                continue
            key = f"{name.lower()}|{href.split('?', 1)[0]}"
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                label_field: name,
                url_field: href,
                # Evidence / provenance fields — backward compatible.
                "source_url": href.split("?", 1)[0],
                "extracted_at": dt.datetime.now(tz=dt.timezone.utc).isoformat(),
                "skill_id": self.skill_id or "",
                "match_score": self.skill_meta.get("match_score") if isinstance(self.skill_meta, dict) else None,
            })
        return rows

    @staticmethod
    def _is_salesnav_company_url(url: str | None) -> bool:
        lower = _clean_text(url).lower()
        return "linkedin.com/sales/search/company" in lower

    async def _should_use_salesnav_company_dom_extract(self, kind: str) -> bool:
        if (kind or "").strip().lower() != "company":
            return False
        sid = _clean_text(self.skill_id).lower()
        if "salesnav" in sid:
            return True
        return self._is_salesnav_company_url(await self.current_url())

    @staticmethod
    def _clean_company_card_text(value: Any) -> str:
        return _clean_text(value)

    async def _extract_salesnav_company_cards_dom(self, limit: int) -> list[dict[str, Any]]:
        page = await self._raw_page()
        if page is None:
            return []

        script = """
(() => {
  const toText = (v) => (v || "").toString().replace(/\\s+/g, " ").trim();
  const abs = (href) => {
    const raw = toText(href);
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) return `https://www.linkedin.com${raw}`;
    return raw;
  };
  const cards = Array.from(document.querySelectorAll('li.artdeco-list__item'))
    .filter((li) => li.querySelector('[data-x-search-result="ACCOUNT"]'));
  return cards.map((card) => {
    const titleLink =
      card.querySelector('a[data-anonymize="company-name"]') ||
      card.querySelector('.artdeco-entity-lockup__title a[href*="/sales/company/"]') ||
      card.querySelector('a[href*="/sales/company/"]');
    const name = toText(titleLink?.textContent);
    const salesNavUrl = abs(titleLink?.getAttribute('href') || "");
    const industry = toText(card.querySelector('[data-anonymize="industry"]')?.textContent);
    const employees = toText(
      card.querySelector('a[data-anonymize="company-size"]')?.textContent ||
      card.querySelector('[aria-label*="employees"]')?.textContent
    );
    const location = toText(card.querySelector('[data-anonymize="location"]')?.textContent);
    const aboutNode = card.querySelector('[data-anonymize="person-blurb"]');
    const about = toText(aboutNode?.getAttribute('title') || aboutNode?.textContent || "");
    const priorities = Array.from(card.querySelectorAll('button[data-control-name*="search_spotlight_aiq"] span'))
      .map((el) => toText(el.textContent))
      .filter(Boolean);
    const controls = Array.from(card.querySelectorAll('[data-control-name]'))
      .map((el) => toText(el.getAttribute('data-control-name')))
      .filter(Boolean);
    const saveBtn = card.querySelector('button[aria-label*="Save"]');
    const allEmployeesLink = card.querySelector('a[href*="/sales/search/people?query="]');
    return {
      company_name: name,
      name,
      sales_nav_url: salesNavUrl,
      linkedin_url: salesNavUrl,
      industry,
      subtitle: industry,
      employee_count: employees,
      company_size: employees,
      location,
      about,
      strategic_priorities: priorities,
      interaction_map: {
        company_name_click: !!titleLink,
        company_logo_click: !!card.querySelector('a[data-control-name="view_company_via_result_image"]'),
        all_employees_click: !!allEmployeesLink,
        save_click: !!saveBtn,
        overflow_menu_click: !!card.querySelector('button[aria-label*="Open dropdown menu"]'),
        spotlight_click: priorities.length > 0,
      },
      control_names: controls,
      has_spotlight_ai: priorities.length > 0,
    };
  });
})()
        """.strip()
        try:
            rows = await page.evaluate(script)
        except Exception:
            return []

        parsed: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in _as_list_of_dicts(rows):
            name = self._clean_company_card_text(row.get("company_name") or row.get("name"))
            sales_nav_url = self._clean_company_card_text(row.get("sales_nav_url"))
            if sales_nav_url.startswith("/"):
                sales_nav_url = f"https://www.linkedin.com{sales_nav_url}"
            if not name:
                continue
            key = f"{name.lower()}|{sales_nav_url.split('?', 1)[0]}"
            if key in seen:
                continue
            seen.add(key)
            row["company_name"] = name
            row["name"] = name
            row["sales_nav_url"] = sales_nav_url
            row["linkedin_url"] = sales_nav_url
            row["source_url"] = sales_nav_url.split("?", 1)[0] if sales_nav_url else ""
            row["extracted_at"] = dt.datetime.now(tz=dt.timezone.utc).isoformat()
            row["skill_id"] = self.skill_id or ""
            row["match_score"] = self.skill_meta.get("match_score") if isinstance(self.skill_meta, dict) else None
            parsed.append(row)
            if len(parsed) >= limit:
                break
        return parsed

    async def _capture_salesnav_ai_summaries(self, rows: list[dict[str, Any]], max_cards: int = 8) -> None:
        page = await self._raw_page()
        if page is None:
            return
        target_count = max(0, min(int(max_cards), len(rows)))
        if target_count == 0:
            return

        for row in rows[:target_count]:
            name = _clean_text(row.get("company_name") or row.get("name"))
            if not name:
                continue
            try:
                card = None
                cards = page.locator("li.artdeco-list__item")
                total = await cards.count()
                for idx in range(min(total, 25)):
                    candidate = cards.nth(idx)
                    title = candidate.locator('a[data-anonymize="company-name"]').first
                    if await title.count() == 0:
                        continue
                    title_text = _clean_text(await title.inner_text())
                    if title_text.lower() == name.lower():
                        card = candidate
                        break
                if card is None:
                    continue
                spotlight_btn = card.locator('button[data-control-name*="search_spotlight_aiq"]').first
                if await spotlight_btn.count() == 0:
                    continue
                await spotlight_btn.click(timeout=1800)
                await asyncio.sleep(random.uniform(0.45, 0.9))

                heading = page.locator("text=Summarized by AI").first
                if await heading.count() == 0:
                    await page.keyboard.press("Escape")
                    await asyncio.sleep(random.uniform(0.18, 0.45))
                    continue

                summary_text = await heading.evaluate(
                    """
(el) => {
  const clean = (v) => (v || "").toString().replace(/\\s+/g, " ").trim();
  let node = el;
  for (let i = 0; i < 8 && node; i += 1) {
    const txt = clean(node.innerText || "");
    if (txt.length >= 80) return txt;
    node = node.parentElement;
  }
  return clean(el.innerText || "");
}
                    """.strip()
                )
                cleaned = _clean_text(summary_text).replace("Summarized by AI", "").strip(" .:-")
                if cleaned:
                    row["ai_summary"] = cleaned
                    row["has_ai_summary"] = True
                await page.keyboard.press("Escape")
                await asyncio.sleep(random.uniform(0.18, 0.45))
            except Exception:
                continue

    async def _extract_salesnav_companies_with_scroll(self, limit: int, *, max_scroll_passes: int = 10) -> list[dict[str, Any]]:
        all_rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        stagnant = 0
        passes = max(1, min(int(max_scroll_passes), 20))
        for _ in range(passes):
            visible_rows = await self._extract_salesnav_company_cards_dom(limit)
            added = 0
            for row in visible_rows:
                name = _clean_text(row.get("company_name") or row.get("name"))
                url = _clean_text(row.get("sales_nav_url") or row.get("linkedin_url"))
                if not name:
                    continue
                key = f"{name.lower()}|{url.split('?', 1)[0]}"
                if key in seen:
                    continue
                seen.add(key)
                all_rows.append(row)
                added += 1
                if len(all_rows) >= limit:
                    break
            if len(all_rows) >= limit:
                break
            if added == 0:
                stagnant += 1
            else:
                stagnant = 0
            if stagnant >= 2:
                break
            distance = random.randint(520, 980)
            try:
                await self.scroll(direction="down", distance=distance)
            except Exception:
                await self.wait_jitter(base_ms=700, variance_ratio=0.35, min_ms=300, max_ms=2200)
            await self.wait_jitter(base_ms=850, variance_ratio=0.4, min_ms=350, max_ms=2400)
        if all_rows:
            await self._capture_salesnav_ai_summaries(all_rows, max_cards=min(8, len(all_rows)))
        return all_rows[:limit]

    async def extract(self, kind: str, limit: int, *, retries: int = 3, retry_wait_ms: int = 900) -> list[dict[str, Any]]:
        rules = self._extract_rules(kind)
        if not (rules["href_contains"] or rules.get("text_regex")):
            return []
        if await self._should_use_salesnav_company_dom_extract(kind):
            dom_rows = await self._extract_salesnav_companies_with_scroll(max(1, min(int(limit), 200)))
            if dom_rows:
                return dom_rows
        for _ in range(max(1, retries)):
            # Extraction relies on link URL patterns (href_contains). In LeadPilot mode,
            # the role snapshot used for stable refs intentionally omits "/url:" lines.
            # Use the AI snapshot for extraction so refs include href when available.
            snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=self.tab_id, mode="ai"))
            if isinstance(snap, dict) and snap.get("tab_id"):
                self.tab_id = str(snap["tab_id"])
            refs = _as_list_of_dicts(snap.get("refs") if isinstance(snap, dict) else None)
            rows = self.extract_from_refs(refs, kind, limit)
            if not rows and rules.get("text_regex"):
                snapshot_text = str(snap.get("snapshot_text") or "") if isinstance(snap, dict) else ""
                rows = self.extract_from_snapshot_text(snapshot_text, kind, limit)
            if rows:
                return rows
            await self.wait(retry_wait_ms)
        return []

    async def paginate_and_extract(
        self,
        kind: str,
        limit: int,
        *,
        next_action: str = "pagination_next",
        max_pages: int = 12,
        page_wait_ms: int = 900,
    ) -> list[dict[str, Any]]:
        rules = self._extract_rules(kind)
        label_field: str = rules["label_field"]
        url_field: str = rules["url_field"]

        all_items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for _page in range(max_pages):
            snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=self.tab_id, mode="ai"))
            if isinstance(snap, dict) and snap.get("tab_id"):
                self.tab_id = str(snap["tab_id"])
            refs = _as_list_of_dicts(snap.get("refs") if isinstance(snap, dict) else None)
            page_rows = self.extract_from_refs(refs, kind, limit)
            added = 0
            for row in page_rows:
                name = _clean_text(row.get(label_field))
                href = _clean_text(row.get(url_field))
                if not name or not href:
                    continue
                key = f"{name.lower()}|{href.split('?', 1)[0]}"
                if key in seen:
                    continue
                seen.add(key)
                all_items.append(row)
                added += 1
                if len(all_items) >= limit:
                    break
            if len(all_items) >= limit:
                break
            if not await self.click(next_action, timeout_ms=3_500):
                break
            await self.wait_jitter(
                base_ms=page_wait_ms,
                variance_ratio=0.4,
                min_ms=500,
                max_ms=3000,
            )
            if hasattr(self, "page") and self.page:
                from services.web_automation.linkedin.salesnav.core.interaction import idle_drift
                await idle_drift(self.page, duration_seconds=random.uniform(0.8, 2.0))
            if added == 0:
                break
        return all_items

    async def apply_filter(self, filter_name: str, value: str) -> bool:
        """Apply a filter using skill-provided wiring in frontmatter.

        Expected frontmatter keys:
        - filter_<name>_expand_action: action name to click to expand/open filter panel
        - filter_<name>_input_action: action name to type into
        - filter_<name>_confirm_action: optional action name to click to confirm/apply (e.g. "Include")
        """
        nm = (filter_name or "").strip().lower()
        if not nm:
            return False
        steps: list[dict[str, Any]] = []
        expand_action = self.frontmatter.get(f"filter_{nm}_expand_action")
        input_action = self.frontmatter.get(f"filter_{nm}_input_action")
        confirm_action = self.frontmatter.get(f"filter_{nm}_confirm_action")
        submit_raw = self.frontmatter.get(f"filter_{nm}_submit")
        select_option_raw = self.frontmatter.get(f"filter_{nm}_select_option")
        option_role_raw = self.frontmatter.get(f"filter_{nm}_option_role")
        verify_raw = self.frontmatter.get(f"filter_{nm}_verify")

        submit = _as_bool_flag(submit_raw, True)
        select_option = _as_bool_flag(select_option_raw, False)

        option_role = None
        if isinstance(option_role_raw, str) and option_role_raw.strip():
            option_role = option_role_raw.strip()

        verify = _as_bool_flag(verify_raw, True)
        action_success = True

        if isinstance(expand_action, str) and expand_action.strip():
            ok = await self.click(expand_action.strip())
            steps.append({"step": "expand", "action": expand_action.strip(), "ok": ok})
            await self.wait(600)

        if isinstance(input_action, str) and input_action.strip():
            # Text-input filter (industry, location, etc.): type value then optionally select
            ok = await self.fill_input(input_action.strip(), value, submit=submit)
            steps.append(
                {"step": "type", "action": input_action.strip(), "ok": ok, "submit": submit}
            )
            if not ok:
                # Some SalesNav filter drawers expose clickable options even when the
                # text input is hidden/flaky. Try direct option selection as a fallback.
                if select_option:
                    await self.wait(450)
                    try:
                        fallback_roles: list[str | None] = []
                        if option_role:
                            fallback_roles.append(option_role)
                        fallback_roles.extend(["option", "button", None])
                        picked = False
                        for role_try in fallback_roles:
                            opt_ref = await self._safe_find_ref(
                                text=value,
                                role=role_try,
                                timeout_ms=2_200,
                                poll_ms=280,
                            )
                            if not opt_ref:
                                continue
                            await browser_act(BrowserActRequest(ref=opt_ref, action="click", tab_id=self.tab_id))
                            steps.append({"step": "select_option_without_input", "role": role_try, "ok": True})
                            picked = True
                            break
                        if not picked:
                            steps.append({"step": "select_option_without_input", "ok": False})
                            self.last_debug[f"filter_{nm}"] = {"value": value, "ok": False, "steps": steps}
                            return False
                    except Exception:
                        steps.append({"step": "select_option_without_input", "ok": False, "error": "exception"})
                        self.last_debug[f"filter_{nm}"] = {"value": value, "ok": False, "steps": steps}
                        return False
                else:
                    self.last_debug[f"filter_{nm}"] = {"value": value, "ok": False, "steps": steps}
                    return False
            if select_option:
                await self.wait(650)
                try:
                    opt_ref = await self._safe_find_ref(
                        text=value,
                        role=option_role,
                        timeout_ms=2_500,
                        poll_ms=300,
                    )
                    if opt_ref:
                        await browser_act(BrowserActRequest(ref=opt_ref, action="click", tab_id=self.tab_id))
                        steps.append({"step": "select_option", "role": option_role, "ok": True})
                    else:
                        steps.append({"step": "select_option", "role": option_role, "ok": False})
                        action_success = False
                except Exception:
                    logger.debug("filter option click failed", exc_info=True)
                    steps.append({"step": "select_option", "role": option_role, "ok": False, "error": "exception"})
                    action_success = False
        elif select_option and not input_action:
            # Click-to-select filter (headcount ranges, etc.): no text input,
            # just click the button/option matching the value after expanding.
            await self.wait(400)
            try:
                opt_ref = await self._safe_find_ref(
                    text=value,
                    role=option_role or "button",
                    timeout_ms=3_000,
                    poll_ms=300,
                )
                if opt_ref:
                    await browser_act(BrowserActRequest(ref=opt_ref, action="click", tab_id=self.tab_id))
                    steps.append({"step": "select_range", "value": value, "ok": True})
                else:
                    steps.append({"step": "select_range", "value": value, "ok": False})
                    self.last_debug[f"filter_{nm}"] = {"value": value, "ok": False, "steps": steps}
                    return False
            except Exception:
                logger.debug("range option click failed for %s=%s", nm, value, exc_info=True)
                steps.append({"step": "select_range", "value": value, "ok": False, "error": "exception"})
                self.last_debug[f"filter_{nm}"] = {"value": value, "ok": False, "steps": steps}
                return False
        else:
            # No input_action and no select_option — nothing to do
            self.last_debug[f"filter_{nm}"] = {"value": value, "ok": False, "steps": steps}
            return False

        if isinstance(confirm_action, str) and confirm_action.strip():
            await self.wait(600)
            ok2 = await self.click(confirm_action.strip(), timeout_ms=5_000)
            steps.append({"step": "confirm", "action": confirm_action.strip(), "ok": ok2})
            if not ok2:
                action_success = False

        # Collapse the filter panel after selection.
        # SalesNav leaves filter dropdowns open after selection, which
        # blocks subsequent filter interactions and obscures results.
        collapsed = False

        # Strategy 1: Re-click the expand button to toggle it closed.
        if isinstance(expand_action, str) and expand_action.strip() and not collapsed:
            try:
                await self.wait(300)
                toggle_ok = await self.click(expand_action.strip(), timeout_ms=2_000)
                if toggle_ok:
                    collapsed = True
                    steps.append({"step": "collapse_toggle", "action": expand_action.strip(), "ok": True})
            except Exception:
                pass

        # Strategy 2: Press Escape to dismiss open dropdowns.
        if not collapsed:
            try:
                await browser_act(
                    BrowserActRequest(ref=0, action="press", value="Escape", tab_id=self.tab_id)
                )
                await self.wait(300)
                collapsed = True
                steps.append({"step": "collapse_escape", "ok": True})
            except Exception:
                steps.append({"step": "collapse_escape", "ok": False})

        # Strategy 3: Click an empty area of the page to deselect.
        if not collapsed:
            try:
                await browser_act(
                    BrowserActRequest(
                        action="evaluate",
                        value="document.querySelector('.search-results-container, main, body')?.click()",
                        tab_id=self.tab_id,
                    )
                )
                await self.wait(300)
                steps.append({"step": "collapse_click_away", "ok": True})
            except Exception:
                steps.append({"step": "collapse_click_away", "ok": False})

        await self.wait(400)

        verified = None
        if verify:
            try:
                refs = await self.snapshot()
                target = (value or "").strip().lower()
                verified = any(target and target in _clean_text(r.get("label")).lower() for r in refs)
            except Exception:
                verified = None
            steps.append({"step": "verify", "ok": bool(verified) if verified is not None else None})

        final_ok = bool(action_success) and (True if (verified is None) else bool(verified))
        self.last_debug[f"filter_{nm}"] = {"value": value, "ok": final_ok, "steps": steps}
        return final_ok

    def best_match(
        self,
        items: list[dict[str, Any]],
        target: str,
        *,
        name_field: str,
        url_field: str,
        threshold: int = 60,
        ambiguity_margin: int = 5,
    ) -> dict[str, Any]:
        scored: list[tuple[int, dict[str, Any]]] = []
        for row in items:
            candidate = _clean_text(row.get(name_field))
            if not candidate:
                continue
            scored.append((_score_name_match(candidate, target), row))
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[0] if scored else None
        second = scored[1] if len(scored) > 1 else None
        ambiguous = bool(second and top and second[0] >= top[0] - ambiguity_margin and second[0] >= threshold - 5)
        if top and top[0] >= threshold and not ambiguous:
            return {"match": top[1], "score": top[0], "ambiguous": False}
        candidates = [
            {name_field: _clean_text(r.get(name_field)), url_field: _clean_text(r.get(url_field)), "score": s}
            for s, r in scored[:5]
            if _clean_text(r.get(name_field))
        ]
        return {"match": None, "score": top[0] if top else 0, "ambiguous": ambiguous, "candidates": candidates}

    async def navigate_to_match(
        self,
        items: list[dict[str, Any]],
        target: str,
        *,
        name_field: str,
        url_field: str,
    ) -> dict[str, Any]:
        base_url = str(self.frontmatter.get("base_url") or "").strip()
        result = self.best_match(items, target, name_field=name_field, url_field=url_field)
        match = result.get("match")
        if not isinstance(match, dict):
            return {**result, "clicked": False}
        href = _clean_text(match.get(url_field))
        if href.startswith("/") and base_url:
            href = f"{base_url}{href}"
        if not href.startswith("http"):
            return {**result, "clicked": False}
        try:
            await self.navigate(href)
            await self.wait(1200)
            return {**result, "clicked": True, "url": href}
        except Exception:
            logger.exception("navigate_to_match failed href=%s", href)
            return {**result, "clicked": False}
