from __future__ import annotations

import asyncio
import base64
import os
import random
import re
from typing import Any

from fastapi import HTTPException
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

import config
from api.routes.browser_stream import set_active_browser_page
from services.web_automation.browser.backends.base import BrowserBackend
from services.web_automation.browser.core.stealth import STEALTH_INIT_SCRIPT, STEALTH_LAUNCH_ARGS


INTERACTIVE_SELECTOR = (
    "a,button,input,textarea,select,"
    "[role='button'],[role='link'],[role='textbox'],[role='searchbox'],[role='combobox'],"
    "[contenteditable='true'],[tabindex]"
)


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
        "input": {"input", "textbox", "searchbox"},
        "textbox": {"input", "textbox", "searchbox"},
        "searchbox": {"input", "textbox", "searchbox"},
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


def _score_candidate(meta: dict[str, Any], cand: dict[str, Any]) -> int:
    meta_label = _norm_text(meta.get("label")).lower()
    meta_role = _norm_text(meta.get("role")).lower()
    meta_href = _norm_text(meta.get("href"))
    cand_label = _norm_text(cand.get("label")).lower()
    cand_role = _norm_text(cand.get("role")).lower()
    cand_href = _norm_text(cand.get("href"))

    score = 0
    if meta_href and cand_href:
        if cand_href == meta_href:
            score += 250
        elif cand_href.split("?", 1)[0] == meta_href.split("?", 1)[0]:
            score += 200
        elif meta_href in cand_href or cand_href in meta_href:
            score += 120

    if meta_role and cand_role:
        if cand_role == meta_role:
            score += 40
        elif meta_role in cand_role or cand_role in meta_role:
            score += 20

    if meta_label and cand_label:
        if cand_label == meta_label:
            score += 160
        elif meta_label in cand_label or cand_label in meta_label:
            score += 90
        else:
            mtoks = [t for t in meta_label.split() if len(t) >= 3]
            if mtoks:
                score += min(70, sum(14 for t in mtoks if t in cand_label))

    return score


class LocalPlaywrightBackend(BrowserBackend):
    def __init__(self) -> None:
        self._playwright = None
        self._browser = None
        self._context = None
        self._active_page = None
        self._active_tab_id: str | None = None

        self._snapshot_refs: dict[str, dict[str, dict[str, Any]]] = {}
        self._next_ref_id = 1
        self._snapshot_lock = asyncio.Lock()

    @staticmethod
    def _is_target_closed_error(exc: Exception) -> bool:
        text = str(exc or "").lower()
        return (
            isinstance(exc, PlaywrightError)
            and (
                "target page, context or browser has been closed" in text
                or "browser has been closed" in text
                or "context closed" in text
            )
        )

    def _reset_session_state(self) -> None:
        self._playwright = None
        self._browser = None
        self._context = None
        self._active_page = None
        self._active_tab_id = None
        self._snapshot_refs = {}
        self._next_ref_id = 1
        set_active_browser_page(None)

    async def _ensure_session(self) -> None:
        if self._browser and self._context:
            try:
                if hasattr(self._browser, "is_connected") and not self._browser.is_connected():
                    self._reset_session_state()
                elif self._active_page is None and self._context.pages:
                    self._active_page = self._context.pages[0]
                    self._active_tab_id = _tab_id_for(0)
                    set_active_browser_page(self._active_page)
                else:
                    return
            except Exception as exc:
                if self._is_target_closed_error(exc):
                    self._reset_session_state()
                else:
                    raise

        from playwright.async_api import async_playwright

        for attempt in range(2):
            try:
                self._playwright = await async_playwright().start()
                headless = (os.getenv("BROWSER_GATEWAY_HEADLESS", "false").strip().lower() == "true")
                self._browser = await self._playwright.chromium.launch(
                    headless=headless,
                    slow_mo=80,
                    args=STEALTH_LAUNCH_ARGS,
                )
                # Keep this reasonably current; allow override via env.
                ua = (
                    os.getenv("BROWSER_USER_AGENT")
                    or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
                )
                context_options: dict[str, Any] = {
                    "viewport": {"width": 1920, "height": 1080},
                    "user_agent": ua,
                    "locale": "en-US",
                    "timezone_id": "America/New_York",
                }
                storage_state_path = _resolve_linkedin_storage_state()
                if storage_state_path:
                    context_options["storage_state"] = storage_state_path
                self._context = await self._browser.new_context(**context_options)
                await self._context.add_init_script(STEALTH_INIT_SCRIPT)
                page = await self._context.new_page()
                self._active_page = page
                self._active_tab_id = _tab_id_for(0)
                set_active_browser_page(page)
                return
            except Exception as exc:
                if attempt == 0 and self._is_target_closed_error(exc):
                    self._reset_session_state()
                    continue
                self._reset_session_state()
                raise

    async def _resolve_page(self, tab_id: str | None):
        await self._ensure_session()
        if self._context is None:
            raise HTTPException(
                status_code=500,
                detail={"code": "browser_context_missing", "message": "Browser context missing"},
            )

        pages = self._context.pages
        if len(pages) == 0:
            page = await self._context.new_page()
            self._active_page = page
            self._active_tab_id = _tab_id_for(0)
            set_active_browser_page(page)
            return page, self._active_tab_id

        idx = None
        if tab_id:
            idx = _index_from_tab_id(tab_id)
            if idx == -1:
                tab_id = None
                idx = None
            elif idx is None or idx < 0:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "invalid_tab_id", "message": f"Unknown tab id: {tab_id}"},
                )
        if tab_id and idx is not None:
            if idx >= len(pages):
                if idx == len(pages):
                    page = await self._context.new_page()
                    pages = self._context.pages
                else:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "invalid_tab_id",
                            "message": f"Unknown tab id: {tab_id}. Existing tabs: {len(pages)}",
                        },
                    )
            page = pages[idx]
            self._active_page = page
            self._active_tab_id = _tab_id_for(idx)
            set_active_browser_page(page)
            return page, self._active_tab_id

        if self._active_page in pages:
            idx = pages.index(self._active_page)
            self._active_tab_id = _tab_id_for(idx)
            return self._active_page, self._active_tab_id

        self._active_page = pages[0]
        self._active_tab_id = _tab_id_for(0)
        set_active_browser_page(self._active_page)
        return self._active_page, self._active_tab_id

    async def get_raw_page(self, tab_id: str | None):
        """Best-effort access to the raw Playwright page (used by challenge resolvers).

        Not part of the public browser_nav API contract.
        """
        page, _ = await self._resolve_page(tab_id)
        return page

    async def _reroute_ref_index(self, page: Any, resolved_tab_id: str, ref: str) -> int | None:
        async with self._snapshot_lock:
            ref_map = self._snapshot_refs.get(resolved_tab_id) or {}
            meta = ref_map.get(ref)
            if not meta:
                return None

        try:
            candidates = await page.evaluate(
                """
                () => {
                  const nodes = Array.from(document.querySelectorAll(
                    'a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"],[contenteditable="true"],[tabindex]'
                  ));
                  const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                  };
                  const out = [];
                  for (let i = 0; i < nodes.length; i += 1) {
                    const el = nodes[i];
                    if (!isVisible(el)) continue;
                    const role = el.getAttribute('role') || el.tagName.toLowerCase();
                    const label = (
                      el.getAttribute('aria-label') ||
                      el.getAttribute('placeholder') ||
                      el.innerText ||
                      el.textContent ||
                      ''
                    ).trim().replace(/\\s+/g, ' ').slice(0, 200);
                    const href = (el.getAttribute && el.getAttribute('href')) || '';
                    out.push({ index: i, role, label, href });
                    if (out.length >= 800) break;
                  }
                  return out;
                }
                """
            )
        except Exception:
            return None

        if not isinstance(candidates, list) or not candidates:
            return None

        best_idx: int | None = None
        best_score = -1
        for cand in candidates:
            if not isinstance(cand, dict):
                continue
            s = _score_candidate(meta, cand)
            if s > best_score:
                best_score = s
                try:
                    best_idx = int(cand.get("index", -1))
                except Exception:
                    best_idx = None

        if best_idx is None or best_idx < 0 or best_score < 90:
            return None

        async with self._snapshot_lock:
            ref_map = self._snapshot_refs.get(resolved_tab_id) or {}
            if ref in ref_map:
                ref_map[ref]["index"] = int(best_idx)
                self._snapshot_refs[resolved_tab_id] = ref_map
        return int(best_idx)

    async def health(self) -> dict[str, Any]:
        await self._ensure_session()
        return {"ok": True, "mode": "local", "connected": True}

    async def tabs(self) -> dict[str, Any]:
        await self._ensure_session()
        if self._context is None:
            return {"tabs": [], "active_tab_id": None, "mode": "local"}
        tabs: list[dict[str, Any]] = []
        for i, page in enumerate(self._context.pages):
            title = ""
            try:
                title = await page.title()
            except Exception:
                title = ""
            tabs.append(
                {
                    "id": _tab_id_for(i),
                    "index": i,
                    "url": page.url or "",
                    "title": title,
                    "active": page == self._active_page,
                }
            )
        return {"tabs": tabs, "active_tab_id": self._active_tab_id, "mode": "local"}

    async def navigate(
        self,
        *,
        url: str,
        tab_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]:
        page, resolved_tab_id = await self._resolve_page(tab_id)
        nav_timeout_ms = max(1000, min(120_000, int(timeout_ms or 60_000)))
        settle_timeout_ms = max(500, min(20_000, nav_timeout_ms // 3))
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=nav_timeout_ms)
            try:
                await page.wait_for_load_state("networkidle", timeout=settle_timeout_ms)
            except Exception:
                pass
            await asyncio.sleep(0.8)
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"code": "navigate_failed", "message": str(exc)}) from exc
        title = ""
        try:
            title = await page.title()
        except Exception:
            title = ""
        try:
            if self._context and "linkedin.com" in (page.url or ""):
                storage_path = str(config.DATA_DIR / "linkedin_auth.json")
                await self._context.storage_state(path=storage_path)
        except Exception:
            pass
        return {"ok": True, "tab_id": resolved_tab_id, "url": page.url, "title": title, "mode": "local"}

    async def snapshot(self, *, tab_id: str | None = None, mode: str | None = None) -> dict[str, Any]:
        page, resolved_tab_id = await self._resolve_page(tab_id)
        snap_mode = (mode or "role").strip().lower()
        if snap_mode not in {"role", "ai"}:
            snap_mode = "role"

        elements = await page.evaluate(
            """
            () => {
              const nodes = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"],[contenteditable="true"],[tabindex]'));
              const isVisible = (el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
              };
              const out = [];
              for (let i = 0; i < nodes.length; i += 1) {
                const el = nodes[i];
                if (!isVisible(el)) continue;
                const role = el.getAttribute('role') || el.tagName.toLowerCase();
                const label = (
                  el.getAttribute('aria-label') ||
                  el.getAttribute('placeholder') ||
                  el.innerText ||
                  el.textContent ||
                  ''
                ).trim().replace(/\\s+/g, ' ').slice(0, 120);
                const href = (el.getAttribute && el.getAttribute('href')) || '';
                // Keep the index from the full selector pool so browser_act can target the same node.
                out.push({ index: i, role, label, href });
                if (out.length >= 300) break;
              }
              return out;
            }
            """
        )

        ref_map: dict[str, dict[str, Any]] = {}
        lines: list[str] = []
        async with self._snapshot_lock:
            for item in elements:
                idx = int(item.get("index", 0))
                role = str(item.get("role") or "element")
                label = str(item.get("label") or "").strip()
                href = str(item.get("href") or "").strip()
                ref = f"e{self._next_ref_id}" if snap_mode == "role" else str(self._next_ref_id)
                self._next_ref_id += 1
                ref_map[ref] = {"index": idx, "role": role, "label": label, "href": href}
                label_part = f' "{label}"' if label else ""
                href_part = f" -> {href}" if href else ""
                lines.append(f"[ref={ref}] {role}{label_part}{href_part}")
            self._snapshot_refs[resolved_tab_id] = ref_map

        return {
            "ok": True,
            "tab_id": resolved_tab_id,
            "mode": snap_mode,
            "elements_count": len(ref_map),
            "snapshot_text": "\n".join(lines),
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
        page, resolved_tab_id = await self._resolve_page(tab_id)
        query = (text or "").strip().lower()
        role_filter = (role or "").strip().lower()
        role_candidates = _role_aliases(role_filter)
        if not query:
            raise HTTPException(status_code=400, detail={"code": "invalid_query", "message": "text is required"})
        timeout_ms = max(0, min(int(timeout_ms), 30_000))
        poll_ms = max(100, min(int(poll_ms), 2_000))
        deadline = asyncio.get_event_loop().time() + (timeout_ms / 1000.0)

        async with self._snapshot_lock:
            ref_map = dict(self._snapshot_refs.get(resolved_tab_id) or {})

        while True:
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
                if "search" in query and ("search" in label or "query" in label):
                    score += 20
                if score > best_score:
                    best_ref = ref
                    best_score = score

            if best_ref:
                return {"ok": True, "tab_id": resolved_tab_id, "ref": best_ref, "score": best_score}

            if "search" in query or "keyword" in query:
                idx = await page.evaluate(
                    """
                    () => {
                      const all = Array.from(document.querySelectorAll(
                        'a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"],[contenteditable="true"],[tabindex]'
                      ));
                      const candidates = Array.from(document.querySelectorAll(
                        'input[type="search"],'
                        + 'input[placeholder*="Search" i],'
                        + 'input[aria-label*="Search" i],'
                        + 'input[name*="search" i],'
                        + 'input[placeholder*="keyword" i],'
                        + 'input[aria-label*="keyword" i],'
                        + 'input[name*="keyword" i],'
                        + 'textarea[placeholder*="Search" i],'
                        + 'textarea[placeholder*="keyword" i],'
                        + '[role="searchbox"],'
                        + '[role="textbox"][aria-label*="Search" i],'
                        + '[role="textbox"][aria-label*="keyword" i],'
                        + '[role="combobox"][aria-label*="Search" i],'
                        + '[role="combobox"][aria-label*="keyword" i],'
                        + '[contenteditable="true"][aria-label*="Search" i],'
                        + '[contenteditable="true"][aria-label*="keyword" i],'
                        + '[data-test-global-nav-typeahead-input]'
                      ));
                      const isVisible = (el) => {
                        const style = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                      };
                      const target = candidates.find(isVisible);
                      if (!target) return -1;
                      return all.findIndex((el) => el === target);
                    }
                    """
                )
                if isinstance(idx, int) and idx >= 0:
                    async with self._snapshot_lock:
                        live_map = self._snapshot_refs.get(resolved_tab_id) or {}
                        for r, meta in live_map.items():
                            if int(meta.get("index", -1)) == idx:
                                return {
                                    "ok": True,
                                    "tab_id": resolved_tab_id,
                                    "ref": r,
                                    "score": 60,
                                    "fallback": "dom_search_selector",
                                }
                        new_ref = f"e{self._next_ref_id}"
                        self._next_ref_id += 1
                        live_map[new_ref] = {"index": idx, "role": "input", "label": "Search"}
                        self._snapshot_refs[resolved_tab_id] = live_map
                        return {
                            "ok": True,
                            "tab_id": resolved_tab_id,
                            "ref": new_ref,
                            "score": 60,
                            "fallback": "dom_search_selector",
                        }

            if asyncio.get_event_loop().time() >= deadline:
                break

            await self.snapshot(tab_id=resolved_tab_id, mode="role")
            async with self._snapshot_lock:
                ref_map = dict(self._snapshot_refs.get(resolved_tab_id) or {})
            await asyncio.sleep(poll_ms / 1000.0)

        raise HTTPException(
            status_code=404,
            detail={"code": "ref_not_found", "message": f"No ref found for text '{text}'"},
        )

    async def act(
        self,
        *,
        action: str,
        ref: str | int | None = None,
        value: str | None = None,
        tab_id: str | None = None,
    ) -> dict[str, Any]:
        page, resolved_tab_id = await self._resolve_page(tab_id)
        action_norm = (action or "").strip().lower()

        def _is_valid_ref(token: str) -> bool:
            t = (token or "").strip()
            if not t:
                return False
            return bool(re.match(r"^e\d+$", t, flags=re.IGNORECASE))

        async def _resolve_label_to_ref(label: str) -> str | None:
            # Ensure we have a recent snapshot map to search.
            if resolved_tab_id not in self._snapshot_refs:
                await self.snapshot(tab_id=resolved_tab_id, mode="role")
            async with self._snapshot_lock:
                ref_map = dict(self._snapshot_refs.get(resolved_tab_id) or {})
            query = (label or "").strip().lower()
            if not query:
                return None
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

        async def _do_with_locator(locator: Any) -> None:
            if action_norm == "click":
                await locator.click(timeout=15_000)
                return
            if action_norm == "fill":
                await locator.fill(value or "", timeout=15_000)
                return
            if action_norm == "type":
                text = value or ""
                await locator.click(timeout=15_000)
                try:
                    await locator.press("Control+A", timeout=2_000)
                    await locator.press("Backspace", timeout=2_000)
                except Exception:
                    try:
                        await locator.fill("", timeout=3_000)
                    except Exception:
                        pass

                base_delay = int(os.getenv("BROWSER_HUMAN_TYPE_DELAY_MS", "65") or "65")
                jitter = int(os.getenv("BROWSER_HUMAN_TYPE_JITTER_MS", "35") or "35")
                delay = base_delay
                if jitter > 0:
                    delay = max(0, base_delay + random.randint(-jitter, jitter))
                await locator.type(text, delay=delay, timeout=15_000)
                return
            if action_norm == "press":
                await locator.press(value or "Enter", timeout=15_000)
                return
            if action_norm == "hover":
                await locator.hover(timeout=15_000)
                return
            if action_norm == "mousedown":
                box = await locator.bounding_box()
                if box and box.get("width", 0) > 0:
                    x = box["x"] + box["width"] * random.uniform(0.35, 0.65)
                    y = box["y"] + box["height"] * random.uniform(0.35, 0.65)
                    await page.mouse.move(x, y, steps=random.randint(5, 12))
                    await page.mouse.down()
                else:
                    await locator.hover(timeout=15_000)
                    await page.mouse.down()
                return
            if action_norm == "mouseup":
                await page.mouse.up()
                return
            if action_norm == "select":
                await locator.select_option(value or "", timeout=15_000)
                return
            raise HTTPException(
                status_code=400,
                detail={"code": "unsupported_action", "message": f"Unsupported action: {action_norm}"},
            )

        try:
            if action_norm == "evaluate":
                script = (value or "").strip()
                if not script:
                    raise HTTPException(
                        status_code=400,
                        detail={"code": "missing_script", "message": "value is required for evaluate"},
                    )
                result = await page.evaluate(script)
                return {"ok": True, "tab_id": resolved_tab_id, "action": action_norm, "url": page.url, "result": result}

            if ref is None:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "missing_ref", "message": "ref is required for this action"},
                )
            ref_str = str(ref)
            if not _is_valid_ref(ref_str):
                # If a caller accidentally passes a label instead of a ref (common in LLM plans),
                # try to resolve it from the latest snapshot map.
                resolved = await _resolve_label_to_ref(ref_str)
                if resolved:
                    ref_str = resolved
            async with self._snapshot_lock:
                ref_map = self._snapshot_refs.get(resolved_tab_id) or {}
                meta = ref_map.get(ref_str)
            if not meta:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "stale_or_unknown_ref", "message": f"Unknown ref {ref_str}. Run browser_snapshot again."},
                )
            idx = int(meta.get("index", 0))
            locator = page.locator(INTERACTIVE_SELECTOR).nth(idx)

            try:
                await _do_with_locator(locator)
            except PlaywrightTimeoutError:
                new_idx = await self._reroute_ref_index(page, resolved_tab_id, ref_str)
                if new_idx is None or new_idx == idx:
                    raise
                locator = page.locator(INTERACTIVE_SELECTOR).nth(int(new_idx))
                await _do_with_locator(locator)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"code": "act_failed", "message": str(exc)}) from exc

        return {"ok": True, "tab_id": resolved_tab_id, "ref": str(ref), "action": action_norm, "url": page.url}

    async def wait(self, *, ms: int, tab_id: str | None = None) -> dict[str, Any]:
        _, resolved_tab_id = await self._resolve_page(tab_id)
        await asyncio.sleep(ms / 1000.0)
        return {"ok": True, "tab_id": resolved_tab_id, "waited_ms": ms}

    async def screenshot(
        self,
        *,
        tab_id: str | None = None,
        full_page: bool | None = None,
    ) -> dict[str, Any]:
        page, resolved_tab_id = await self._resolve_page(tab_id)
        try:
            img = await page.screenshot(type="jpeg", quality=70, full_page=bool(full_page))
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"code": "screenshot_failed", "message": str(exc)}) from exc
        encoded = base64.b64encode(img).decode("utf-8")
        return {"ok": True, "tab_id": resolved_tab_id, "mime": "image/jpeg", "base64": encoded}

    async def shutdown(self) -> dict[str, Any]:
        closed = False
        try:
            if self._context is not None:
                await self._context.close()
                closed = True
        finally:
            try:
                if self._browser is not None:
                    await self._browser.close()
                    closed = True
            finally:
                try:
                    if self._playwright is not None:
                        await self._playwright.stop()
                        closed = True
                finally:
                    self._reset_session_state()
        return {"ok": True, "mode": "local", "closed": closed}
