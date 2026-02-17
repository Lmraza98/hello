"""Reusable wait helpers for dynamic Sales Navigator pages."""

from __future__ import annotations

import asyncio
from typing import Any

from .selectors import SEL


class SalesNavWaits:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def wait_for_url_contains(self, fragment: str, timeout_seconds: float = 12.0) -> bool:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(0.5, timeout_seconds)
        needle = (fragment or "").lower()
        while loop.time() < deadline:
            if needle and needle in (self.page.url or "").lower():
                return True
            await asyncio.sleep(0.2)
        return False

    async def wait_for_salesnav_shell(self, timeout_ms: int = 20_000) -> None:
        await self.page.wait_for_selector(SEL.SALES_SEARCH_INPUT, state="visible", timeout=timeout_ms)

    async def wait_for_results_container(self, timeout_ms: int = 20_000) -> None:
        await self.page.wait_for_selector(SEL.RESULTS_CONTAINER, state="visible", timeout=timeout_ms)

    async def wait_for_lead_cards(self, min_count: int = 1, timeout_ms: int = 20_000) -> int:
        await self.page.wait_for_selector(SEL.LEAD_CARD, state="visible", timeout=timeout_ms)
        cards = self.page.locator(SEL.LEAD_CARD)
        await cards.nth(max(0, min_count - 1)).wait_for(state="visible", timeout=timeout_ms)
        return await cards.count()

    async def wait_for_company_cards(self, min_count: int = 1, timeout_ms: int = 20_000) -> int:
        await self.page.wait_for_selector(SEL.COMPANY_CARD, state="visible", timeout=timeout_ms)
        cards = self.page.locator(SEL.COMPANY_CARD)
        await cards.nth(max(0, min_count - 1)).wait_for(state="visible", timeout=timeout_ms)
        return await cards.count()
