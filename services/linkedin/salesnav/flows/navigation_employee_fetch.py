"""Employee-fetch flow helpers."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ..core.filters import normalize_salesnav_lead_url
from ..core.pacing import pacing_delay


class SalesNavEmployeeFetchFlow:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def get_company_employees(self, company_url: str, max_employees: int = 20, title_filter: str = None):
        employees: list[dict] = []
        try:
            if company_url and company_url.startswith("SEARCH:"):
                company_name = company_url.replace("SEARCH:", "")
                search_query = f"{company_name}"
                if title_filter:
                    search_query += f" {title_filter}"
                people_url = f"https://www.linkedin.com/sales/search/people?query=(keywords%3A{quote(search_query)})"
                print(f"[LinkedIn] Searching people with keyword: {search_query}")
            elif company_url and "/sales/company/" in company_url:
                company_id = company_url.split("/sales/company/")[1].split("/")[0].split("?")[0]
                people_url = f"https://www.linkedin.com/sales/search/people?companyIncluded={company_id}"
                if title_filter:
                    people_url += f"&titleIncluded={quote(title_filter)}"
            else:
                print("[LinkedIn] Using current page for results")
                people_url = None

            if people_url:
                print("[LinkedIn] Navigating to people search...")
                await self.page.goto(people_url, timeout=30000)
            await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
            await pacing_delay(base_seconds=2.5, variance_seconds=0.8, min_seconds=1.0, max_seconds=5.0)

            print("[LinkedIn] Scrolling to load results...")
            for _ in range(3):
                await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await pacing_delay(base_seconds=1.2, variance_seconds=0.4, min_seconds=0.4, max_seconds=2.5)

            cards = None
            for selector in (
                '[data-view-name="search-results-lead-card"]',
                ".search-results__result-item",
                "li.artdeco-list__item",
                '[data-x-search-result="LEAD"]',
            ):
                probe = self.page.locator(selector)
                if await probe.count() > 0:
                    cards = probe
                    print(f"[LinkedIn] Found results with selector: {selector}")
                    break
            if not cards:
                print("[LinkedIn] No employee cards found")
                return employees

            count = await cards.count()
            print(f"[LinkedIn] Found {count} employee cards")
            for i in range(min(count, max_employees)):
                try:
                    card = cards.nth(i)
                    name = None
                    for name_selector in ('[data-anonymize="person-name"]', ".artdeco-entity-lockup__title", "a span"):
                        name_el = card.locator(name_selector).first
                        if await name_el.count() == 0:
                            continue
                        text = await name_el.text_content()
                        if text and len(text.strip()) > 1:
                            name = text.strip()
                            break

                    title = None
                    for title_selector in ('[data-anonymize="title"]', ".artdeco-entity-lockup__subtitle", ".t-14"):
                        title_el = card.locator(title_selector).first
                        if await title_el.count() == 0:
                            continue
                        text = await title_el.text_content()
                        if text:
                            title = text.strip()
                            break

                    sales_nav_url = None
                    public_url = None
                    link_el = card.locator('a[href*="/sales/lead/"], a[href*="/in/"]').first
                    if await link_el.count() > 0:
                        href = (await link_el.get_attribute("href") or "").strip()
                        if "/sales/" in href:
                            normalized = normalize_salesnav_lead_url(href)
                            sales_nav_url = normalized or href
                        elif "/in/" in href:
                            public_url = href

                    if name:
                        employees.append(
                            {
                                "name": name,
                                "title": title,
                                "sales_nav_url": sales_nav_url,
                                "public_url": public_url,
                                "has_public_url": bool(public_url),
                            }
                        )
                        print(f"  - {name}: {title or 'N/A'}")
                except Exception as exc:
                    print(f"[LinkedIn] Error extracting employee {i}: {exc}")
                    continue
        except Exception as exc:
            print(f"[LinkedIn] Error getting employees: {exc}")
        return employees
