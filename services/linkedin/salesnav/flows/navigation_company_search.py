"""Company search and navigation flow helpers."""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from ..core.selectors import SEL


class SalesNavCompanySearchFlow:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def search_company(self, company_name: str) -> Optional[str]:
        import random

        print(f"[LinkedIn] Searching for company: {company_name}")
        try:
            current_url = self.page.url
            if "/sales/home" not in current_url:
                await self.page.goto(SEL.SALES_HOME_URL, timeout=30000)
                await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
                await self.scraper.waits.wait_for_salesnav_shell(timeout_ms=20_000)
                await asyncio.sleep(random.uniform(1, 2))
            else:
                await asyncio.sleep(random.uniform(0.5, 1))

            print("[LinkedIn] Using search bar...")
            search_input = self.page.locator(SEL.SALES_SEARCH_INPUT).first
            try:
                await search_input.wait_for(state="visible", timeout=10000)
                await search_input.click()
                await asyncio.sleep(random.uniform(0.5, 1.5))
                await search_input.fill("")
                await asyncio.sleep(0.5)
                await search_input.fill(company_name)
                await asyncio.sleep(random.uniform(1, 2))
                await search_input.press("Enter")
                await self.scraper.waits.wait_for_results_container(timeout_ms=20_000)
                await asyncio.sleep(random.uniform(1.0, 1.8))
            except Exception as exc:
                print(f"[LinkedIn] Search bar error: {exc}")
                return None

            print("[LinkedIn] Switching to Accounts tab...")
            accounts_tab = self.page.locator('button:has-text("Accounts")').or_(
                self.page.locator('button:has-text("Account")')
            ).first
            try:
                if await accounts_tab.count() > 0:
                    await accounts_tab.click()
                    await asyncio.sleep(random.uniform(1.0, 1.8))
            except Exception:
                pass

            print("[LinkedIn] Looking for company in results...")
            company_link = self.page.locator('a[href*="/sales/company/"]').first
            if await company_link.count() > 0:
                await company_link.click()
                await asyncio.sleep(random.uniform(1.0, 1.8))
                if "/sales/company/" in self.page.url:
                    print(f"[LinkedIn] On company profile: {self.page.url}")
                    return self.page.url
            print(f"[LinkedIn] Company not found: {company_name}")
            return None
        except Exception as exc:
            print(f"[LinkedIn] Search error: {exc}")
            return None

    async def click_decision_makers(self) -> bool:
        import random

        print("[LinkedIn] Looking for Decision Makers link...")
        try:
            await asyncio.sleep(random.uniform(1, 2))
            dm_link = self.page.locator(SEL.DECISION_MAKERS_ENTRY).first
            if await dm_link.count() > 0:
                print("[LinkedIn] Clicking Decision Makers...")
                await dm_link.click()
                await self.scraper.waits.wait_for_results_container(timeout_ms=20_000)
                await asyncio.sleep(random.uniform(0.8, 1.5))
                print(f"[LinkedIn] Now on: {self.page.url}")
                return True
            await self.page.evaluate("window.scrollTo(0, 500)")
            await asyncio.sleep(random.uniform(2, 3))
            if await dm_link.count() > 0:
                await dm_link.click()
                await self.scraper.waits.wait_for_results_container(timeout_ms=20_000)
                await asyncio.sleep(random.uniform(0.8, 1.5))
                return True
            print("[LinkedIn] Decision Makers link not found")
            return False
        except Exception as exc:
            print(f"[LinkedIn] Error clicking Decision Makers: {exc}")
            return False

    async def navigate_to_account_search(self) -> bool:
        print("[LinkedIn] Navigating to Account search...")
        ok = await self.scraper.navigator.go_to_account_search()
        if ok:
            print("[LinkedIn] On Account search page")
        else:
            print("[LinkedIn] Error navigating to Account search")
        return ok

