"""Batch public URL enrichment flow for Sales Navigator lead results."""

from __future__ import annotations

import asyncio
from typing import Any

from ..core.filters import normalize_salesnav_lead_url


class SalesNavPublicUrlBatch:
    def __init__(self, scraper: Any, flow: Any):
        self.scraper = scraper
        self.flow = flow

    @property
    def page(self):
        return self.scraper.page

    async def _load_cards(self, max_employees: int):
        import random

        await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
        await asyncio.sleep(random.uniform(2.0, 3.5))
        print("[LinkedIn] Loading results...")
        last_count = 0
        for _ in range(15):
            await self.page.evaluate(
                """
                const container = document.querySelector('#search-results-container');
                if (container) container.scrollTop += 800;
                """
            )
            await asyncio.sleep(random.uniform(1.2, 2.0))
            cards = self.page.locator('[data-x-search-result="LEAD"]')
            current_count = await cards.count()
            if current_count >= max_employees or current_count == last_count:
                break
            last_count = current_count

    async def _collect_basics(self, max_employees: int):
        employees: list[dict] = []
        cards = self.page.locator('[data-x-search-result="LEAD"]')
        count = await cards.count()
        print(f"[LinkedIn] Found {count} leads, collecting info...")
        for i in range(min(count, max_employees)):
            try:
                card = cards.nth(i)
                name = None
                title = None
                sales_nav_url = None

                name_el = card.locator('[data-anonymize="person-name"]').first
                if await name_el.count() > 0:
                    name = (await name_el.text_content() or "").strip()
                title_el = card.locator('[data-anonymize="title"]').first
                if await title_el.count() > 0:
                    title = (await title_el.text_content() or "").strip()
                link = card.locator('a[href*="/sales/lead/"]').first
                if await link.count() > 0:
                    href = await link.get_attribute("href")
                    normalized = normalize_salesnav_lead_url(href or "")
                    sales_nav_url = normalized or href
                if not name or len(name) < 2:
                    continue
                employees.append(
                    {
                        "name": name,
                        "title": title,
                        "sales_nav_url": sales_nav_url,
                        "public_url": None,
                        "has_public_url": False,
                        "card_index": i,
                    }
                )
                print(f"  - {name}: {title or 'N/A'}")
            except Exception as exc:
                print(f"  [error] Card {i}: {exc}")
                continue
        print(f"[LinkedIn] Collected {len(employees)} leads")
        return employees

    async def _enrich_public_urls(self, employees: list[dict]):
        import random

        if not employees:
            return
        print("[LinkedIn] Extracting public URLs...")
        await self.page.evaluate(
            """
            const container = document.querySelector('#search-results-container');
            if (container) container.scrollTop = 0;
            """
        )
        await asyncio.sleep(1)
        for emp in employees:
            try:
                public_url = None
                sales_nav_url = str(emp.get("sales_nav_url") or "").strip()
                if sales_nav_url:
                    public_url = await self.flow._copy_public_url_from_lead_page(sales_nav_url=sales_nav_url, name=emp["name"])
                if not public_url:
                    card_index = emp.get("card_index", 0)
                    cards = self.page.locator('[data-x-search-result="LEAD"]')
                    if await cards.count() > card_index:
                        card = cards.nth(card_index)
                        await card.scroll_into_view_if_needed()
                        await asyncio.sleep(random.uniform(0.5, 1.0))
                        public_url = await self.flow.extract_public_linkedin_url(card, emp["name"])
                if public_url:
                    emp["public_url"] = public_url
                    emp["has_public_url"] = True
                    emp["linkedin_url"] = public_url
                    emp["source_url"] = public_url
                    print(f"  [ok] {emp['name']}: {public_url}")
                await asyncio.sleep(random.uniform(1, 2))
            except Exception as exc:
                print(f"  [error] URL extraction for {emp.get('name', '?')}: {exc}")
                continue
        for emp in employees:
            emp.pop("card_index", None)

    async def run(self, max_employees: int = 50, extract_public_urls: bool = True):
        employees: list[dict] = []
        try:
            await self._load_cards(max_employees)
            employees = await self._collect_basics(max_employees)
            if extract_public_urls and employees:
                await self._enrich_public_urls(employees)
        except Exception as exc:
            print(f"[LinkedIn] Error scraping with public URLs: {exc}")
        return employees
