"""People scraping implementation for Sales Navigator."""

from __future__ import annotations

import random
from typing import Any

from ..core.filters import normalize_salesnav_lead_url
from ..core.interaction import idle_drift, scroll_into_view
from ..core.pacing import pacing_delay
from ..core.selectors import SEL


class SalesNavPeopleExtractor:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def scrape_current_results(self, max_employees: int = 50):
        employees: list[dict] = []
        try:
            await self.scraper.waits.wait_for_results_container(timeout_ms=20_000)
            await self.scraper.waits.wait_for_lead_cards(min_count=1, timeout_ms=20_000)

            print("[LinkedIn] Scrolling results container to load all...")
            cards = self.page.locator(SEL.LEAD_CARD)
            last_count = 0
            no_change_count = 0
            for _ in range(25):
                await self.page.evaluate(
                    """
                    const container = document.querySelector('#search-results-container');
                    if (container) {
                        container.scrollTop += 1000;
                    }
                    """
                )
                await pacing_delay(base_seconds=0.9, variance_seconds=0.25, min_seconds=0.3, max_seconds=1.8)
                current_count = await cards.count()
                if current_count != last_count:
                    no_change_count = 0
                else:
                    no_change_count += 1
                if current_count >= max_employees:
                    break
                if no_change_count >= 5:
                    break
                last_count = current_count

            await self.page.evaluate(
                """
                const container = document.querySelector('#search-results-container');
                if (container) container.scrollTop = container.scrollHeight;
                """
            )
            await pacing_delay(base_seconds=0.8, variance_seconds=0.2, min_seconds=0.3, max_seconds=1.6)
            if self.scraper.debugger.should_capture_sample():
                await self.scraper.debugger.capture(
                    "scrape_current_results_sample",
                    context={"max_employees": max_employees},
                )

            count = await cards.count()
            print(f"[LinkedIn] Found {count} lead cards")
            if count == 0:
                if self.scraper.debugger.should_capture_sample():
                    await self.scraper.debugger.capture(
                        "scrape_current_results_empty",
                        context={"max_employees": max_employees},
                    )
                return employees

            print(f"[LinkedIn] Extracting data from {min(count, max_employees)} cards...")
            seen_keys: set[str] = set()
            for i in range(min(count, max_employees)):
                try:
                    card = cards.nth(i)
                    if self.page:
                        await scroll_into_view(self.page, card)
                    name = None
                    title = None
                    sales_nav_url = None

                    name_el = card.locator('[data-anonymize="person-name"]').first
                    if await name_el.count() > 0:
                        raw = await name_el.inner_text()
                        name = raw.strip() if raw else None

                    title_el = card.locator('[data-anonymize="title"]').first
                    if await title_el.count() > 0:
                        raw = await title_el.inner_text()
                        title = raw.strip() if raw else None

                    link = card.locator('a[href*="/sales/lead/"]').first
                    if await link.count() > 0:
                        href = await link.get_attribute("href")
                        normalized = normalize_salesnav_lead_url(href or "")
                        sales_nav_url = normalized or href

                    if not name or len(name) <= 2:
                        continue
                    dedupe_key = sales_nav_url or f"{name.lower().strip()}|{(title or '').lower().strip()}"
                    if dedupe_key in seen_keys:
                        continue
                    seen_keys.add(dedupe_key)
                    employees.append(
                        {
                            "name": name,
                            "title": title,
                            "sales_nav_url": sales_nav_url,
                            "public_url": None,
                            "has_public_url": False,
                        }
                    )
                    if self.page and len(employees) % 5 == 0:
                        await idle_drift(self.page, duration_seconds=random.uniform(0.8, 2.0))
                    print(f"  - {name}: {title or 'N/A'}")
                except Exception as exc:
                    print(f"  [error] Card {i}: {exc}")
                    continue
        except Exception as exc:
            print(f"[LinkedIn] Error scraping results: {exc}")
            await self.scraper.debugger.capture(
                "scrape_current_results_error",
                context={"error": str(exc), "max_employees": max_employees},
            )
        return employees

    async def scrape_current_results_with_public_urls(self, max_employees: int = 50):
        return await self.scraper.scrape_current_results_with_public_urls(max_employees=max_employees)

