"""Navigation helpers for Sales Navigator account workflows."""

from __future__ import annotations

import asyncio
from typing import Any

from .selectors import SEL
from .operations import run_operation_with_retries


class SalesNavNavigator:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def go_to_account_search(self) -> bool:
        async def _op() -> bool:
            await self.page.goto(SEL.ACCOUNT_SEARCH_URL, timeout=30_000)
            await self.page.wait_for_load_state("domcontentloaded", timeout=15_000)
            await self.scraper.waits.wait_for_salesnav_shell()
            tab = self.page.locator(SEL.ACCOUNT_SEARCH_TAB).first
            if await tab.count() > 0:
                selected = await tab.get_attribute("aria-selected")
                if str(selected).lower() != "true":
                    await tab.click()
                    await asyncio.sleep(0.5)
            return True

        try:
            return bool(
                await run_operation_with_retries(
                    op_name="go_to_account_search",
                    fn=_op,
                    retries=2,
                    debug=self.scraper.debugger,
                )
            )
        except Exception:
            return False

