"""Deterministic workflow-builder primitives.

This module intentionally avoids site-specific logic. It provides:
- Observation Pack capture for stable planner inputs.
- Deterministic extraction-candidate validation + fit scoring.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from api.routes.browser_nav import (
    BrowserActRequest,
    BrowserScreenshotRequest,
    BrowserSnapshotRequest,
    browser_act,
    browser_screenshot,
    browser_snapshot,
)
from services.web_automation.browser.core.workflow import BrowserWorkflow


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _canonical_url(url: str | None) -> str:
    raw = _clean_text(url)
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    except Exception:
        return raw


def _url_is_valid(url: str | None) -> bool:
    value = _clean_text(url)
    if not value:
        return False
    return bool(re.match(r"^https?://", value, flags=re.IGNORECASE) or value.startswith("/"))


def _domain_of(url: str | None) -> str:
    try:
        return (urlsplit(_clean_text(url)).netloc or "").lower().strip()
    except Exception:
        return ""


def _contains_search_token(value: str) -> bool:
    lowered = value.lower()
    return any(tok in lowered for tok in ("search", "find", "query", "keyword"))


def _first_meaningful_path_segment(path: str) -> str | None:
    for seg in path.split("/"):
        candidate = seg.strip().lower()
        if len(candidate) < 3:
            continue
        if candidate.isdigit():
            continue
        if re.fullmatch(r"[a-f0-9]{8,}", candidate):
            continue
        if candidate in {"www", "com", "net", "index", "home", "results", "search"}:
            continue
        return candidate
    return None


def _meaningful_path_segments(url_or_path: str) -> list[str]:
    raw = _clean_text(url_or_path)
    if not raw:
        return []
    path = raw
    try:
        path = urlsplit(raw).path or raw
    except Exception:
        path = raw
    out: list[str] = []
    for seg in path.split("/"):
        candidate = seg.strip().lower()
        if len(candidate) < 3:
            continue
        if candidate.isdigit():
            continue
        if re.fullmatch(r"[a-f0-9]{8,}", candidate):
            continue
        if candidate in {"www", "com", "net", "index", "home", "results", "search"}:
            continue
        out.append(candidate)
    return out


def classify_page_mode(*, url: str | None, refs: list[dict[str, Any]], snapshot_text: str) -> str:
    labels = " ".join(_clean_text(r.get("label")) for r in refs).lower()
    roles = [_clean_text(r.get("role")).lower() for r in refs]
    body = f"{labels} {snapshot_text.lower()}"

    if any(tok in body for tok in ("captcha", "verify you are human", "access denied", "unusual traffic")):
        return "blocked"
    if any(tok in body for tok in ("sign in", "log in", "continue with", "forgot password")):
        return "login_wall"
    if any(tok in body for tok in ("cookie", "privacy choices", "accept all", "consent")) and "button" in roles:
        return "consent_modal"

    has_input = any(role in {"input", "textbox", "searchbox", "combobox", "textarea"} for role in roles)
    link_count = sum(1 for role in roles if role in {"a", "link"})
    has_result_hint = any(tok in body for tok in ("results", "next", "page "))

    if has_input and _contains_search_token(body):
        if link_count >= 5 or has_result_hint:
            return "list_page"
        return "search_form"
    if link_count >= 8:
        return "list_page"
    if link_count <= 3:
        return "detail_page"
    if "/search" in (_clean_text(url).lower()):
        return "list_page"
    return "unknown"


def _extract_data_source_preference(*, refs: list[dict[str, Any]], semantic_nodes: list[dict[str, Any]]) -> list[str]:
    has_json_ld = any(
        (node.get("tag") == "script" and _clean_text(node.get("type")).lower() == "application/ld+json")
        for node in semantic_nodes
    )
    # Network capture is backend-dependent; keep as optional-first placeholder.
    if has_json_ld:
        return ["structured_markup", "dom"]
    href_rich = sum(1 for row in refs if _clean_text(row.get("href")))
    if href_rich >= 5:
        return ["dom", "structured_markup"]
    return ["dom"]


async def _capture_semantic_nodes(tab_id: str | None, *, limit: int) -> list[dict[str, Any]]:
    script = (
        "(() => {"
        "const n = Number(%d) || 200;"
        "const nodes = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3,h4,h5,h6,li,article,main,section,script[type=\"application/ld+json\"]'));"
        "const visible = (el) => {"
        "  const st = window.getComputedStyle(el);"
        "  const r = el.getBoundingClientRect();"
        "  return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;"
        "};"
        "const pickDataAttrs = (el) => {"
        "  const out = {};"
        "  for (const a of Array.from(el.attributes || [])) {"
        "    if (!a || !a.name) continue;"
        "    if (!a.name.toLowerCase().startsWith('data-')) continue;"
        "    out[a.name] = (a.value || '').toString().slice(0, 120);"
        "    if (Object.keys(out).length >= 6) break;"
        "  }"
        "  return out;"
        "};"
        "const nearestLandmark = (el) => {"
        "  let cur = el;"
        "  while (cur && cur !== document.body) {"
        "    const role = norm(cur.getAttribute && cur.getAttribute('role'));"
        "    const tag = norm(cur.tagName ? cur.tagName.toLowerCase() : '');"
        "    if (role && ['main','navigation','banner','contentinfo','complementary','region'].includes(role)) return role;"
        "    if (['main','nav','header','footer','aside','article','section'].includes(tag)) return tag;"
        "    cur = cur.parentElement;"
        "  }"
        "  return '';"
        "};"
        "const nearestContainerHint = (el) => {"
        "  let cur = el;"
        "  let hops = 0;"
        "  while (cur && cur !== document.body && hops < 6) {"
        "    const tag = norm(cur.tagName ? cur.tagName.toLowerCase() : '');"
        "    const dt = norm(cur.getAttribute && cur.getAttribute('data-testid'));"
        "    const cls = norm(cur.className || '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.');"
        "    const id = norm(cur.id || '');"
        "    const cand = [tag, dt ? `dt:${dt}` : '', id ? `id:${id}` : '', cls ? `c:${cls}` : ''].filter(Boolean).join('|');"
        "    if (cand && (tag === 'li' || tag === 'article' || tag === 'section' || /card|item|result|row|list/i.test(cand))) return cand.slice(0, 200);"
        "    cur = cur.parentElement;"
        "    hops += 1;"
        "  }"
        "  return '';"
        "};"
        "const out = [];"
        "for (const el of nodes) {"
        "  if (out.length >= n) break;"
        "  const tag = (el.tagName || '').toLowerCase();"
        "  if (tag !== 'script' && !visible(el)) continue;"
        "  out.push({"
        "    tag,"
        "    role: (el.getAttribute('role') || '').toString(),"
        "    name: (el.getAttribute('name') || '').toString().slice(0, 120),"
        "    placeholder: (el.getAttribute('placeholder') || '').toString().slice(0, 120),"
        "    aria_label: (el.getAttribute('aria-label') || '').toString().slice(0, 120),"
        "    href: (el.getAttribute('href') || '').toString().slice(0, 240),"
        "    type: (el.getAttribute('type') || '').toString().slice(0, 80),"
        "    text: (tag === 'script' ? '' : (el.innerText || el.textContent || '').toString().replace(/\\s+/g, ' ').trim().slice(0, 120)),"
        "    landmark_role: nearestLandmark(el),"
        "    container_hint: nearestContainerHint(el),"
        "    data_attrs: pickDataAttrs(el),"
        "  });"
        "}"
        "return out;"
        "})()"
    ) % max(10, min(int(limit), 500))

    try:
        out = await browser_act(BrowserActRequest(action="evaluate", value=script, tab_id=tab_id))
    except Exception:
        return []

    result = out.get("result") if isinstance(out, dict) else None
    if not isinstance(result, list):
        return []

    clean_rows: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        clean_rows.append(
            {
                "tag": _clean_text(row.get("tag")),
                "role": _clean_text(row.get("role")),
                "name": _clean_text(row.get("name")),
                "placeholder": _clean_text(row.get("placeholder")),
                "aria_label": _clean_text(row.get("aria_label")),
                "href": _clean_text(row.get("href")),
                "type": _clean_text(row.get("type")),
                "text": _clean_text(row.get("text")),
                "landmark_role": _clean_text(row.get("landmark_role")),
                "container_hint": _clean_text(row.get("container_hint")),
                "data_attrs": row.get("data_attrs") if isinstance(row.get("data_attrs"), dict) else {},
            }
        )
    return clean_rows


async def build_observation_pack(
    wf: BrowserWorkflow,
    *,
    include_screenshot: bool = True,
    include_semantic_nodes: bool = True,
    semantic_node_limit: int = 220,
) -> dict[str, Any]:
    role_snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=wf.tab_id, mode="role"))
    ai_snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=wf.tab_id, mode="ai"))

    if isinstance(role_snap, dict) and role_snap.get("tab_id"):
        wf.tab_id = str(role_snap["tab_id"])
    elif isinstance(ai_snap, dict) and ai_snap.get("tab_id"):
        wf.tab_id = str(ai_snap["tab_id"])

    url = await wf.current_url()
    role_refs = role_snap.get("refs") if isinstance(role_snap, dict) else []
    ai_refs = ai_snap.get("refs") if isinstance(ai_snap, dict) else []
    refs = role_refs if isinstance(role_refs, list) else []
    ai_refs_list = ai_refs if isinstance(ai_refs, list) else []

    semantic_nodes: list[dict[str, Any]] = []
    if include_semantic_nodes:
        semantic_nodes = await _capture_semantic_nodes(wf.tab_id, limit=semantic_node_limit)

    screenshot_image = None
    if include_screenshot:
        try:
            shot = await browser_screenshot(BrowserScreenshotRequest(tab_id=wf.tab_id, full_page=False))
            if isinstance(shot, dict):
                screenshot_image = shot.get("image")
        except Exception:
            screenshot_image = None

    snapshot_text = _clean_text(
        role_snap.get("snapshot_text") if isinstance(role_snap, dict) else ""
    )
    page_mode = classify_page_mode(url=url, refs=refs, snapshot_text=snapshot_text)
    domain = _domain_of(url)
    data_source_preference = _extract_data_source_preference(refs=refs, semantic_nodes=semantic_nodes)

    return {
        "tab_id": wf.tab_id,
        "url": _canonical_url(url),
        "domain": domain,
        "page_mode": page_mode,
        "data_source_preference": data_source_preference,
        "policy_summary": {
            "read_only_default": True,
            "unsafe_actions_blocked_by_default": True,
        },
        "stabilization": {
            "method": "snapshot_role_plus_ai",
            "network_idle_confirmed": False,
            "layout_stable_confirmed": False,
        },
        "dom": {
            "role_snapshot_text": role_snap.get("snapshot_text") if isinstance(role_snap, dict) else "",
            "role_refs": refs,
            "ai_refs": ai_refs_list,
            "semantic_nodes": semantic_nodes,
        },
        "visual": {
            "screenshot_base64": screenshot_image,
            "has_screenshot": bool(screenshot_image),
        },
        "network": {
            "available": False,
            "note": "Network capture is backend-dependent and not yet exposed in browser_nav.",
            "request_index": [],
            "json_samples": [],
        },
    }


async def build_annotation_artifacts(
    wf: BrowserWorkflow,
    *,
    href_contains: list[str],
    max_boxes: int = 40,
    include_screenshot: bool = True,
) -> dict[str, Any]:
    """Return candidate overlay boxes for a selector pattern.

    Uses DOM evaluation when available for pixel boxes, with a snapshot fallback
    for backends where evaluate is unavailable.
    """
    patterns = [_clean_text(p) for p in (href_contains or []) if _clean_text(p)]
    if not patterns:
        patterns = [""]

    screenshot_image = None
    if include_screenshot:
        try:
            shot = await browser_screenshot(BrowserScreenshotRequest(tab_id=wf.tab_id, full_page=False))
            if isinstance(shot, dict):
                screenshot_image = shot.get("image")
                if shot.get("tab_id"):
                    wf.tab_id = str(shot.get("tab_id"))
        except Exception:
            screenshot_image = None

    boxes: list[dict[str, Any]] = []
    eval_script = (
        "(() => {"
        "const maxN = Number(%d) || 40;"
        "const pats = %s;"
        "const norm = (v) => (v || '').toString().trim();"
        "const nodes = Array.from(document.querySelectorAll('a,[role=\"link\"],button,[role=\"button\"]'));"
        "const visible = (el) => {"
        "  const st = window.getComputedStyle(el);"
        "  const r = el.getBoundingClientRect();"
        "  return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;"
        "};"
        "const nearestLandmark = (el) => {"
        "  let cur = el;"
        "  while (cur && cur !== document.body) {"
        "    const role = norm(cur.getAttribute && cur.getAttribute('role'));"
        "    const tag = norm(cur.tagName ? cur.tagName.toLowerCase() : '');"
        "    if (role && ['main','navigation','banner','contentinfo','complementary','region'].includes(role)) return role;"
        "    if (['main','nav','header','footer','aside','article','section'].includes(tag)) return tag;"
        "    cur = cur.parentElement;"
        "  }"
        "  return '';"
        "};"
        "const out = [];"
        "for (const el of nodes) {"
        "  if (out.length >= maxN) break;"
        "  if (!visible(el)) continue;"
        "  const href = norm(el.getAttribute('href'));"
        "  const label = norm(el.getAttribute('aria-label') || el.innerText || el.textContent);"
        "  const role = norm(el.getAttribute('role') || el.tagName.toLowerCase());"
        "  const hay = `${href} ${label}`;"
        "  if (pats.length && !pats.some((p) => p && hay.includes(p))) continue;"
        "  const r = el.getBoundingClientRect();"
        "  out.push({"
        "    label: label.slice(0, 120),"
        "    href: href.slice(0, 260),"
        "    role: role.slice(0, 40),"
        "    landmark_role: nearestLandmark(el).slice(0, 40),"
        "    container_hint: (() => {"
        "      let cur = el;"
        "      let hops = 0;"
        "      while (cur && cur !== document.body && hops < 6) {"
        "        const tag = norm(cur.tagName ? cur.tagName.toLowerCase() : '');"
        "        const dt = norm(cur.getAttribute && cur.getAttribute('data-testid'));"
        "        const cls = norm(cur.className || '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.');"
        "        const id = norm(cur.id || '');"
        "        const cand = [tag, dt ? `dt:${dt}` : '', id ? `id:${id}` : '', cls ? `c:${cls}` : ''].filter(Boolean).join('|');"
        "        if (cand && (tag === 'li' || tag === 'article' || tag === 'section' || /card|item|result|row|list/i.test(cand))) return cand.slice(0, 200);"
        "        cur = cur.parentElement;"
        "        hops += 1;"
        "      }"
        "      return '';"
        "    })(),"
        "    x: Math.max(0, Math.round(r.x)),"
        "    y: Math.max(0, Math.round(r.y)),"
        "    width: Math.max(0, Math.round(r.width)),"
        "    height: Math.max(0, Math.round(r.height)),"
        "  });"
        "}"
        "return out;"
        "})()"
    ) % (
        max(1, min(int(max_boxes), 120)),
        repr(patterns),
    )

    try:
        evaluated = await browser_act(BrowserActRequest(action="evaluate", value=eval_script, tab_id=wf.tab_id))
        if isinstance(evaluated, dict) and evaluated.get("tab_id"):
            wf.tab_id = str(evaluated["tab_id"])
        raw = evaluated.get("result") if isinstance(evaluated, dict) else None
        if isinstance(raw, list):
            for idx, row in enumerate(raw):
                if not isinstance(row, dict):
                    continue
                boxes.append(
                    {
                        "box_id": f"b{idx}",
                        "label": _clean_text(row.get("label")),
                        "href": _clean_text(row.get("href")),
                        "role": _clean_text(row.get("role")),
                        "landmark_role": _clean_text(row.get("landmark_role")),
                        "container_hint": _clean_text(row.get("container_hint")),
                        "x": int(row.get("x") or 0),
                        "y": int(row.get("y") or 0),
                        "width": int(row.get("width") or 0),
                        "height": int(row.get("height") or 0),
                    }
                )
    except Exception:
        boxes = []

    if not boxes:
        snap = await browser_snapshot(BrowserSnapshotRequest(tab_id=wf.tab_id, mode="role"))
        if isinstance(snap, dict) and snap.get("tab_id"):
            wf.tab_id = str(snap["tab_id"])
        refs = snap.get("refs") if isinstance(snap, dict) else None
        refs_list = refs if isinstance(refs, list) else []
        idx = 0
        for row in refs_list:
            if not isinstance(row, dict):
                continue
            label = _clean_text(row.get("label"))
            href = _clean_text(row.get("href") or row.get("url"))
            hay = f"{label} {href}"
            if patterns and not any(p in hay for p in patterns):
                continue
            boxes.append(
                {
                    "box_id": f"b{idx}",
                    "label": label,
                    "href": href,
                    "role": _clean_text(row.get("role")),
                    "landmark_role": None,
                    "container_hint": None,
                    "x": None,
                    "y": None,
                    "width": None,
                    "height": None,
                }
            )
            idx += 1
            if idx >= max(1, min(int(max_boxes), 120)):
                break

    return {
        "tab_id": wf.tab_id,
        "href_contains": patterns,
        "count": len(boxes),
        "boxes": boxes,
        "screenshot_base64": screenshot_image,
        "has_screenshot": bool(screenshot_image),
    }


def infer_search_input_hint(refs: list[dict[str, Any]]) -> tuple[str, str]:
    for row in refs:
        if not isinstance(row, dict):
            continue
        role = _clean_text(row.get("role")).lower()
        label = _clean_text(row.get("label"))
        if role in {"input", "textbox", "searchbox", "combobox"} and _contains_search_token(label):
            return role or "input", label or "search"

    for row in refs:
        if not isinstance(row, dict):
            continue
        role = _clean_text(row.get("role")).lower()
        label = _clean_text(row.get("label"))
        if role in {"input", "textbox", "searchbox", "combobox"}:
            return role or "input", (label or "search")
    return "input", "search"


def infer_href_pattern(refs: list[dict[str, Any]], *, fallback: str = "") -> str:
    tokens: list[str] = []
    for row in refs:
        if not isinstance(row, dict):
            continue
        href = _clean_text(row.get("href") or row.get("url"))
        if not href:
            continue
        candidate = href
        try:
            parts = urlsplit(href)
            candidate = parts.path or href
        except Exception:
            candidate = href
        seg = _first_meaningful_path_segment(candidate)
        if seg:
            tokens.append(f"/{seg}/")

    if not tokens:
        return _clean_text(fallback)

    best = Counter(tokens).most_common(1)[0][0]
    return best


def synthesize_href_pattern_from_feedback(
    *,
    include_hrefs: list[str],
    exclude_hrefs: list[str],
    fallback_patterns: list[str] | None = None,
) -> str | None:
    """Derive a stable href token that covers include examples and avoids excludes."""
    includes = [_clean_text(x) for x in include_hrefs if _clean_text(x)]
    excludes = [_clean_text(x) for x in exclude_hrefs if _clean_text(x)]
    if not includes:
        fallback = [_clean_text(x) for x in (fallback_patterns or []) if _clean_text(x)]
        return fallback[0] if fallback else None

    include_segments = Counter()
    exclude_segments = Counter()
    for href in includes:
        for seg in set(_meaningful_path_segments(href)):
            include_segments[seg] += 1
    for href in excludes:
        for seg in set(_meaningful_path_segments(href)):
            exclude_segments[seg] += 1

    best_seg = None
    best_score = -999
    for seg, inc in include_segments.items():
        exc = exclude_segments.get(seg, 0)
        score = (inc * 3) - (exc * 4)
        if score > best_score:
            best_score = score
            best_seg = seg

    if best_seg and best_score > 0:
        return f"/{best_seg}/"

    fallback = [_clean_text(x) for x in (fallback_patterns or []) if _clean_text(x)]
    return fallback[0] if fallback else None


def _label_tokens(value: str) -> list[str]:
    raw = _clean_text(value).lower()
    if not raw:
        return []
    tokens = re.split(r"[^a-z0-9]+", raw)
    out: list[str] = []
    for tok in tokens:
        if len(tok) < 3:
            continue
        if tok.isdigit():
            continue
        if tok in {"the", "and", "for", "with", "from", "that", "this", "you", "your"}:
            continue
        out.append(tok)
    return out


def synthesize_candidate_from_feedback(
    *,
    include_boxes: list[dict[str, Any]],
    exclude_boxes: list[dict[str, Any]],
    fallback_patterns: list[str] | None = None,
) -> dict[str, Any]:
    include_hrefs = [_clean_text(x.get("href")) for x in include_boxes if isinstance(x, dict) and _clean_text(x.get("href"))]
    exclude_hrefs = [_clean_text(x.get("href")) for x in exclude_boxes if isinstance(x, dict) and _clean_text(x.get("href"))]

    include_labels = [_clean_text(x.get("label")) for x in include_boxes if isinstance(x, dict) and _clean_text(x.get("label"))]
    exclude_labels = [_clean_text(x.get("label")) for x in exclude_boxes if isinstance(x, dict) and _clean_text(x.get("label"))]

    include_roles = [_clean_text(x.get("role")).lower() for x in include_boxes if isinstance(x, dict) and _clean_text(x.get("role"))]
    exclude_roles = [_clean_text(x.get("role")).lower() for x in exclude_boxes if isinstance(x, dict) and _clean_text(x.get("role"))]
    include_landmarks = [_clean_text(x.get("landmark_role")).lower() for x in include_boxes if isinstance(x, dict) and _clean_text(x.get("landmark_role"))]
    exclude_landmarks = [_clean_text(x.get("landmark_role")).lower() for x in exclude_boxes if isinstance(x, dict) and _clean_text(x.get("landmark_role"))]
    include_containers = [_clean_text(x.get("container_hint")).lower() for x in include_boxes if isinstance(x, dict) and _clean_text(x.get("container_hint"))]
    exclude_containers = [_clean_text(x.get("container_hint")).lower() for x in exclude_boxes if isinstance(x, dict) and _clean_text(x.get("container_hint"))]

    href_pattern = synthesize_href_pattern_from_feedback(
        include_hrefs=include_hrefs,
        exclude_hrefs=exclude_hrefs,
        fallback_patterns=fallback_patterns,
    )

    include_token_counts: Counter[str] = Counter()
    exclude_token_counts: Counter[str] = Counter()
    for label in include_labels:
        for tok in set(_label_tokens(label)):
            include_token_counts[tok] += 1
    for label in exclude_labels:
        for tok in set(_label_tokens(label)):
            exclude_token_counts[tok] += 1

    positive_tokens: list[str] = []
    negative_tokens: list[str] = []
    for tok, inc in include_token_counts.most_common():
        exc = exclude_token_counts.get(tok, 0)
        if inc >= 2 and inc > exc:
            positive_tokens.append(tok)
        if len(positive_tokens) >= 4:
            break
    for tok, exc in exclude_token_counts.most_common():
        inc = include_token_counts.get(tok, 0)
        if exc >= 2 and exc > inc:
            negative_tokens.append(tok)
        if len(negative_tokens) >= 4:
            break

    role_counts = Counter(r for r in include_roles if r)
    excluded_roles = set(r for r in exclude_roles if r)
    role_allowlist = [r for r, cnt in role_counts.most_common() if cnt >= 1 and r not in excluded_roles][:3]
    include_landmark_counts = Counter(r for r in include_landmarks if r)
    exclude_landmark_counts = Counter(r for r in exclude_landmarks if r)

    within_roles: list[str] = []
    exclude_within_roles: list[str] = []
    for role, inc in include_landmark_counts.most_common():
        exc = exclude_landmark_counts.get(role, 0)
        if inc >= 1 and inc >= exc:
            within_roles.append(role)
        if len(within_roles) >= 2:
            break
    for role, exc in exclude_landmark_counts.most_common():
        inc = include_landmark_counts.get(role, 0)
        if exc >= 1 and exc > inc:
            exclude_within_roles.append(role)
        if len(exclude_within_roles) >= 3:
            break

    include_container_counts = Counter(include_containers)
    exclude_container_counts = Counter(exclude_containers)
    container_hint_contains: list[str] = []
    exclude_container_hint_contains: list[str] = []
    for hint, inc in include_container_counts.most_common():
        exc = exclude_container_counts.get(hint, 0)
        if inc >= 1 and inc >= exc:
            container_hint_contains.append(hint)
        if len(container_hint_contains) >= 2:
            break
    for hint, exc in exclude_container_counts.most_common():
        inc = include_container_counts.get(hint, 0)
        if exc >= 1 and exc > inc:
            exclude_container_hint_contains.append(hint)
        if len(exclude_container_hint_contains) >= 3:
            break

    return {
        "href_contains": [href_pattern] if href_pattern else [],
        "label_contains_any": positive_tokens,
        "exclude_label_contains_any": negative_tokens,
        "role_allowlist": role_allowlist,
        "must_be_within_roles": within_roles,
        "exclude_within_roles": exclude_within_roles,
        "container_hint_contains": container_hint_contains,
        "exclude_container_hint_contains": exclude_container_hint_contains,
    }


def validate_extraction_candidate(
    refs: list[dict[str, Any]],
    *,
    href_contains: list[str],
    label_contains_any: list[str] | None = None,
    exclude_label_contains_any: list[str] | None = None,
    role_allowlist: list[str] | None = None,
    must_be_within_roles: list[str] | None = None,
    exclude_within_roles: list[str] | None = None,
    container_hint_contains: list[str] | None = None,
    exclude_container_hint_contains: list[str] | None = None,
    min_items: int = 1,
    max_items: int = 200,
    required_fields: list[str] | None = None,
    base_domain: str | None = None,
) -> dict[str, Any]:
    patterns = [_clean_text(p) for p in href_contains if _clean_text(p)]
    include_labels = [_clean_text(p).lower() for p in (label_contains_any or []) if _clean_text(p)]
    exclude_labels = [_clean_text(p).lower() for p in (exclude_label_contains_any or []) if _clean_text(p)]
    role_allow = [_clean_text(r).lower() for r in (role_allowlist or []) if _clean_text(r)]
    include_landmarks = [_clean_text(r).lower() for r in (must_be_within_roles or []) if _clean_text(r)]
    exclude_landmarks = [_clean_text(r).lower() for r in (exclude_within_roles or []) if _clean_text(r)]
    include_containers = [_clean_text(r).lower() for r in (container_hint_contains or []) if _clean_text(r)]
    exclude_containers = [_clean_text(r).lower() for r in (exclude_container_hint_contains or []) if _clean_text(r)]
    required = [(_clean_text(x).lower()) for x in (required_fields or ["name", "url"]) if _clean_text(x)]

    rows: list[dict[str, Any]] = []
    for row in refs:
        if not isinstance(row, dict):
            continue
        href = _clean_text(row.get("href") or row.get("url"))
        label = _clean_text(row.get("label") or row.get("text"))
        role = _clean_text(row.get("role")).lower()
        landmark = _clean_text(row.get("landmark_role")).lower()
        container_hint = _clean_text(row.get("container_hint")).lower()
        label_l = label.lower()
        if patterns and not any(p in href for p in patterns):
            continue
        if include_labels and not any(tok in label_l for tok in include_labels):
            continue
        if exclude_labels and any(tok in label_l for tok in exclude_labels):
            continue
        if role_allow and role not in role_allow:
            continue
        if include_landmarks and landmark not in include_landmarks:
            continue
        if exclude_landmarks and landmark in exclude_landmarks:
            continue
        if include_containers and not any(tok in container_hint for tok in include_containers):
            continue
        if exclude_containers and any(tok in container_hint for tok in exclude_containers):
            continue
        rows.append({"name": label, "url": href})

    count = len(rows)
    urls = [_clean_text(r.get("url")) for r in rows if _clean_text(r.get("url"))]
    names = [_clean_text(r.get("name")) for r in rows if _clean_text(r.get("name"))]

    unique_urls = len(set(urls)) if urls else 0
    unique_fraction = (unique_urls / len(urls)) if urls else 0.0
    name_non_empty_rate = (len(names) / count) if count else 0.0
    url_non_empty_rate = (len(urls) / count) if count else 0.0
    valid_url_rate = (sum(1 for u in urls if _url_is_valid(u)) / len(urls)) if urls else 0.0

    same_domain_rate = None
    if base_domain:
        bd = base_domain.lower().strip()
        if urls:
            same_domain_rate = sum(1 for u in urls if _domain_of(u).endswith(bd) or u.startswith("/")) / len(urls)
        else:
            same_domain_rate = 0.0

    required_ok = True
    if required:
        for field in required:
            if field == "name" and name_non_empty_rate < 0.95:
                required_ok = False
            if field == "url" and url_non_empty_rate < 0.95:
                required_ok = False

    count_in_range = min_items <= count <= max_items

    coverage_score = 35 if count_in_range else max(0, 35 - abs(min_items - count))
    completeness_score = int(25 * ((name_non_empty_rate + url_non_empty_rate) / 2.0))
    precision_proxy_score = int(20 * unique_fraction)
    validity_score = int(20 * valid_url_rate)
    fit_score = max(0, min(100, coverage_score + completeness_score + precision_proxy_score + validity_score))

    ok = bool(count > 0 and count_in_range and required_ok and fit_score >= 55)

    return {
        "ok": ok,
        "fit_score": fit_score,
        "metrics": {
            "count": count,
            "count_in_range": count_in_range,
            "min_items": min_items,
            "max_items": max_items,
            "name_non_empty_rate": round(name_non_empty_rate, 4),
            "url_non_empty_rate": round(url_non_empty_rate, 4),
            "valid_url_rate": round(valid_url_rate, 4),
            "unique_url_fraction": round(unique_fraction, 4),
            "same_domain_rate": round(same_domain_rate, 4) if same_domain_rate is not None else None,
            "required_fields_ok": required_ok,
        },
        "score_breakdown": {
            "coverage": coverage_score,
            "completeness": completeness_score,
            "precision_proxy": precision_proxy_score,
            "validity": validity_score,
        },
        "sample_items": rows[:8],
    }
