"""Generic workflow recipes built on top of BrowserWorkflow.

These are NOT site-specific. They orchestrate common patterns like:
- search -> optional filters -> extract list -> optional click-through
- open entrypoint -> paginate -> extract sub-items

All website-specific knowledge remains in skills and is loaded by BrowserWorkflow.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import unquote, urlparse

import httpx

from services.web_automation.browser.core.workflow import BrowserWorkflow
from services.web_automation.browser.workflows.builder import (
    build_observation_pack,
    infer_href_pattern,
    infer_search_input_hint,
    validate_extraction_candidate,
)
from services.web_automation.browser.skills.store import (
    append_repair_note,
    build_observation_fingerprint,
    serialize_fingerprint,
    upsert_skill,
)
from api.routes.browser_nav import BrowserActRequest, browser_act

logger = logging.getLogger(__name__)

OLLAMA_BASE = os.getenv("OLLAMA_URL", "http://localhost:11434")
SKILL_LEARN_MODEL = os.getenv("SKILL_LEARN_MODEL", "gemma3:12b")

ProgressCallback = Callable[[int, str, dict[str, Any] | None], Awaitable[None]] | None


def build_salesnav_account_search_url(*, keyword: str, filters: dict[str, Any]):
    # Import lazily to avoid module import cycles at app startup.
    from services.web_automation.linkedin.salesnav.query_builder import build_salesnav_account_search_url as _build

    return _build(keyword=keyword, filters=filters)


def build_salesnav_people_search_url(*, keyword: str, filters: dict[str, Any]):
    from services.web_automation.linkedin.salesnav.query_builder import build_salesnav_people_search_url as _build

    return _build(keyword=keyword, filters=filters)


def _is_salesnav_query_build_error(exc: Exception) -> bool:
    return exc.__class__.__name__ == "SalesNavQueryBuildError" and hasattr(exc, "unmapped_filters")


def _env_int(name: str, default: int, *, minimum: int = 1, maximum: int = 10_000_000) -> int:
    try:
        value = int(os.getenv(name, str(default)) or str(default))
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


def short_timeout_ms() -> int:
    return _env_int("BROWSER_SHORT_TIMEOUT_MS", 15_000, minimum=1_000, maximum=600_000)


def long_timeout_ms() -> int:
    return _env_int("BROWSER_LONG_TIMEOUT_MS", 60_000, minimum=2_000, maximum=1_200_000)


def sync_workflow_timeout_ms() -> int:
    return _env_int("BROWSER_WORKFLOW_SYNC_TIMEOUT_MS", 240_000, minimum=2_000, maximum=1_800_000)


def async_workflow_runtime_ms() -> int:
    return _env_int("BROWSER_WORKFLOW_ASYNC_MAX_RUNTIME_MS", 600_000, minimum=5_000, maximum=3_600_000)


def classify_workflow_runtime(
    *,
    query: str,
    filters: dict[str, str] | None,
    limit: int,
    task: str,
) -> dict[str, Any]:
    limit_threshold = _env_int("BROWSER_LONG_TASK_LIMIT_THRESHOLD", 50, minimum=10, maximum=500)
    filter_threshold = _env_int("BROWSER_LONG_TASK_FILTER_THRESHOLD", 4, minimum=1, maximum=25)

    reasons: list[str] = []
    if int(limit) > limit_threshold:
        reasons.append(f"limit>{limit_threshold}")
    if len(filters or {}) >= filter_threshold:
        reasons.append(f"filters>={filter_threshold}")
    if len((query or "").split()) >= 12:
        reasons.append("query_complexity")
    if any(k in (task or "").lower() for k in ("list_", "paginate", "extract")) and int(limit) >= limit_threshold:
        reasons.append("task_complexity")
    lower_query = (query or "").lower()
    if (
        ("linkedin" in lower_query or "sales navigator" in lower_query or "salesnav" in lower_query)
        and re.search(r"\b(last\s+\d+\s+(day|days|week|weeks|month|months|year|years)|recent|posted|publicly expressed)\b", lower_query)
    ):
        reasons.append("linkedin_recency_verification")
    if re.search(r"\b(and|\*)\b", lower_query) and len((query or "").split()) >= 20:
        reasons.append("multi_constraint_query")
    return {
        "is_long": len(reasons) > 0,
        "reasons": reasons,
        "limit_threshold": limit_threshold,
        "filter_threshold": filter_threshold,
    }


def timeout_profile(*, is_long: bool) -> dict[str, int]:
    base = long_timeout_ms() if is_long else short_timeout_ms()
    return {
        "navigate_ms": max(2_000, min(120_000, base)),
        "interstitial_ms": max(3_000, min(180_000, int(base * 1.2))),
        "find_ref_ms": max(2_000, min(30_000, int(base * 0.5))),
    }


async def _emit_progress(progress_cb: ProgressCallback, pct: int, stage: str, diagnostics: dict[str, Any] | None = None) -> None:
    if progress_cb is None:
        return
    try:
        await progress_cb(max(0, min(100, int(pct))), stage, diagnostics)
    except Exception:
        logger.debug("progress callback failed", exc_info=True)

# ── NL query detection and decomposition ─────────────────────────────

_NL_PHRASES = re.compile(
    r"\b(specializing in|focused on|that (?:provide|offer|build|do)|"
    r"for the|in the|with expertise|powered by|based in|"
    r"looking for|targeting|companies that)\b",
    re.IGNORECASE,
)
_TARGET_MARKET_RE = re.compile(
    r"\bfor\s+(?:the\s+)?([a-z0-9&,\-/ ]+?)\s+(?:industry|sector|market)\b",
    re.IGNORECASE,
)
_TARGET_MARKET_RE_STRICT = re.compile(
    r"\bfor\s+the\s+([a-z0-9&,\-/ ]+?)\s+(?:industry|sector|market)\b",
    re.IGNORECASE,
)
_INDUSTRY_MAP = {
    "healthcare": "Hospitals and Health Care",
    "health care": "Hospitals and Health Care",
    "hospital": "Hospitals and Health Care",
    "hospitals": "Hospitals and Health Care",
    "technology": "Technology, Information and Internet",
    "tech": "Technology, Information and Internet",
    "software": "Technology, Information and Internet",
    "construction": "Construction",
    "finance": "Financial Services",
    "financial services": "Financial Services",
    "fintech": "Financial Services",
    "banking": "Financial Services",
    "manufacturing": "Manufacturing",
    "real estate": "Real Estate",
}


async def _diagnose_empty_extraction(
    wf: BrowserWorkflow,
    extract_type: str,
    limit: int,
) -> dict[str, Any]:
    """When extraction returns 0 items, diagnose why by inspecting the page."""
    from api.routes.browser_nav import (
        BrowserSnapshotRequest,
        BrowserScreenshotRequest,
        browser_snapshot,
        browser_screenshot,
    )

    diagnosis: dict[str, Any] = {
        "page_has_results": False,
        "results_count_text": None,
        "snapshot_refs_count": 0,
        "extract_type_used": extract_type,
        "screenshot_taken": False,
    }

    try:
        # Take a snapshot to inspect the page state
        snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=wf.tab_id, mode="ai"))
        refs = snap.get("refs", []) if isinstance(snap, dict) else []
        diagnosis["snapshot_refs_count"] = len(refs) if isinstance(refs, list) else 0

        # Look for a "N results" indicator in the page text
        snapshot_text = str(snap.get("snapshot_text") or "") if isinstance(snap, dict) else ""
        ref_labels = " ".join(
            str(r.get("label") or r.get("text") or "") for r in refs if isinstance(r, dict)
        )
        page_text = f"{snapshot_text} {ref_labels}".lower()

        # SalesNav shows "23 results" or "1,234 results" near the top
        import re
        results_match = re.search(r"(\d[\d,]*)\s+results?", page_text)
        if results_match:
            count_str = results_match.group(1).replace(",", "")
            count = int(count_str)
            diagnosis["results_count_text"] = results_match.group(0)
            diagnosis["results_count"] = count
            diagnosis["page_has_results"] = count > 0
        elif "no results" in page_text or "0 results" in page_text:
            diagnosis["page_has_results"] = False
            diagnosis["results_count_text"] = "0 results"
        else:
            # Check if there are any company-like links in refs
            company_refs = [
                r for r in refs if isinstance(r, dict)
                and any(
                    pattern in str(r.get("url") or r.get("href") or "")
                    for pattern in ["/sales/company/", "/sales/lead/"]
                )
            ]
            if company_refs:
                diagnosis["page_has_results"] = True
                diagnosis["results_count_text"] = f"~{len(company_refs)} visible items"
                diagnosis["results_count"] = len(company_refs)

        # Take a screenshot for the chat to surface
        try:
            screenshot = await browser_screenshot(
                BrowserScreenshotRequest(tab_id=wf.tab_id, full_page=False)
            )
            diagnosis["screenshot_taken"] = True
            if isinstance(screenshot, dict) and screenshot.get("image"):
                diagnosis["screenshot_base64"] = screenshot["image"]
        except Exception:
            pass

    except Exception as exc:
        diagnosis["error"] = str(exc)

    return diagnosis


def _is_natural_language(query: str) -> bool:
    """Return True if the query looks like a natural language sentence rather than keywords."""
    q = (query or "").strip()
    if not q:
        return False
    word_count = len(q.split())
    if word_count >= 6:
        return True
    if _NL_PHRASES.search(q):
        return True
    return False


def _decompose_salesnav_query(query: str) -> dict[str, Any] | None:
    """Use GPT-4 to decompose a NL query into SalesNav keywords + filters."""
    try:
        from services.web_automation.linkedin.salesnav.filter_parser import parse_salesnav_query
        return parse_salesnav_query(query)
    except Exception as exc:
        logger.warning("[NL decomposition] GPT-4 parse failed: %s", exc)
        # Deterministic fallback: preserve target market extraction for
        # "X for the Y industry/sector/market" phrasing.
        text = _clean_text(query)
        if not text:
            return None

        industry_values: list[str] = []
        keywords_text = text
        matches = list(_TARGET_MARKET_RE_STRICT.finditer(text)) or list(_TARGET_MARKET_RE.finditer(text))
        market = matches[-1] if matches else None
        if market:
            market_text = _clean_text(market.group(1)).strip(" ,.;")
            raw_market = market_text.lower()
            canonical = _INDUSTRY_MAP.get(raw_market, market_text)
            if canonical:
                industry_values = [canonical]
            start, end = market.span()
            keywords_text = f"{keywords_text[:start]} {keywords_text[end:]}"

        keywords_text = re.sub(
            r"^\s*search for (?:these )?companies(?: on sales navigator)?\s*",
            "",
            keywords_text,
            flags=re.IGNORECASE,
        )
        keywords_text = re.sub(r"\bcompanies?\b", " ", keywords_text, flags=re.IGNORECASE)
        keywords_text = re.sub(r"\bspecializing in\b", " ", keywords_text, flags=re.IGNORECASE)
        keywords_text = _clean_text(keywords_text).strip(" ,.;")
        keywords = [keywords_text] if keywords_text else []

        return {
            "industry": industry_values,
            "headquarters_location": [],
            "company_headcount": None,
            "annual_revenue": None,
            "company_headcount_growth": None,
            "number_of_followers": None,
            "keywords": keywords,
        }


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _as_int(value: Any, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        out = int(value)
    except Exception:
        out = default
    if minimum is not None:
        out = max(minimum, out)
    if maximum is not None:
        out = min(maximum, out)
    return out


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "y", "on"}:
            return True
        if v in {"0", "false", "no", "n", "off"}:
            return False
    return default


def _single_salesnav_keyword(value: str) -> str:
    """Reduce a free-form query to a single keyword token for SalesNav search input."""
    text = _clean_text(value)
    if not text:
        return ""
    for token in re.split(r"\s+", text):
        cleaned = token.strip(" ,.;:!?'\"()[]{}")
        if cleaned:
            return cleaned
    return text


def _extract_org_id_from_company_url(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    m = re.search(r"/sales/company/(\d+)", text)
    return m.group(1) if m else None


def _normalize_company_urn(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    raw = text
    for _ in range(2):
        decoded = unquote(raw)
        if decoded == raw:
            break
        raw = decoded
    m = re.search(r"urn:li:organization:(\d+)", raw)
    if m:
        return f"urn:li:organization:{m.group(1)}"
    if re.fullmatch(r"\d+", raw):
        return f"urn:li:organization:{raw}"
    return None


def _derive_people_filters_from_query(query: str) -> dict[str, str]:
    lowered = _clean_text(query).lower()
    out: dict[str, str] = {}
    if "vp of operations" in lowered or "vice president of operations" in lowered:
        out["function"] = "Operations"
        out["seniority_level"] = "Vice President"
    if any(tok in lowered for tok in ["united states", "u.s.", "usa", "us-based"]):
        out["headquarters_location"] = "United States"
    return out


def _extract_field_names(wf: BrowserWorkflow, kind: str) -> tuple[str, str]:
    k = (kind or "").strip().lower()
    name_field = str(wf.frontmatter.get(f"extract_{k}_label_field") or "name")
    url_field = str(wf.frontmatter.get(f"extract_{k}_url_field") or "url")
    return name_field, url_field


def _evaluate_item_validation(
    *,
    items: list[dict[str, Any]],
    name_field: str,
    url_field: str,
    min_items: int,
    max_items: int,
    required_fields: list[str],
    min_unique_url_fraction: float,
) -> dict[str, Any]:
    rows = items if isinstance(items, list) else []
    count = len(rows)
    count_ok = min_items <= count <= max_items
    names = [str(r.get(name_field) or "").strip() for r in rows if isinstance(r, dict)]
    urls = [str(r.get(url_field) or "").strip() for r in rows if isinstance(r, dict)]
    name_non_empty = (sum(1 for x in names if x) / count) if count else 0.0
    url_non_empty = (sum(1 for x in urls if x) / count) if count else 0.0
    unique_frac = (len(set(u for u in urls if u)) / max(1, sum(1 for u in urls if u))) if urls else 0.0

    required_ok = True
    req = [str(x).strip() for x in required_fields if str(x).strip()]
    for field in req:
        if field == name_field and name_non_empty < 0.95:
            required_ok = False
        if field == url_field and url_non_empty < 0.95:
            required_ok = False

    uniqueness_ok = unique_frac >= min_unique_url_fraction
    ok = bool(count_ok and required_ok and uniqueness_ok)
    reasons: list[str] = []
    if not count_ok:
        reasons.append("count_out_of_range")
    if not required_ok:
        reasons.append("required_fields_missing")
    if not uniqueness_ok:
        reasons.append("low_unique_url_fraction")

    return {
        "ok": ok,
        "reasons": reasons,
        "metrics": {
            "count": count,
            "min_items": min_items,
            "max_items": max_items,
            "name_non_empty_rate": round(name_non_empty, 4),
            "url_non_empty_rate": round(url_non_empty, 4),
            "unique_url_fraction": round(unique_frac, 4),
            "min_unique_url_fraction": min_unique_url_fraction,
        },
    }


def error_result(wf: BrowserWorkflow, code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "ok": False,
        "error": {"code": code, "message": message},
        "tab_id": wf.tab_id,
        "skill_id": wf.skill_id,
        "skill_match_score": wf.skill_meta.get("match_score") if isinstance(wf.skill_meta, dict) else None,
        "url": (extra.pop("url", None) or ""),
        **extra,
    }


def ok_result(wf: BrowserWorkflow, **extra: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "tab_id": wf.tab_id,
        "skill_id": wf.skill_id,
        "skill_match_score": wf.skill_meta.get("match_score") if isinstance(wf.skill_meta, dict) else None,
        **extra,
    }


async def _wait_ui_settle(wf: BrowserWorkflow, base_ms: int = 700) -> None:
    await wf.wait_jitter(base_ms=base_ms, variance_ratio=0.3, min_ms=350, max_ms=2_200)


async def _wait_results_settle(wf: BrowserWorkflow, base_ms: int = 1800) -> None:
    await wf.wait_jitter(base_ms=base_ms, variance_ratio=0.4, min_ms=900, max_ms=5_000)


async def _wait_phase_cooldown(wf: BrowserWorkflow) -> None:
    """Bounded inter-phase cooldown for load smoothing."""
    await wf.wait_jitter(base_ms=3000, variance_ratio=0.25, min_ms=2000, max_ms=4000)
    if hasattr(wf, "page") and wf.page:
        from services.web_automation.linkedin.salesnav.core.interaction import idle_drift
        await idle_drift(wf.page, duration_seconds=random.uniform(1.0, 2.5))


async def _maybe_click_salesnav_accounts_suggestion(wf: BrowserWorkflow) -> bool:
    # Deprecated: URL-first SalesNav flow does not rely on suggestion clicks.
    _ = wf
    return False


async def _maybe_expand_salesnav_all_filters(wf: BrowserWorkflow) -> bool:
    # Deprecated: URL-first SalesNav flow does not rely on UI filter expansion.
    _ = wf
    return False


async def _guard_challenges(
    wf: BrowserWorkflow,
    *,
    stage: str,
    max_wait_ms: int | None = None,
) -> dict[str, Any] | None:
    """Detect and attempt to autonomously resolve anti-bot challenges.

    Resolution order:
    1. Active resolution via ``wf.wait_through_interstitials()`` which now
       drives the challenge resolver (checkbox clicks, press-hold, iframe
       Turnstile, Cloudflare wait-through, etc.).
    2. If active resolution fails, a structured error is returned so the
       caller can decide whether to retry the whole recipe.

    No human-in-the-loop is required — challenges are handled gracefully.
    """
    challenge = await wf.wait_through_interstitials(max_wait_ms=max_wait_ms or short_timeout_ms())
    if not challenge:
        return None

    # The resolver inside wait_through_interstitials already tried hard.
    # If we still have a challenge it means active resolution failed.
    kind = str(challenge.get("kind") or "")
    reason = str(challenge.get("resolver_reason") or "")
    url = str(challenge.get("url") or (await wf.current_url()) or "")

    if reason == "feature_disabled_or_non_research_host":
        return error_result(
            wf,
            "challenge_solver_disabled",
            (
                "Challenge solver is disabled for this page. Enable research mode and allow the "
                "host if you want AI/human challenge handling."
            ),
            url=url,
            stage=stage,
            challenge=challenge,
        )
    if reason == "human_fallback_disabled":
        return error_result(
            wf,
            "challenge_human_fallback_disabled",
            "Challenge requires human verification, but human fallback is disabled in config.",
            url=url,
            stage=stage,
            challenge=challenge,
        )

    if kind in {"human_verification", "behavioral_or_invisible"}:
        return error_result(
            wf,
            "challenge_unresolved",
            (
                "A human-verification challenge was detected and could not be "
                "resolved automatically. The page may require a different browser "
                "profile or a retry after a cooldown."
            ),
            url=url,
            stage=stage,
            challenge=challenge,
        )
    if kind == "human_handoff_timeout":
        return error_result(
            wf,
            "human_handoff_timeout",
            (
                "A challenge was handed off for manual verification, but it was not "
                "resolved before the timeout."
            ),
            url=url,
            stage=stage,
            challenge=challenge,
        )
    if kind == "blocked":
        return error_result(
            wf,
            "blocked_or_rate_limited",
            "Access appears blocked or rate-limited. Backing off and retrying later may help.",
            url=url,
            stage=stage,
            challenge=challenge,
        )
    if kind == "interstitial_timeout":
        return error_result(
            wf,
            "challenge_timeout",
            "Timed out waiting for the site interstitial to clear after multiple resolution attempts.",
            url=url,
            stage=stage,
            challenge=challenge,
        )

    return error_result(
        wf,
        "challenge_detected",
        "A site challenge was detected and could not be resolved automatically.",
        url=url,
        stage=stage,
        challenge=challenge,
    )


async def _guard_with_timeout(wf: BrowserWorkflow, *, stage: str, max_wait_ms: int) -> dict[str, Any] | None:
    try:
        return await _guard_challenges(wf, stage=stage, max_wait_ms=max_wait_ms)
    except TypeError:
        # Backward compatibility for monkeypatched tests expecting the old signature.
        return await _guard_challenges(wf, stage=stage)


async def extract_from_current(
    *,
    task: str,
    extract_type: str,
    tab_id: str | None = None,
    query: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Extract structured rows from the current tab using the matched skill.

    This recipe does NOT navigate; it only binds a skill based on the current URL
    (and the provided task) and then runs the skill-defined extraction rules.
    """
    wf = BrowserWorkflow(tab_id=tab_id)
    current_url = await wf.current_url()
    if not await wf.bind_skill(task=task, url=current_url, query=query):
        # Fall back to task-only match, useful when current_url is blank/unknown.
        if not await wf.bind_skill(task=task, url=None, query=query):
            return error_result(wf, "skill_not_found", f"No skill matched for task '{task}'.", url=current_url or "")

    guard = await _guard_challenges(wf, stage="extract_from_current")
    if guard:
        return guard

    max_rows = max(1, min(int(limit), 500))
    items = await wf.extract(extract_type, max_rows)
    return ok_result(
        wf,
        task=task,
        query=query,
        url=(await wf.current_url()) or (current_url or ""),
        items=items,
        count=len(items),
    )


async def auto_learn_skill(
    wf: BrowserWorkflow,
    *,
    task: str,
    query: str,
) -> dict[str, Any]:
    """Auto-learn a browser skill from deterministic observations + LLM hints.

    Returns ``{"ok": True, "skill_id": ..., "draft": ...}`` on success,
    or ``{"ok": False, "draft": ..., "error": ...}`` on failure.
    """
    try:
        current_url = await wf.current_url() or ""
        needs_navigation = not current_url or current_url in ("", "about:blank", "chrome://newtab/")

        if not needs_navigation:
            task_lower = task.lower()
            url_lower = current_url.lower()
            task_tokens = re.sub(r"[^a-z0-9]+", " ", task_lower).split()
            if not any(token in url_lower for token in task_tokens if len(token) > 3):
                needs_navigation = True

        if needs_navigation:
            site_hints = {
                "youtube": "https://www.youtube.com",
                "google": "https://www.google.com",
                "linkedin": "https://www.linkedin.com",
                "twitter": "https://twitter.com",
                "x_com": "https://x.com",
                "github": "https://github.com",
                "reddit": "https://www.reddit.com",
                "salesnav": "https://www.linkedin.com/sales/search/company",
                "amazon": "https://www.amazon.com",
                "yelp": "https://www.yelp.com",
            }
            target_url = None
            task_lower = task.lower()
            for hint, url in site_hints.items():
                if hint in task_lower:
                    target_url = url
                    break
            if not target_url:
                target_url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
            if "youtube.com" in target_url and query:
                target_url = f"https://www.youtube.com/results?search_query={query.replace(' ', '+')}"
            elif "google.com" in target_url and query and "search?q=" not in target_url:
                target_url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
            try:
                await wf.navigate(target_url)
                await _wait_results_settle(wf, 2000)
                current_url = await wf.current_url() or target_url
            except Exception as nav_exc:
                logger.debug("auto_learn_skill: navigation failed: %s", nav_exc)
                return {"ok": False, "error": f"Could not navigate to {target_url}: {nav_exc}"}

        observation = await build_observation_pack(
            wf,
            include_screenshot=False,
            include_semantic_nodes=True,
            semantic_node_limit=200,
        )
        refs_raw = observation.get("dom", {}).get("role_refs") if isinstance(observation, dict) else None
        refs: list[dict[str, Any]] = refs_raw if isinstance(refs_raw, list) else []
        if not refs:
            return {"ok": False, "error": "Page snapshot is empty and cannot be auto-learned."}

        compact_refs: list[dict[str, Any]] = []
        for ref in refs[:150]:
            if not isinstance(ref, dict):
                continue
            entry: dict[str, Any] = {}
            if ref.get("role"):
                entry["role"] = ref["role"]
            if ref.get("label"):
                entry["label"] = str(ref["label"])[:80]
            if ref.get("href"):
                entry["href"] = str(ref["href"])[:120]
            if ref.get("ref"):
                entry["ref"] = ref["ref"]
            if entry:
                compact_refs.append(entry)

        semantic_nodes_raw = observation.get("dom", {}).get("semantic_nodes") if isinstance(observation, dict) else None
        semantic_nodes = semantic_nodes_raw if isinstance(semantic_nodes_raw, list) else []
        compact_semantic: list[dict[str, Any]] = []
        for node in semantic_nodes[:120]:
            if not isinstance(node, dict):
                continue
            compact_semantic.append(
                {
                    "tag": node.get("tag"),
                    "role": node.get("role"),
                    "name": node.get("name"),
                    "aria_label": node.get("aria_label"),
                    "placeholder": node.get("placeholder"),
                    "href": node.get("href"),
                }
            )

        parsed_url = urlparse(current_url)
        domain = parsed_url.netloc.replace("www.", "")
        path_prefix = parsed_url.path.rstrip("/")
        domain_pattern = f"{domain}{path_prefix}" if path_prefix else domain

        prompt = (
            "You are analyzing a web page to create a browser automation skill.\n"
            f"Current URL: {current_url}\n"
            f"Task: {task}\n"
            f"Query: {query}\n\n"
            f"Observation page_mode: {observation.get('page_mode')}\n"
            f"Observation data_source_preference: {observation.get('data_source_preference')}\n\n"
            f"Page accessibility tree (first 150 elements):\n"
            f"{json.dumps(compact_refs, indent=None)}\n\n"
            f"Semantic node sample (first 120):\n"
            f"{json.dumps(compact_semantic, indent=None)}\n\n"
            "Analyze this page and return ONLY a JSON object with:\n"
            "{\n"
            '  "name": "short skill name",\n'
            '  "description": "one-line description",\n'
            '  "search_input_role": "input|combobox|searchbox",\n'
            '  "search_input_text": "placeholder text of the search box",\n'
            '  "result_href_pattern": "URL substring that identifies result links (e.g. /sales/company/)",\n'
            '  "result_label_field": "name",\n'
            '  "result_url_field": "url",\n'
            '  "extract_kind": "company|lead|person|item"\n'
            "}\n\n"
            "Rules:\n"
            "- search_input: find the main search/filter input on the page\n"
            "- result_href_pattern: identify the common URL pattern in result links\n"
            "- Look at href values to find the pattern that result items share\n"
            "- Return ONLY the JSON object, no markdown, no explanation"
        )

        resp = httpx.post(
            f"{OLLAMA_BASE}/api/chat",
            json={
                "model": SKILL_LEARN_MODEL,
                "messages": [
                    {"role": "system", "content": "You analyze web pages and output structured JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "options": {"temperature": 0, "num_predict": 256},
            },
            timeout=15.0,
        )
        if resp.status_code != 200:
            return {"ok": False, "error": f"LLM call failed ({resp.status_code})"}

        raw_content = (resp.json().get("message", {}).get("content") or "").strip()
        cleaned = raw_content.replace("```json", "").replace("```", "").strip()
        try:
            inferred = json.loads(cleaned)
        except json.JSONDecodeError:
            return {"ok": False, "error": "LLM returned invalid JSON", "raw": cleaned[:500]}

        skill_name = inferred.get("name") or f"{domain} Automation"
        description = inferred.get("description") or f"Auto-learned skill for {domain}"
        fallback_role, fallback_search_text = infer_search_input_hint(refs)
        fallback_href_pattern = infer_href_pattern(refs)
        search_role = _clean_text(inferred.get("search_input_role")) or fallback_role or "input"
        search_text = _clean_text(inferred.get("search_input_text")) or fallback_search_text or "search"
        href_pattern = _clean_text(inferred.get("result_href_pattern")) or fallback_href_pattern or ""
        extract_kind = inferred.get("extract_kind") or "item"
        label_field = inferred.get("result_label_field") or "name"
        url_field = inferred.get("result_url_field") or "url"

        validation = validate_extraction_candidate(
            refs,
            href_contains=[href_pattern] if href_pattern else [],
            min_items=1,
            max_items=200,
            required_fields=[label_field, url_field],
            base_domain=domain,
        )
        if (not validation.get("ok")) and fallback_href_pattern and fallback_href_pattern != href_pattern:
            fallback_validation = validate_extraction_candidate(
                refs,
                href_contains=[fallback_href_pattern],
                min_items=1,
                max_items=200,
                required_fields=[label_field, url_field],
                base_domain=domain,
            )
            if int(fallback_validation.get("fit_score", 0)) >= int(validation.get("fit_score", 0)):
                href_pattern = fallback_href_pattern
                validation = fallback_validation

        observation_fingerprint = build_observation_fingerprint(observation if isinstance(observation, dict) else {})
        serialized_fingerprint = serialize_fingerprint(observation_fingerprint)

        skill_id = re.sub(r"[^a-z0-9]+", "-", domain.lower()).strip("-")
        if task:
            skill_id = f"{skill_id}-{re.sub(r'[^a-z0-9]+', '-', task.lower()).strip('-')}"

        draft = (
            f"---\n"
            f"name: {skill_name}\n"
            f"description: {description}\n"
            f"domains:\n"
            f"  - {domain_pattern}\n"
            f"entry_url: {current_url}\n"
            f"base_url: {parsed_url.scheme}://{parsed_url.netloc}\n"
            f"tasks:\n"
            f"  - {task}\n"
            f"default_extract_kind: {extract_kind}\n"
            f"fingerprints:\n"
            f"  - {serialized_fingerprint}\n"
            f"extract_{extract_kind}_href_contains:\n"
            f"  - {href_pattern}\n"
            f"extract_{extract_kind}_label_field: {label_field}\n"
            f"extract_{extract_kind}_url_field: {url_field}\n"
            f"validation_min_items: 1\n"
            f"validation_max_items: 200\n"
            f"validation_required_fields:\n"
            f"  - {label_field}\n"
            f"  - {url_field}\n"
            f"validation_min_unique_url_fraction: 0.7\n"
            f"validation_stop_on_fail: false\n"
            f"tags:\n"
            f"  - auto-learned\n"
            f"version: 1\n"
            f"---\n\n"
            f"# {skill_name}\n\n"
            f"## Objective\n\n"
            f"Auto-learned skill for {domain}. Search and extract {extract_kind} results.\n\n"
            f"## Action Hints\n\n"
            f"- search_input | role={search_role} | text={search_text}\n\n"
            f"## Extraction Hints\n\n"
            f"- Result links contain `{href_pattern}`.\n\n"
            f"## Repair Log\n\n"
            f"- Auto-learned from page snapshot.\n"
        )

        try:
            upsert_skill(skill_id, draft)
            logger.info("Auto-learned skill '%s' for domain '%s'", skill_id, domain)
            return {
                "ok": True,
                "skill_id": skill_id,
                "draft": draft,
                "observation": {
                    "domain": observation.get("domain"),
                    "page_mode": observation.get("page_mode"),
                    "data_source_preference": observation.get("data_source_preference"),
                },
                "candidate_validation": validation,
            }
        except Exception as exc:
            logger.warning("Failed to save auto-learned skill: %s", exc)
            return {
                "ok": False,
                "skill_id": skill_id,
                "draft": draft,
                "error": str(exc),
                "candidate_validation": validation,
            }

    except Exception as exc:
        logger.debug("auto_learn_skill failed: %s", exc)
        return {"ok": False, "error": str(exc)}


async def _resolve_people_current_company_identity(
    *,
    company_name: str,
    current_urn: str | None,
    current_sales_nav_url: str | None,
) -> dict[str, str] | None:
    name = _clean_text(company_name)
    if not name:
        return None
    urn = _normalize_company_urn(current_urn)
    if not urn:
        org_id = _extract_org_id_from_company_url(current_sales_nav_url)
        if org_id:
            urn = f"urn:li:organization:{org_id}"
    if urn:
        return {"name": name, "urn": urn, "source": "provided"}

    # Resolve exact company identity from SalesNav account search first.
    resolved = await search_and_extract(
        task="salesnav_search_account",
        query=name,
        filter_values=None,
        click_target=None,
        extract_type="company",
        tab_id=None,
        limit=3,
        wait_ms=2500,
        progress_cb=None,
    )
    if not isinstance(resolved, dict) or not resolved.get("ok"):
        return None
    items = resolved.get("items")
    rows = items if isinstance(items, list) else []
    if not rows:
        return None
    first = rows[0] if isinstance(rows[0], dict) else {}
    exact_name = _clean_text(first.get("company_name") or first.get("name"))
    sales_nav_url = _clean_text(first.get("sales_nav_url") or first.get("linkedin_url"))
    org_id = _extract_org_id_from_company_url(sales_nav_url)
    if not exact_name or not org_id:
        return None
    return {"name": exact_name, "urn": f"urn:li:organization:{org_id}", "source": "presearch"}


async def search_and_extract(
    *,
    task: str,
    query: str,
    search_action: str = "search_input",
    filter_values: dict[str, Any] | None = None,
    click_target: str | None = None,
    extract_type: str | None = None,
    tab_id: str | None = None,
    limit: int = 25,
    wait_ms: int = 1500,
    compound_lead_mode: bool = False,
    progress_cb: ProgressCallback = None,
) -> dict[str, Any]:
    wf = BrowserWorkflow(tab_id=tab_id)
    runtime_class = classify_workflow_runtime(query=query, filters=filter_values, limit=limit, task=task)
    timeouts = timeout_profile(is_long=bool(runtime_class.get("is_long")))
    await _emit_progress(progress_cb, 5, "bind_skill", {"runtime_class": runtime_class})

    if not await wf.bind_skill(task=task, url=None, query=query):
        # Auto-learn: try to infer a skill from the page structure
        learn_result = await auto_learn_skill(wf, task=task, query=query)
        if learn_result and learn_result.get("ok"):
            # Skill was auto-generated and saved — retry binding
            if not await wf.bind_skill(task=task, url=None, query=query):
                return {
                    **error_result(wf, "skill_not_found", f"No skill matched for task '{task}' even after auto-learn."),
                    "auto_learn_attempted": True,
                    "auto_learn_skill_id": learn_result.get("skill_id"),
                }
        else:
            return {
                **error_result(wf, "skill_not_found", f"No skill matched for task '{task}'."),
                "auto_learn_available": True,
                "auto_learn_error": learn_result.get("error") if learn_result else None,
                "suggested_skill_draft": learn_result.get("draft") if learn_result else None,
            }
    salesnav_account_tasks = {"salesnav_search_account", "salesnav_extract_companies"}
    salesnav_people_tasks = {"salesnav_people_search", "salesnav_extract_leads"}
    salesnav_url_tasks = salesnav_account_tasks | salesnav_people_tasks

    if task not in salesnav_url_tasks:
        await _emit_progress(progress_cb, 15, "navigating", {"tab_id": wf.tab_id})
        try:
            navigated = await wf.navigate_to_entry(timeout_ms=timeouts["navigate_ms"])
        except TypeError:
            # Backward compatibility for test doubles or older workflow wrappers.
            navigated = await wf.navigate_to_entry()
        if not navigated:
            current_url = (await wf.current_url()) or ""
            patterns = [
                str(p).strip().lower()
                for p in (wf.frontmatter.get("domains") if isinstance(wf.frontmatter, dict) else []) or []
                if str(p).strip()
            ]
            lower_url = current_url.lower()
            on_matching_domain = bool(lower_url and any(p in lower_url for p in patterns))
            if not on_matching_domain and patterns:
                try:
                    candidate = patterns[0]
                    if not candidate.startswith("http://") and not candidate.startswith("https://"):
                        candidate = f"https://{candidate}"
                    await wf.navigate(candidate, timeout_ms=timeouts["navigate_ms"])
                    on_matching_domain = True
                except Exception:
                    on_matching_domain = False
            if not on_matching_domain:
                return error_result(
                    wf,
                    "no_entry_url",
                    "Skill is missing entry_url.",
                    url=current_url,
                )
        # Give highly dynamic sites (SalesNav, etc.) a moment to render interactive controls
        # before we start looking for refs.
        await _wait_ui_settle(wf, 900)
        await _wait_phase_cooldown(wf)

        guard = await _guard_with_timeout(wf, stage="navigate_to_entry", max_wait_ms=timeouts["interstitial_ms"])
        if guard:
            return guard

    # ── NL query decomposition for SalesNav account searches ──────────
    # If the query looks like natural language (not just keywords), use
    # GPT-4 to decompose it into SalesNav-native keywords + structured
    # filters (industry, location, headcount).  This prevents dumping
    # the raw NL query verbatim into the keyword box.
    effective_query = _clean_text(query)
    effective_filters: dict[str, Any] = dict(filter_values or {})
    decomposition_used = False
    original_query = query

    if task in salesnav_url_tasks and _is_natural_language(query):
        try:
            parsed = _decompose_salesnav_query(query)
            if parsed:
                decomposition_used = True
                # Use extracted keywords for the search box (or short original if no keywords)
                kw = parsed.get("keywords") or []
                effective_query = " ".join(kw) if kw else query.split()[0] if query.strip() else query

                # Merge parsed filters into filter_values.
                # Keep explicit caller-provided filters as the highest priority.
                def _first_scalar(raw: Any) -> str | None:
                    if isinstance(raw, str) and raw.strip():
                        return raw.strip()
                    if isinstance(raw, list):
                        for item in raw:
                            if isinstance(item, str) and item.strip():
                                return item.strip()
                    if isinstance(raw, (int, float, bool)):
                        return str(raw)
                    return None

                parsed_filter_keys = (
                    (
                        "industry",
                        "headquarters_location",
                        "company_headcount",
                        "annual_revenue",
                        "company_headcount_growth",
                        "fortune",
                        "number_of_followers",
                        "department_headcount",
                        "department_headcount_growth",
                        "job_opportunities",
                        "recent_activities",
                        "connection",
                        "companies_in_crm",
                        "saved_accounts",
                        "account_lists",
                    )
                    if task in salesnav_account_tasks
                    else (
                        "industry",
                        "headquarters_location",
                        "company_headcount",
                        "annual_revenue",
                    )
                )
                for key in parsed_filter_keys:
                    if key in effective_filters:
                        continue
                    resolved = _first_scalar(parsed.get(key))
                    if resolved:
                        effective_filters[key] = resolved
                if task in salesnav_people_tasks:
                    for key, value in _derive_people_filters_from_query(query).items():
                        if key not in effective_filters:
                            effective_filters[key] = value

                logger.info(
                    "[NL decomposition] query=%r -> keywords=%r, filters=%r",
                    query, effective_query, {k: v for k, v in effective_filters.items()},
                )
        except Exception as exc:
            logger.warning("[NL decomposition] Failed, using raw query: %s", exc)
    if task in salesnav_account_tasks:
        # Keep SalesNav keyword searches human-like and stable:
        # exactly one keyword token per search.
        effective_query = _single_salesnav_keyword(effective_query)
    elif task in salesnav_people_tasks and compound_lead_mode:
        # Compound lead phases should avoid verbose people keywords.
        effective_query = _single_salesnav_keyword(effective_query)

    applied_filters: dict[str, Any] = {}
    people_search_meta: dict[str, Any] = {}
    people_retry_context: dict[str, Any] | None = None
    people_filters: dict[str, Any] = {}

    async def _navigate_salesnav_url(url: str, stage_name: str) -> dict[str, Any] | None:
        await _emit_progress(progress_cb, 45, stage_name, {"tab_id": wf.tab_id, "url": url})
        try:
            await wf.navigate(url, timeout_ms=timeouts["navigate_ms"])
        except TypeError:
            # Backward compatibility for test doubles or older workflow wrappers.
            await wf.navigate(url)
        await _wait_results_settle(wf, max(700, int(wait_ms)))
        await _wait_phase_cooldown(wf)
        return await _guard_with_timeout(wf, stage=stage_name, max_wait_ms=timeouts["interstitial_ms"])

    if task in salesnav_account_tasks:
        await _emit_progress(progress_cb, 35, "build_salesnav_query_url", {"filters_count": len(effective_filters), "tab_id": wf.tab_id})
        try:
            built = build_salesnav_account_search_url(keyword=effective_query, filters=effective_filters)
        except Exception as exc:
            if _is_salesnav_query_build_error(exc):
                return error_result(
                    wf,
                    "salesnav_filter_unmapped",
                    "One or more SalesNav filters are not URL-mapped.",
                    unmapped_filters=getattr(exc, "unmapped_filters", []),
                )
            raise
        guard = await _navigate_salesnav_url(built.url, "salesnav_url_query_navigate")
        if guard:
            return guard
        applied_filters = dict(built.applied_filters)
    elif task in salesnav_people_tasks:
        await _emit_progress(progress_cb, 35, "build_salesnav_people_query_url", {"filters_count": len(effective_filters), "tab_id": wf.tab_id})
        people_filters = dict(effective_filters)
        requested_company = _clean_text(people_filters.get("current_company"))
        requested_urn = _clean_text(people_filters.get("current_company_urn"))
        requested_company_url = _clean_text(people_filters.get("current_company_sales_nav_url"))

        if requested_company:
            resolved = await _resolve_people_current_company_identity(
                company_name=requested_company,
                current_urn=requested_urn or None,
                current_sales_nav_url=requested_company_url or None,
            )
            if resolved:
                people_filters["current_company"] = resolved["name"]
                people_filters["current_company_urn"] = resolved["urn"]
                people_filters.pop("current_company_sales_nav_url", None)
                people_search_meta["current_company_strategy"] = "exact_match"
                people_search_meta["current_company_resolved"] = resolved
                fallback_filters = {
                    k: v
                    for k, v in people_filters.items()
                    if _clean_text(k).lower() not in {"current_company", "current_company_urn", "current_company_sales_nav_url"}
                }
                people_retry_context = {
                    "keyword": effective_query,
                    "filters": fallback_filters,
                    "reason": "exact_company_no_results",
                }
            else:
                # If exact company identity cannot be resolved, use keyword search without CURRENT_COMPANY.
                for key in ("current_company", "current_company_urn", "current_company_sales_nav_url"):
                    people_filters.pop(key, None)
                people_search_meta["current_company_strategy"] = "keyword_fallback_unresolved"
                people_search_meta["current_company_requested"] = requested_company
                people_search_meta["current_company_resolved"] = None

        try:
            built = build_salesnav_people_search_url(keyword=effective_query, filters=people_filters)
        except Exception as exc:
            if _is_salesnav_query_build_error(exc):
                return error_result(
                    wf,
                    "salesnav_filter_unmapped",
                    "One or more SalesNav filters are not URL-mapped.",
                    unmapped_filters=getattr(exc, "unmapped_filters", []),
                )
            raise
        guard = await _navigate_salesnav_url(built.url, "salesnav_people_url_query_navigate")
        if guard:
            return guard
        applied_filters = dict(built.applied_filters)
        people_search_meta["initial_url"] = built.url
    else:
        effective_search_action = search_action
        search_submit = True
        should_fill_query = True
        await _emit_progress(progress_cb, 35, "search", {"tab_id": wf.tab_id})
        if should_fill_query and not await wf.fill_input(effective_search_action, effective_query, submit=search_submit):
            if effective_search_action != search_action:
                if not await wf.fill_input(search_action, effective_query, submit=search_submit):
                    return error_result(wf, "search_input_not_found", f"Neither '{effective_search_action}' nor '{search_action}' found.")
            else:
                return error_result(wf, "search_input_not_found", f"Action '{search_action}' not found (skill drift).")
        if should_fill_query:
            await _wait_results_settle(wf, max(700, int(wait_ms)))
        else:
            wf.last_debug["search_skipped"] = True
        await _emit_progress(progress_cb, 45, "search_complete", {"query_filled": bool(should_fill_query), "tab_id": wf.tab_id})

        guard = await _guard_with_timeout(wf, stage="search_submit", max_wait_ms=timeouts["interstitial_ms"])
        if guard:
            return guard

        if effective_filters:
            await _emit_progress(progress_cb, 50, "apply_filters", {"filters_count": len(effective_filters)})
        total_filters = max(1, len(effective_filters))
        for idx, (name, value) in enumerate(effective_filters.items(), start=1):
            pct = 50 + int((idx / total_filters) * 20)
            await _emit_progress(progress_cb, pct, "applying_filter", {"filter": name, "index": idx, "total": total_filters, "tab_id": wf.tab_id})
            ok = await wf.apply_filter(name, str(value))
            applied_filters[name] = {"value": value, "applied": bool(ok), "debug": wf.last_debug.get(f"filter_{name}")}
            await _wait_ui_settle(wf, 800)
            guard = await _guard_with_timeout(wf, stage=f"apply_filter:{name}", max_wait_ms=timeouts["interstitial_ms"])
            if guard:
                return guard

        if applied_filters:
            await _wait_results_settle(wf, 2200)
            await _wait_phase_cooldown(wf)

    await _emit_progress(progress_cb, 74, "filters_complete", {"applied_filters": len(applied_filters), "tab_id": wf.tab_id})

    # Auto-select extraction kind from the matched skill if caller omitted it
    # or provided an unsupported kind.
    extract_type_used = (extract_type or "").strip().lower() or None
    available = []
    try:
        available = wf.available_extract_kinds()
    except Exception:
        available = []

    if extract_type_used:
        try:
            rules = wf._extract_rules(extract_type_used)  # type: ignore[attr-defined]
        except Exception:
            rules = {"href_contains": []}
        if not ((rules.get("href_contains") or []) or (rules.get("text_regex") or "")):
            extract_type_used = None

    if not extract_type_used:
        # Prefer skill-declared defaults over hardcoded kind ordering.
        #
        # Skills may support multiple extract kinds (e.g. both "company" and "lead").
        # The correct default depends on the *task*, and is website-specific knowledge
        # that belongs in the skill frontmatter, not in this generic recipe.
        # NOTE: skill frontmatter parsing is intentionally simple (flat key/value),
        # so we encode task-specific defaults as:
        # - default_extract_kind_for_task_<task>: <kind>
        default_kind = None
        if isinstance(wf.frontmatter, dict):
            task_key = task.strip()
            if task_key:
                default_kind = wf.frontmatter.get(f"default_extract_kind_for_task_{task_key}") or wf.frontmatter.get(
                    f"default_extract_kind_for_task_{task_key.lower()}"
                )

        if isinstance(default_kind, str) and default_kind.strip().lower() in available:
            extract_type_used = default_kind.strip().lower()

    if not extract_type_used:
        raw_default = wf.frontmatter.get("default_extract_kind") if isinstance(wf.frontmatter, dict) else None
        if isinstance(raw_default, str) and raw_default.strip().lower() in available:
            extract_type_used = raw_default.strip().lower()

    if not extract_type_used:
        # Fallback: prefer common kinds when present, otherwise just take the first available.
        for preferred in ("company", "lead", "person"):
            if preferred in available:
                extract_type_used = preferred
                break
        if not extract_type_used and available:
            extract_type_used = available[0]
        if not extract_type_used:
            # Last resort: keep backward compat.
            extract_type_used = "company"

    await _emit_progress(progress_cb, 80, "extracting", {"extract_type": extract_type_used, "tab_id": wf.tab_id})
    items = await wf.extract(extract_type_used, max(1, min(int(limit), 200)))

    # ── Self-diagnosis: extraction returned 0 but page may have results ──
    extraction_diagnosis: dict[str, Any] | None = None
    if not items:
        await _emit_progress(progress_cb, 86, "diagnosing_empty_extraction", {"tab_id": wf.tab_id})
        diagnosis = await _diagnose_empty_extraction(wf, extract_type_used, limit)
        if diagnosis.get("page_has_results"):
            # Page shows results but extraction missed them — retry with longer wait
            logger.warning(
                "[extraction diagnosis] Page shows %s results but extracted 0. Retrying...",
                diagnosis.get("results_count_text"),
            )
            await _wait_results_settle(wf, 2500)
            items = await wf.extract(extract_type_used, max(1, min(int(limit), 200)))
            diagnosis["retried"] = True
            diagnosis["retry_count"] = len(items)
        extraction_diagnosis = diagnosis

    if task in salesnav_people_tasks and not items and compound_lead_mode and _clean_text(effective_query):
        await _emit_progress(
            progress_cb,
            88,
            "salesnav_people_drop_keyword_retry",
            {"tab_id": wf.tab_id, "reason": "zero_results_with_keyword"},
        )
        try:
            built_no_keyword = build_salesnav_people_search_url(keyword="", filters=people_filters)
            guard = await _navigate_salesnav_url(built_no_keyword.url, "salesnav_people_drop_keyword_retry_navigate")
            if guard:
                return guard
            retry_items_no_keyword = await wf.extract(extract_type_used, max(1, min(int(limit), 200)))
            people_search_meta["keyword_retry"] = {
                "used": True,
                "mode": "drop_keyword_keep_filters",
                "reason": "zero_results_with_keyword",
                "url": built_no_keyword.url,
                "count": len(retry_items_no_keyword),
            }
            if retry_items_no_keyword:
                items = retry_items_no_keyword
                applied_filters = dict(built_no_keyword.applied_filters)
        except Exception as exc:
            people_search_meta["keyword_retry"] = {
                "used": True,
                "mode": "drop_keyword_keep_filters",
                "reason": "zero_results_with_keyword",
                "error": str(exc),
            }

    if task in salesnav_people_tasks and not items and people_retry_context:
        retry_keyword = _clean_text(people_retry_context.get("keyword")) or effective_query
        retry_filters = people_retry_context.get("filters")
        if isinstance(retry_filters, dict):
            await _emit_progress(
                progress_cb,
                88,
                "salesnav_people_keyword_fallback",
                {"tab_id": wf.tab_id, "reason": people_retry_context.get("reason")},
            )
            try:
                built_retry = build_salesnav_people_search_url(keyword=retry_keyword, filters=retry_filters)
                guard = await _navigate_salesnav_url(built_retry.url, "salesnav_people_keyword_fallback_navigate")
                if guard:
                    return guard
                retry_items = await wf.extract(extract_type_used, max(1, min(int(limit), 200)))
                if retry_items:
                    items = retry_items
                    applied_filters = dict(built_retry.applied_filters)
                people_search_meta["keyword_fallback"] = {
                    "used": True,
                    "url": built_retry.url,
                    "reason": people_retry_context.get("reason"),
                    "count": len(retry_items),
                }
            except Exception as exc:
                people_search_meta["keyword_fallback"] = {
                    "used": True,
                    "reason": people_retry_context.get("reason"),
                    "error": str(exc),
                }

    current_url = await wf.current_url()

    click: dict[str, Any] | None = None
    if click_target and click_target.strip():
        await _emit_progress(progress_cb, 92, "click_target", {"tab_id": wf.tab_id})
        name_field, url_field = _extract_field_names(wf, extract_type_used)
        click = await wf.navigate_to_match(items, click_target.strip(), name_field=name_field, url_field=url_field)
        current_url = await wf.current_url()
        guard = await _guard_with_timeout(wf, stage="click_target", max_wait_ms=timeouts["interstitial_ms"])
        if guard:
            return guard

    result = ok_result(
        wf,
        task=task,
        query=query,
        url=current_url or "",
        applied_filters=applied_filters,
        items=items,
        count=len(items),
        click=click,
        extract_type=extract_type_used,
    )

    # Runtime drift monitor (deterministic): evaluate output invariants and
    # emit a structured repair payload when validation fails.
    name_field, url_field = _extract_field_names(wf, extract_type_used)
    fm = wf.frontmatter if isinstance(wf.frontmatter, dict) else {}
    min_items_cfg = _as_int(fm.get("validation_min_items"), 1, minimum=0, maximum=2000)
    max_items_cfg = _as_int(fm.get("validation_max_items"), 200, minimum=1, maximum=5000)
    min_unique_cfg = float(fm.get("validation_min_unique_url_fraction") or 0.7)
    req_fields_raw = fm.get("validation_required_fields")
    if isinstance(req_fields_raw, list) and req_fields_raw:
        req_fields = [str(x).strip() for x in req_fields_raw if str(x).strip()]
    else:
        req_fields = [name_field, url_field]

    item_validation = _evaluate_item_validation(
        items=items,
        name_field=name_field,
        url_field=url_field,
        min_items=min_items_cfg,
        max_items=max_items_cfg,
        required_fields=req_fields,
        min_unique_url_fraction=max(0.0, min(1.0, min_unique_cfg)),
    )
    result["item_validation"] = item_validation

    if not bool(item_validation.get("ok")):
        stop_reason = "STOP_VALIDATION_FAILED"
        result["stop_reason"] = stop_reason
        result["drift_monitor"] = {
            "triggered": True,
            "reason": stop_reason,
            "reasons": list(item_validation.get("reasons") or []),
            "repair_suggested": True,
        }
        if wf.skill_id:
            try:
                append_repair_note(
                    wf.skill_id,
                    stop_reason,
                    context={
                        "task": task,
                        "count": int(item_validation.get("metrics", {}).get("count") or 0),
                        "reasons": ",".join(item_validation.get("reasons") or []),
                    },
                )
            except Exception:
                logger.debug("append_repair_note failed in drift monitor", exc_info=True)
        try:
            obs = await build_observation_pack(
                wf,
                include_screenshot=False,
                include_semantic_nodes=True,
                semantic_node_limit=220,
            )
            fp = build_observation_fingerprint(obs if isinstance(obs, dict) else {})
            result["drift_monitor"]["observation_fingerprint"] = fp
            result["drift_monitor"]["repair_payload"] = {
                "tab_id": wf.tab_id,
                "url": obs.get("url") if isinstance(obs, dict) else "",
                "page_mode": obs.get("page_mode") if isinstance(obs, dict) else "",
                "fingerprint": fp,
            }
        except Exception:
            logger.debug("drift monitor observation capture failed", exc_info=True)

        if _as_bool(fm.get("validation_stop_on_fail"), default=False):
            hard = error_result(
                wf,
                "validation_failed",
                "Extracted data failed deterministic validation checks.",
                task=task,
                query=query,
                url=current_url or "",
                stop_reason=stop_reason,
                drift_monitor=result.get("drift_monitor"),
                item_validation=item_validation,
                partial_items=items[:10],
                count=len(items),
            )
            await _emit_progress(progress_cb, 100, "finished_with_validation_failure", {"count": len(items), "tab_id": wf.tab_id})
            return hard

    # Attach extraction diagnosis if it occurred
    if extraction_diagnosis:
        result["extraction_diagnosis"] = extraction_diagnosis
        if extraction_diagnosis.get("page_has_results") and not items:
            result["extraction_warning"] = (
                f"The page shows {extraction_diagnosis.get('results_count_text', 'some')} results "
                f"but extraction could not parse them. This is likely a page rendering or skill pattern issue. "
                f"The browser session is still open — you can view the results directly."
            )

    # Attach decomposition metadata so callers know what happened
    if decomposition_used:
        result["query_decomposition"] = {
            "original_query": original_query,
            "effective_keywords": effective_query,
            "filters_applied": {k: v for k, v in effective_filters.items()},
        }

    # Lightweight result validation: check industry match
    if decomposition_used and effective_filters.get("industry") and items:
        industry_raw = effective_filters.get("industry")
        if isinstance(industry_raw, list):
            target_industry = str(industry_raw[0]).lower() if industry_raw else ""
        else:
            target_industry = str(industry_raw).lower()
        matched = sum(
            1 for item in items
            if target_industry in (item.get("subtitle") or item.get("industry") or "").lower()
        )
        if matched == 0 and len(items) < 3:
            result["industry_mismatch_warning"] = (
                f"None of the {len(items)} result(s) matched the target industry '{effective_filters['industry']}'. "
                f"Results may be inaccurate — consider refining the search."
            )

    if task in salesnav_people_tasks and people_search_meta:
        result["people_search"] = people_search_meta

    await _emit_progress(progress_cb, 100, "finished", {"count": len(items), "tab_id": wf.tab_id})
    return result


async def list_sub_items(
    *,
    task: str,
    tab_id: str | None = None,
    parent_query: str | None = None,
    parent_task: str | None = None,
    parent_filter_values: dict[str, str] | None = None,
    entrypoint_action: str = "entrypoint",
    extract_type: str = "lead",
    limit: int = 100,
    wait_ms: int = 1200,
    progress_cb: ProgressCallback = None,
) -> dict[str, Any]:
    wf = BrowserWorkflow(tab_id=tab_id)
    runtime_class = classify_workflow_runtime(query=parent_query or "", filters=parent_filter_values, limit=limit, task=task)
    timeouts = timeout_profile(is_long=bool(runtime_class.get("is_long")))
    await _emit_progress(progress_cb, 5, "bind_sub_items_skill", {"runtime_class": runtime_class, "tab_id": wf.tab_id})

    if parent_query and parent_task:
        await _emit_progress(progress_cb, 20, "resolve_parent", {"tab_id": wf.tab_id})
        parent = await search_and_extract(
            task=parent_task,
            query=parent_query,
            filter_values=parent_filter_values,
            click_target=parent_query,
            extract_type="company",
            tab_id=tab_id,
            limit=5,
            wait_ms=3500,
            progress_cb=progress_cb,
        )
        if not parent.get("ok"):
            return parent
        wf.tab_id = str(parent.get("tab_id") or wf.tab_id or "")

        click = parent.get("click") if isinstance(parent, dict) else None
        if isinstance(click, dict) and click.get("ambiguous") and click.get("candidates"):
            return error_result(
                wf,
                "ambiguous_parent_match",
                "Multiple close parent matches found. Provide a more specific name.",
                candidates=click.get("candidates") or [],
            )

    current_url = await wf.current_url()
    if not await wf.bind_skill(task=task, url=current_url, query=parent_query):
        return error_result(wf, "skill_not_found", f"No skill matched for task '{task}'.")

    guard = await _guard_with_timeout(wf, stage="bind_skill", max_wait_ms=timeouts["interstitial_ms"])
    if guard:
        return guard

    # Best-effort: close any unrelated drawer/modal before attempting the entrypoint.
    try:
        await wf.dismiss_common_overlays(max_passes=2)
    except Exception:
        pass

    await _emit_progress(progress_cb, 40, "open_entrypoint", {"tab_id": wf.tab_id})
    before_tab = wf.tab_id
    ok = await wf.click_and_follow_tab(entrypoint_action, wait_ms=wait_ms)
    if not ok:
        return error_result(wf, "entrypoint_not_found", f"Action '{entrypoint_action}' not found (skill drift).")

    opened_new_tab = bool(before_tab and wf.tab_id and wf.tab_id != before_tab)
    await _wait_ui_settle(wf, 1200)

    # Clicking entrypoints can open filter/persona drawers that hide results.
    try:
        await wf.dismiss_common_overlays(max_passes=2)
    except Exception:
        pass

    guard = await _guard_with_timeout(wf, stage="open_entrypoint", max_wait_ms=timeouts["interstitial_ms"])
    if guard:
        return guard

    max_rows = max(1, min(int(limit), 200))
    await _emit_progress(progress_cb, 75, "extracting_sub_items", {"max_rows": max_rows, "tab_id": wf.tab_id})
    items = await wf.paginate_and_extract(
        extract_type,
        max_rows,
        next_action="pagination_next",
        max_pages=12,
        page_wait_ms=900,
    )

    result = ok_result(
        wf,
        task=task,
        url=(await wf.current_url()) or "",
        items=items,
        count=len(items),
        opened_new_tab=opened_new_tab,
    )
    await _emit_progress(progress_cb, 100, "finished", {"count": len(items), "tab_id": wf.tab_id})
    return result
