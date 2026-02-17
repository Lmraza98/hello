from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from typing import Any

import httpx
from fastapi import HTTPException

import config
from services.browser_backends.base import BrowserBackend


GATEWAY_TIMEOUT_SECONDS = 45
PROXY_BASE_DEFAULT = "http://127.0.0.1:9223"
DEFAULT_ACT_TIMEOUT_MS = max(5000, min(60_000, int(os.getenv("BROWSER_ACT_TIMEOUT_MS", "15000") or "15000")))
DEFAULT_OPENCLAW_AI_SNAPSHOT_MAX_CHARS = max(
    2000,
    min(
        120_000,
        int(os.getenv("BROWSER_OPENCLAW_AI_SNAPSHOT_MAX_CHARS", "20000") or "20000"),
    ),
)


_SNAP_LINE_RE = re.compile(
    r'^\s*-\s*(?P<role>[^ \t\[]+)(?:\s+"(?P<label>[^"]*)")?.*?\[ref=(?P<ref>[^\]]+)\]'
)
_SNAP_URL_RE = re.compile(r"^\s*-\s*/url:\s*(?P<url>\S+)\s*$")


def _norm_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _tab_id_for(index: int) -> str:
    return f"tab-{index}"


def _index_from_tab_id(tab_id: str) -> int | None:
    if not tab_id:
        return None
    lowered = tab_id.strip().lower()
    if lowered in {"current", "active", "focused", "this"}:
        return -1
    if tab_id.startswith("tab-"):
        raw = tab_id[4:].strip()
    elif tab_id.startswith("tab_"):
        raw = tab_id[4:].strip()
    else:
        return None
    if not raw.isdigit():
        return None
    return int(raw)


def _role_aliases(role_filter: str) -> set[str]:
    role = role_filter.strip().lower()
    if not role:
        return set()
    aliases: dict[str, set[str]] = {
        "input": {"input", "textbox", "searchbox", "combobox"},
        "textbox": {"input", "textbox", "searchbox", "combobox"},
        "searchbox": {"input", "textbox", "searchbox", "combobox"},
        "combobox": {"combobox", "searchbox", "textbox", "input"},
        "button": {"button"},
        "link": {"link", "a"},
    }
    return aliases.get(role, {role})


def _resolve_linkedin_storage_state() -> str | None:
    candidates = [
        config.DATA_DIR / "linkedin_auth.json",
        config.DATA_DIR / "linkedin_regular_auth.json",
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    return None


class OpenClawBackend(BrowserBackend):
    def __init__(self) -> None:
        self._last_target_id: str | None = None
        self._tab_map: dict[str, str] = {}
        self._target_map: dict[str, str] = {}
        self._linkedin_cookies_loaded = False

        # Latest snapshot refs per tab_id (in-memory matching for find_ref).
        self._snapshot_refs: dict[str, dict[str, dict[str, Any]]] = {}
        self._snapshot_lock = asyncio.Lock()

    def _base_url(self) -> str:
        raw = (
            os.getenv("OPENCLAW_BROWSER_BASE_URL")
            or os.getenv("BROWSER_GATEWAY_BASE_URL")
            or PROXY_BASE_DEFAULT
        ).strip()
        return raw.rstrip("/")

    def _auth_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        token = (os.getenv("OPENCLAW_BROWSER_AUTH_TOKEN") or os.getenv("OPENCLAW_BROWSER_TOKEN") or "").strip()
        password = (os.getenv("OPENCLAW_BROWSER_PASSWORD") or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        elif password:
            headers["x-openclaw-password"] = password
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
    ) -> Any:
        base = self._base_url()
        url = f"{base}/{path.lstrip('/')}"
        params = {k: v for k, v in (query or {}).items() if v is not None} or None
        timeout = httpx.Timeout(GATEWAY_TIMEOUT_SECONDS, connect=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, headers=self._auth_headers()) as client:
                response = await client.request(method, url, json=payload, params=params)
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "openclaw_unreachable",
                    "message": f"OpenClaw browser bridge is not reachable at {base}",
                },
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail={"code": "openclaw_error", "message": str(exc)}) from exc

        if response.status_code >= 400:
            detail: Any
            try:
                detail = response.json()
            except ValueError:
                detail = {"message": response.text}
            raise HTTPException(
                status_code=response.status_code,
                detail={
                    "code": "openclaw_request_failed",
                    "message": "OpenClaw browser bridge request failed",
                    "details": detail,
                },
            )
        content_type = (response.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            return response.json()
        return {"ok": True, "raw": response.text}

    async def _ensure_running(self) -> dict[str, Any]:
        out = await self._request("GET", "/tabs")
        if isinstance(out, dict) and out.get("running") is False:
            try:
                await self._request("POST", "/start")
            except Exception:
                pass
            out = await self._request("GET", "/tabs")
        return out if isinstance(out, dict) else {"running": False, "tabs": []}

    async def _refresh_tab_maps(self) -> list[dict[str, Any]]:
        out = await self._ensure_running()
        raw_tabs = out.get("tabs") if isinstance(out, dict) else []
        rows: list[dict[str, Any]] = raw_tabs if isinstance(raw_tabs, list) else []

        # Keep tab ids stable across refreshes.
        #
        # OpenClaw's /tabs ordering can change (new tabs, anti-bot interstitials, etc.).
        # If we map tab ids purely by list index, `tab-0` can suddenly refer to a
        # different targetId between `find_ref()` and `act()`, which shows up as
        # "Timeout waiting for locator('aria-ref=e...')" on the wrong page.
        #
        # We preserve any existing targetId->tab_id assignment and only allocate
        # new ids for unseen targets.
        next_tab_map: dict[str, str] = {}
        next_target_map: dict[str, str] = {}
        existing_target_map = dict(self._target_map)
        used_tab_ids: set[str] = set()

        def _alloc_tab_id() -> str:
            i = 0
            while True:
                tid = _tab_id_for(i)
                if tid not in used_tab_ids:
                    used_tab_ids.add(tid)
                    return tid
                i += 1

        # First pass: keep prior assignments when possible
        for row in rows:
            if not isinstance(row, dict):
                continue
            target_id = _norm_text(row.get("targetId"))
            if not target_id:
                continue
            prior = existing_target_map.get(target_id)
            if prior:
                used_tab_ids.add(prior)
                next_tab_map[prior] = target_id
                next_target_map[target_id] = prior
            if not self._last_target_id and _norm_text(row.get("type")) == "page":
                self._last_target_id = target_id

        # Second pass: assign new tab ids for any new targets
        for row in rows:
            if not isinstance(row, dict):
                continue
            target_id = _norm_text(row.get("targetId"))
            if not target_id:
                continue
            if target_id in next_target_map:
                continue
            tab_id = _alloc_tab_id()
            next_tab_map[tab_id] = target_id
            next_target_map[target_id] = tab_id
            if not self._last_target_id and _norm_text(row.get("type")) == "page":
                self._last_target_id = target_id

        self._tab_map = next_tab_map
        self._target_map = next_target_map
        return rows

    async def _target_id_from_tab_id(self, tab_id: str | None) -> str | None:
        if not tab_id:
            return None
        lowered = tab_id.strip().lower()
        if lowered in {"current", "active", "focused", "this"}:
            return None
        idx = _index_from_tab_id(tab_id)
        if idx is not None:
            if idx < 0:
                return None
            await self._refresh_tab_maps()
            target = self._tab_map.get(_tab_id_for(idx))
            if target:
                self._last_target_id = target
            return target
        self._last_target_id = tab_id
        return tab_id

    async def _tab_id_from_target_id(self, target_id: str | None) -> str | None:
        if not target_id:
            return None
        await self._refresh_tab_maps()
        return self._target_map.get(target_id)

    async def _maybe_load_linkedin_cookies(self, target_id: str | None) -> None:
        if self._linkedin_cookies_loaded:
            return
        storage_state_path = _resolve_linkedin_storage_state()
        if not storage_state_path:
            return
        try:
            raw = json.loads(open(storage_state_path, "r", encoding="utf-8").read())
            cookies = raw.get("cookies") if isinstance(raw, dict) else None
            cookie_rows = cookies if isinstance(cookies, list) else []
        except Exception:
            return
        if not cookie_rows:
            return

        for row in cookie_rows:
            if not isinstance(row, dict):
                continue
            name = _norm_text(row.get("name"))
            value = str(row.get("value") if row.get("value") is not None else "")
            domain = _norm_text(row.get("domain"))
            path = _norm_text(row.get("path")) or "/"
            if not name or not domain:
                continue
            payload: dict[str, Any] = {
                "cookie": {
                    "name": name,
                    "value": value,
                    "domain": domain,
                    "path": path,
                }
            }
            expires = row.get("expires")
            if isinstance(expires, (int, float)) and expires > 0:
                payload["cookie"]["expires"] = expires
            if isinstance(row.get("httpOnly"), bool):
                payload["cookie"]["httpOnly"] = row.get("httpOnly")
            if isinstance(row.get("secure"), bool):
                payload["cookie"]["secure"] = row.get("secure")
            same_site = row.get("sameSite")
            if same_site in {"Lax", "None", "Strict"}:
                payload["cookie"]["sameSite"] = same_site
            if target_id:
                payload["targetId"] = target_id
            try:
                await self._request("POST", "/cookies/set", payload)
            except Exception:
                continue

        self._linkedin_cookies_loaded = True

    async def health(self) -> dict[str, Any]:
        out = await self._ensure_running()
        running = bool(isinstance(out, dict) and out.get("running"))
        return {"ok": True, "mode": "openclaw", "connected": running}

    async def tabs(self) -> dict[str, Any]:
        rows = await self._refresh_tab_maps()
        tabs: list[dict[str, Any]] = []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            target_id = _norm_text(row.get("targetId"))
            tab_id = self._target_map.get(target_id) if target_id else None
            tabs.append(
                {
                    "id": tab_id or _tab_id_for(i),
                    "index": i,
                    "url": _norm_text(row.get("url")),
                    "title": _norm_text(row.get("title")),
                    "active": bool(self._last_target_id and target_id and target_id == self._last_target_id),
                    "target_id": target_id,
                }
            )
        active_tab_id = await self._tab_id_from_target_id(self._last_target_id)
        return {"tabs": tabs, "active_tab_id": active_tab_id, "mode": "openclaw"}

    async def navigate(
        self,
        *,
        url: str,
        tab_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]:
        target_id = await self._target_id_from_tab_id(tab_id)
        if "linkedin.com" in (url or "").lower():
            await self._maybe_load_linkedin_cookies(target_id)
        payload: dict[str, Any] = {"url": url}
        if target_id:
            payload["targetId"] = target_id
        if timeout_ms is not None:
            payload["timeoutMs"] = int(max(1000, min(120_000, int(timeout_ms))))
        out = await self._request("POST", "/navigate", payload)
        if not isinstance(out, dict):
            return {"ok": True, "tab_id": tab_id, "url": url, "mode": "openclaw"}
        resolved_target = _norm_text(out.get("targetId")) or target_id
        if resolved_target:
            self._last_target_id = resolved_target
        resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
        return {
            "ok": True,
            "tab_id": resolved_tab_id,
            "url": _norm_text(out.get("url")) or url,
            "title": _norm_text(out.get("title")),
            "mode": "openclaw",
        }

    async def snapshot(self, *, tab_id: str | None = None, mode: str | None = None) -> dict[str, Any]:
        snap_mode = (mode or "role").strip().lower()
        if snap_mode not in {"role", "ai"}:
            snap_mode = "role"
        target_id = await self._target_id_from_tab_id(tab_id)

        # OpenClaw supports multiple snapshot shapes under format=ai:
        # - Full AI snapshot (Playwright _snapshotForAI): includes "/url:" lines needed for href-based extraction.
        # - Role snapshot (ariaSnapshot): stable roleRefs mapping used by click/type actions.
        #
        # We use:
        # - mode="role" for action planning (stable refs; no hrefs)
        # - mode="ai" for extraction (href-aware snapshot)
        if snap_mode == "ai":
            query: dict[str, Any] = {
                "targetId": target_id,
                "format": "ai",
                "maxChars": DEFAULT_OPENCLAW_AI_SNAPSHOT_MAX_CHARS,
            }
        else:
            query = {
                "targetId": target_id,
                "format": "ai",
                # IMPORTANT:
                # Use refs=role snapshots (ariaSnapshot + getByRole selectors) instead of refs=aria.
                #
                # refs=aria relies on Playwright's private _snapshotForAI and "aria-ref=e123" locators.
                # On some sites (notably LinkedIn SalesNav), those aria-ref locators can drift or fail
                # to resolve between snapshot and act. refs=role stores a roleRefs map and makes ref
                # resolution deterministic via getByRole(..., exact=True) + nth().
                "refs": "role",
                # Force a role snapshot so /snapshot always emits refs (instead of an AI-only snapshot).
                "interactive": True,
            }

        out = await self._request("GET", "/snapshot", query=query)
        if not isinstance(out, dict) or not out.get("ok"):
            return {
                "ok": False,
                "tab_id": tab_id,
                "mode": snap_mode,
                "elements_count": 0,
                "snapshot_text": "",
                "refs": [],
            }
        resolved_target = _norm_text(out.get("targetId")) or target_id
        if resolved_target:
            self._last_target_id = resolved_target
        resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id or ""

        snapshot_text_raw = str(out.get("snapshot") or "").strip()
        ref_map: dict[str, dict[str, Any]] = {}
        lines: list[str] = []

        last_ref: str | None = None
        for line in snapshot_text_raw.splitlines():
            m_url = _SNAP_URL_RE.match(line)
            if m_url and last_ref and last_ref in ref_map:
                href = (m_url.group("url") or "").strip()
                if href:
                    ref_map[last_ref]["href"] = href
                continue

            m = _SNAP_LINE_RE.match(line)
            if not m:
                continue
            role_raw = (m.group("role") or "").strip()
            if role_raw.startswith("/"):
                continue
            ref = (m.group("ref") or "").strip()
            if not ref:
                continue
            label = (m.group("label") or "").strip()

            role = role_raw.strip().strip("'").strip('"').strip()
            role_norm = role.lower() if role else "element"

            ref_map[ref] = {"role": role_norm, "label": label}
            last_ref = ref

            label_part = f' "{label}"' if label else ""
            lines.append(f"[ref={ref}] {role}{label_part}")

        async with self._snapshot_lock:
            self._snapshot_refs[resolved_tab_id] = ref_map

        snapshot_text = snapshot_text_raw or "\n".join(lines) or "(empty)"
        return {
            "ok": True,
            "tab_id": resolved_tab_id,
            "mode": snap_mode,
            "elements_count": len(ref_map),
            "snapshot_text": snapshot_text,
            "refs": [{"ref": ref, **meta} for ref, meta in ref_map.items()],
        }

    async def find_ref(
        self,
        *,
        text: str,
        role: str | None = None,
        tab_id: str | None = None,
        timeout_ms: int = 8000,
        poll_ms: int = 400,
    ) -> dict[str, Any]:
        query = (text or "").strip().lower()
        role_filter = (role or "").strip().lower()
        role_candidates = _role_aliases(role_filter)
        if not query:
            raise HTTPException(status_code=400, detail={"code": "invalid_query", "message": "text is required"})

        # OpenClaw pages can re-render frequently (SPA). Refs can be absent briefly after navigation
        # even though they exist once the UI settles. Honor timeout_ms/poll_ms by refreshing the
        # snapshot and retrying until the element appears.
        timeout_ms = max(0, min(int(timeout_ms), 30_000))
        poll_ms = max(250, min(int(poll_ms), 2_000))
        deadline = asyncio.get_event_loop().time() + (timeout_ms / 1000.0)

        tab_key = tab_id or ""
        attempt = 0
        while True:
            attempt += 1
            # Always refresh at least once; the page may have changed since the last snapshot.
            try:
                await self.snapshot(tab_id=tab_id, mode="role")
            except Exception:
                # Snapshot is best-effort for ref discovery; fall back to any cached refs.
                pass

            async with self._snapshot_lock:
                ref_map = dict(self._snapshot_refs.get(tab_key) or {})

            best_ref = None
            best_score = -1
            for ref, meta in ref_map.items():
                label = str(meta.get("label") or "").strip().lower()
                m_role = str(meta.get("role") or "").strip().lower()
                if role_candidates and m_role not in role_candidates:
                    continue
                if not label:
                    continue
                score = 0
                if label == query:
                    score = 100
                elif query in label:
                    score = 70
                else:
                    q_tokens = [t for t in query.split() if len(t) >= 2]
                    score = sum(10 for t in q_tokens if t in label)
                if score > best_score:
                    best_ref = ref
                    best_score = score

            if best_ref:
                return {"ok": True, "tab_id": tab_id or tab_key, "ref": best_ref, "score": best_score, "attempt": attempt}

            if timeout_ms <= 0 or asyncio.get_event_loop().time() >= deadline:
                raise HTTPException(
                    status_code=404,
                    detail={"code": "ref_not_found", "message": f"No ref found for text '{text}'"},
                )
            await asyncio.sleep(poll_ms / 1000.0)

    async def act(
        self,
        *,
        action: str,
        ref: str | int | None = None,
        value: str | None = None,
        tab_id: str | None = None,
    ) -> dict[str, Any]:
        action_norm = (action or "").strip().lower()
        target_id = await self._target_id_from_tab_id(tab_id)
        ref_str = str(ref) if ref is not None else None

        def _is_valid_ref(token: str | None) -> bool:
            if not token:
                return False
            t = token.strip()
            if not t:
                return False
            # OpenClaw role refs look like "e204". Local backend may emit numeric refs as strings.
            return bool(re.match(r"^(e\d+|\d+)$", t, flags=re.IGNORECASE))

        def _extract_openclaw_error(exc: HTTPException) -> str:
            try:
                detail = exc.detail if isinstance(exc.detail, dict) else {}
                details = detail.get("details") if isinstance(detail, dict) else {}
                if isinstance(details, dict) and isinstance(details.get("error"), str):
                    return details["error"]
            except Exception:
                pass
            return ""

        def _is_timeout_like(err: str) -> bool:
            e = (err or "").lower()
            return "timeouterror" in e or "timeout" in e

        async def _scroll_into_view(best_effort_ref: str) -> None:
            try:
                await self._request(
                    "POST",
                    "/act",
                    _with_target({"kind": "scrollIntoView", "ref": best_effort_ref, "timeoutMs": DEFAULT_ACT_TIMEOUT_MS}),
                )
            except Exception:
                # best-effort only
                return

        async def _maybe_resolve_label_to_ref(label: str) -> str | None:
            """If caller passed a label instead of a ref, try to resolve it from the last snapshot."""
            tab_key = tab_id or ""
            if tab_key not in self._snapshot_refs:
                await self.snapshot(tab_id=tab_id, mode="role")
            async with self._snapshot_lock:
                ref_map = dict(self._snapshot_refs.get(tab_key) or {})
            query = (label or "").strip().lower()
            if not query:
                return None
            # Prefer "search input" like roles for typing/filling.
            role_candidates: set[str] = set()
            if action_norm in {"type", "fill"}:
                role_candidates = set(_role_aliases("combobox")) | set(_role_aliases("textbox")) | set(_role_aliases("searchbox"))

            best_ref = None
            best_score = -1
            for r, meta in ref_map.items():
                m_label = str(meta.get("label") or "").strip().lower()
                m_role = str(meta.get("role") or "").strip().lower()
                if role_candidates and m_role and m_role not in role_candidates:
                    continue
                if not m_label:
                    continue
                score = 0
                if m_label == query:
                    score = 100
                elif query in m_label:
                    score = 70
                else:
                    q_tokens = [t for t in query.split() if len(t) >= 2]
                    score = sum(10 for t in q_tokens if t in m_label)
                if score > best_score:
                    best_ref = r
                    best_score = score
            if best_ref and best_score >= 30:
                return best_ref
            return None

        if action_norm == "evaluate":
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "unsupported_action",
                    "message": "evaluate is disabled in openclaw mode. Use snapshot+act primitives and skills instead.",
                },
            )

        def _with_target(payload: dict[str, Any]) -> dict[str, Any]:
            if target_id:
                payload["targetId"] = target_id
            return payload

        if action_norm == "click":
            if not ref_str:
                raise HTTPException(status_code=400, detail={"code": "missing_ref", "message": "ref is required for click"})
            if not _is_valid_ref(ref_str):
                resolved = await _maybe_resolve_label_to_ref(ref_str)
                if resolved:
                    ref_str = resolved
            try:
                await _scroll_into_view(ref_str)
                out = await self._request(
                    "POST",
                    "/act",
                    _with_target({"kind": "click", "ref": ref_str, "timeoutMs": DEFAULT_ACT_TIMEOUT_MS}),
                )
            except HTTPException as exc:
                err = _extract_openclaw_error(exc)
                if exc.status_code >= 400 and _is_timeout_like(err):
                    await _scroll_into_view(ref_str)
                    out = await self._request(
                        "POST",
                        "/act",
                        _with_target({"kind": "click", "ref": ref_str, "timeoutMs": min(60_000, DEFAULT_ACT_TIMEOUT_MS * 2)}),
                    )
                else:
                    raise
            resolved_target = _norm_text(out.get("targetId")) if isinstance(out, dict) else target_id
            if resolved_target:
                self._last_target_id = resolved_target
            resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
            return {"ok": True, "tab_id": resolved_tab_id, "ref": ref_str, "action": action_norm, "url": _norm_text(out.get("url")) if isinstance(out, dict) else ""}

        if action_norm in {"type", "fill"}:
            if not ref_str:
                raise HTTPException(status_code=400, detail={"code": "missing_ref", "message": "ref is required for type"})
            if not _is_valid_ref(ref_str):
                resolved = await _maybe_resolve_label_to_ref(ref_str)
                if resolved:
                    ref_str = resolved
            text = value or ""
            # First attempt: human-like typing (click + type). This can fail on some sites if the element
            # is partially occluded; fallback to fill (no click) if we see click timeouts.
            try:
                await _scroll_into_view(ref_str)
                out = await self._request(
                    "POST",
                    "/act",
                    _with_target(
                        {
                            "kind": "type",
                            "ref": ref_str,
                            "text": text,
                            "slowly": True,
                            "submit": False,
                            "timeoutMs": DEFAULT_ACT_TIMEOUT_MS,
                        }
                    ),
                )
            except HTTPException as exc:
                err = _extract_openclaw_error(exc)
                if exc.status_code >= 400 and _is_timeout_like(err) and "locator.click" in (err or "").lower():
                    await _scroll_into_view(ref_str)
                    out = await self._request(
                        "POST",
                        "/act",
                        _with_target(
                            {
                                "kind": "type",
                                "ref": ref_str,
                                "text": text,
                                "slowly": False,
                                "submit": False,
                                "timeoutMs": min(60_000, DEFAULT_ACT_TIMEOUT_MS * 2),
                            }
                        ),
                    )
                elif exc.status_code >= 400 and _is_timeout_like(err):
                    await _scroll_into_view(ref_str)
                    out = await self._request(
                        "POST",
                        "/act",
                        _with_target(
                            {
                                "kind": "type",
                                "ref": ref_str,
                                "text": text,
                                "slowly": True,
                                "submit": False,
                                "timeoutMs": min(60_000, DEFAULT_ACT_TIMEOUT_MS * 2),
                            }
                        ),
                    )
                else:
                    raise
            resolved_target = _norm_text(out.get("targetId")) if isinstance(out, dict) else target_id
            if resolved_target:
                self._last_target_id = resolved_target
            resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
            return {"ok": True, "tab_id": resolved_tab_id, "ref": ref_str, "action": action_norm, "url": _norm_text(out.get("url")) if isinstance(out, dict) else ""}

        if action_norm == "press":
            out = await self._request("POST", "/act", _with_target({"kind": "press", "key": value or "Enter"}))
            resolved_target = _norm_text(out.get("targetId")) if isinstance(out, dict) else target_id
            if resolved_target:
                self._last_target_id = resolved_target
            resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
            return {"ok": True, "tab_id": resolved_tab_id, "action": action_norm, "url": _norm_text(out.get("url")) if isinstance(out, dict) else ""}

        if action_norm == "hover":
            if not ref_str:
                raise HTTPException(status_code=400, detail={"code": "missing_ref", "message": "ref is required for hover"})
            if not _is_valid_ref(ref_str):
                resolved = await _maybe_resolve_label_to_ref(ref_str)
                if resolved:
                    ref_str = resolved
            out = await self._request("POST", "/act", _with_target({"kind": "hover", "ref": ref_str}))
            resolved_target = _norm_text(out.get("targetId")) if isinstance(out, dict) else target_id
            if resolved_target:
                self._last_target_id = resolved_target
            resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
            return {"ok": True, "tab_id": resolved_tab_id, "ref": ref_str, "action": action_norm}

        if action_norm == "select":
            if not ref_str:
                raise HTTPException(status_code=400, detail={"code": "missing_ref", "message": "ref is required for select"})
            val = (value or "").strip()
            if not val:
                raise HTTPException(status_code=400, detail={"code": "missing_value", "message": "value is required for select"})
            if not _is_valid_ref(ref_str):
                resolved = await _maybe_resolve_label_to_ref(ref_str)
                if resolved:
                    ref_str = resolved
            out = await self._request("POST", "/act", _with_target({"kind": "select", "ref": ref_str, "values": [val]}))
            resolved_target = _norm_text(out.get("targetId")) if isinstance(out, dict) else target_id
            if resolved_target:
                self._last_target_id = resolved_target
            resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
            return {"ok": True, "tab_id": resolved_tab_id, "ref": ref_str, "action": action_norm}

        raise HTTPException(status_code=400, detail={"code": "unsupported_action", "message": f"Unsupported action: {action_norm}"})

    async def wait(self, *, ms: int, tab_id: str | None = None) -> dict[str, Any]:
        target_id = await self._target_id_from_tab_id(tab_id)
        payload: dict[str, Any] = {"kind": "wait", "timeMs": int(ms)}
        if target_id:
            payload["targetId"] = target_id
        out = await self._request("POST", "/act", payload)
        resolved_target = _norm_text(out.get("targetId")) if isinstance(out, dict) else target_id
        if resolved_target:
            self._last_target_id = resolved_target
        resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
        return {"ok": True, "tab_id": resolved_tab_id, "waited_ms": ms}

    async def screenshot(self, *, tab_id: str | None = None, full_page: bool | None = None) -> dict[str, Any]:
        target_id = await self._target_id_from_tab_id(tab_id)
        payload: dict[str, Any] = {"fullPage": bool(full_page)}
        if target_id:
            payload["targetId"] = target_id
        out = await self._request("POST", "/screenshot", payload)
        if not isinstance(out, dict) or not out.get("ok") or not out.get("path"):
            raise HTTPException(status_code=502, detail={"code": "screenshot_failed", "message": "OpenClaw screenshot failed"})
        path = str(out.get("path"))
        try:
            with open(path, "rb") as f:
                img = f.read()
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"code": "screenshot_read_failed", "message": str(exc)}) from exc
        encoded = base64.b64encode(img).decode("utf-8")
        resolved_target = _norm_text(out.get("targetId")) or target_id
        if resolved_target:
            self._last_target_id = resolved_target
        resolved_tab_id = await self._tab_id_from_target_id(resolved_target) or tab_id
        return {"ok": True, "tab_id": resolved_tab_id, "mime": "image/png", "base64": encoded}
