from __future__ import annotations

import os
from typing import Any

from playwright.async_api import async_playwright

from api.routes.browser_stream import set_active_browser_page
from services.web_automation.browser.backends.local_playwright import (
    LocalPlaywrightBackend,
    _resolve_linkedin_storage_state,
    _tab_id_for,
)
from services.web_automation.browser.core.stealth import STEALTH_INIT_SCRIPT


class CamoufoxBackend(LocalPlaywrightBackend):
    """Firefox/Camoufox-backed browser backend.

    This backend keeps the exact BrowserBackend API and behavior used by the
    existing local Playwright backend. The only intentional change is browser
    engine/bootstrap so anti-bot-heavy sites can run with a Camoufox profile.
    """

    async def _ensure_session(self) -> None:
        if self._browser and self._context:
            if self._active_page is None and self._context.pages:
                self._active_page = self._context.pages[0]
                self._active_tab_id = _tab_id_for(0)
                set_active_browser_page(self._active_page)
            return

        self._playwright = await async_playwright().start()
        headless = (os.getenv("CAMOUFOX_HEADLESS") or os.getenv("BROWSER_GATEWAY_HEADLESS") or "false").strip().lower() == "true"
        executable_path = (os.getenv("CAMOUFOX_EXECUTABLE_PATH") or "").strip() or None

        launch_args = [
            "--no-remote",
        ]
        self._browser = await self._playwright.firefox.launch(
            headless=headless,
            executable_path=executable_path,
            args=launch_args,
        )

        ua = (
            os.getenv("BROWSER_USER_AGENT")
            or "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0"
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

    async def health(self) -> dict[str, Any]:
        out = await super().health()
        out["mode"] = "camoufox"
        return out

    async def tabs(self) -> dict[str, Any]:
        out = await super().tabs()
        out["mode"] = "camoufox"
        return out

    async def navigate(
        self,
        *,
        url: str,
        tab_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]:
        out = await super().navigate(url=url, tab_id=tab_id, timeout_ms=timeout_ms)
        out["mode"] = "camoufox"
        return out
