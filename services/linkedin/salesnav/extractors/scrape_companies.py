"""Company scraping implementation for Sales Navigator."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

import config
from ..core.filters import normalize_salesnav_company_url, split_bullet_text
from ..core.pacing import pacing_delay
from ..core.parsing import employee_display_to_int, parse_employee_text


class SalesNavCompanyExtractor:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def scrape_company_results(self, max_companies: int = 100):
        companies: list[dict] = []
        try:
            await self.scraper.waits.wait_for_results_container(timeout_ms=20_000)
            await self.scraper.waits.wait_for_company_cards(min_count=1, timeout_ms=20_000)
            await pacing_delay(base_seconds=0.9, variance_seconds=0.25, min_seconds=0.3, max_seconds=1.8)

            print("[LinkedIn] Scrolling to load company results...")
            last_count = 0
            no_change_count = 0
            for scroll_attempt in range(20):
                await self.page.evaluate(
                    """
                    const container = document.querySelector('#search-results-container, [data-view-name="search-results-container"]');
                    if (container) {
                        container.scrollTop += 1000;
                    } else {
                        window.scrollTo(0, window.scrollY + 1000);
                    }
                    """
                )
                await pacing_delay(base_seconds=0.9, variance_seconds=0.25, min_seconds=0.3, max_seconds=1.8)
                current_count = await self.page.locator('[data-x-search-result="COMPANY"], a[href*="/sales/company/"]').count()
                if current_count != last_count:
                    print(f"[LinkedIn] Scroll {scroll_attempt + 1}: {current_count} companies loaded")
                    no_change_count = 0
                else:
                    no_change_count += 1
                if current_count >= max_companies:
                    print(f"[LinkedIn] Reached max {max_companies} companies")
                    break
                if no_change_count >= 5:
                    print(f"[LinkedIn] Reached bottom with {current_count} companies")
                    break
                last_count = current_count

            card_selectors = [
                '[data-x-search-result="COMPANY"]',
                'li[data-x-search-result="COMPANY"]',
                '[data-view-name="search-results-company-card"]',
                '.search-results__result-item',
            ]
            cards = None
            for selector in card_selectors:
                probe = self.page.locator(selector)
                if await probe.count() > 0:
                    cards = probe
                    print(f"[LinkedIn] Found results with selector: {selector}")
                    break
            if not cards:
                cards = self.page.locator(
                    'a[href*="/sales/company/"]:not([class*="_button_"]):not([class*="_footer-button_"]):not([class*="button--"])'
                )
                if await cards.count() == 0:
                    cards = self.page.locator('a[href*="/sales/company/"]')
                    print("[LinkedIn] Using all company links (will filter during extraction)")
                else:
                    print(f"[LinkedIn] Found {await cards.count()} company links (excluding buttons)")

            if not cards:
                await self.scraper.debugger.capture(
                    "scrape_company_results_no_cards",
                    context={"max_companies": max_companies},
                )
                return companies

            visible_count = await cards.count()
            total_to_extract = min(visible_count, max_companies)
            print(f"[LinkedIn] Extracting data from {total_to_extract} companies...")
            if self.scraper.debugger.should_capture_sample():
                await self.scraper.debugger.capture(
                    "scrape_company_results_sample",
                    context={"max_companies": max_companies, "visible_count": visible_count},
                )

            async def extract_company(i: int):
                try:
                    card = cards.nth(i)
                    classes = await card.get_attribute("class") or ""
                    if "_button_" in classes or "_footer-button_" in classes or "button--" in classes:
                        return None

                    company_url = None
                    href = await card.get_attribute("href")
                    if href:
                        if "aiqSection=" in href or "anchor=" in href or "strategic_priorities" in href:
                            return None
                        company_url = href
                    else:
                        link = card.locator('a[href*="/sales/company/"]').first
                        if await link.count() > 0:
                            href = await link.get_attribute("href")
                            if href and all(x not in href for x in ("aiqSection=", "anchor=", "strategic_priorities")):
                                company_url = href
                    if not company_url:
                        return None
                    if not company_url.startswith("http"):
                        company_url = f"https://www.linkedin.com{company_url}"

                    card_container = card
                    try:
                        parent = card.locator('xpath=ancestor::*[@data-x-search-result="COMPANY"][1]')
                        if await parent.count() > 0:
                            card_container = parent
                        else:
                            parent = card.locator(
                                'xpath=ancestor::li[contains(@class, "result") or contains(@class, "card")][1] | '
                                'ancestor::div[contains(@class, "result") or contains(@class, "card")][1]'
                            )
                            if await parent.count() > 0:
                                card_container = parent
                    except Exception:
                        pass

                    company_name = None
                    name_el = card_container.locator('[data-anonymize="company-name"]').first
                    if await name_el.count() > 0:
                        raw = await name_el.text_content()
                        company_name = raw.strip() if raw else None
                    if not company_name:
                        for selector in (
                            'span[data-anonymize="company-name"]',
                            '.artdeco-entity-lockup__title',
                            'h3',
                            'h2',
                            'span.t-16',
                            'span.t-14',
                        ):
                            probe = card_container.locator(selector).first
                            if await probe.count() == 0:
                                continue
                            raw = await probe.text_content()
                            if raw and len(raw.strip()) > 1 and "view all" not in raw.lower() and "strategic" not in raw.lower():
                                company_name = raw.strip()
                                break
                    if company_name:
                        company_name = " ".join(company_name.strip().split())
                        if "view all" in company_name.lower() or len(company_name) < 2:
                            company_name = None

                    industry = None
                    for selector in (
                        '[data-anonymize="industry"]',
                        'span[data-anonymize="industry"]',
                        '.artdeco-entity-lockup__subtitle',
                        '.t-14.t-black--light',
                    ):
                        el = card_container.locator(selector).first
                        if await el.count() == 0:
                            continue
                        txt = await el.text_content()
                        if not txt:
                            continue
                        parts = split_bullet_text(txt.strip())
                        candidate = parts[0] if parts else txt.strip()
                        if candidate and "view all" not in candidate.lower() and "employee" not in candidate.lower():
                            industry = candidate
                            break

                    employee_count = None
                    for selector in (
                        '.artdeco-entity-lockup__subtitle',
                        '.t-14.t-black--light',
                        '.t-14',
                        'span.t-14',
                        '.artdeco-entity-lockup__metadata',
                        '[data-anonymize="subtitle"]',
                    ):
                        el = card_container.locator(selector).first
                        if await el.count() == 0:
                            continue
                        txt = await el.text_content()
                        if txt and "employee" in txt.lower():
                            parsed = parse_employee_text(txt)
                            if parsed:
                                employee_count = parsed
                                break
                    if not employee_count:
                        card_text = await card_container.text_content()
                        if card_text and "employee" in card_text.lower():
                            parsed = parse_employee_text(card_text)
                            if parsed and 1 <= employee_display_to_int(parsed) < 10_000_000:
                                employee_count = parsed
                    if company_name and not employee_count:
                        try:
                            debug_card_path = Path(config.DATA_DIR) / "debug" / "employee_count_debug.html"
                            if not debug_card_path.exists():
                                debug_card_path.parent.mkdir(parents=True, exist_ok=True)
                                card_html = await card_container.evaluate("el => el.outerHTML")
                                debug_card_path.write_text(card_html, encoding="utf-8")
                        except Exception:
                            pass

                    if not company_name:
                        return None
                    if any(x in company_name.lower() for x in ("view all", "strategic priorities", "see more", "learn more", "follow", "message", "connect")):
                        return None
                    if len(company_name) < 2 or company_name.startswith("http") or "/" in company_name:
                        return None

                    company = {
                        "company_name": company_name,
                        "industry": industry,
                        "employee_count": employee_count,
                        "linkedin_url": company_url,
                        "details": None,
                    }
                    parts = [f"  [ok] {company_name}"]
                    if industry:
                        parts.append(f"Industry: {industry}")
                    if employee_count:
                        parts.append(f"Employees: {employee_count}")
                    print(" | ".join(parts))
                    return company
                except Exception as exc:
                    if "not found" not in str(exc).lower() and "timeout" not in str(exc).lower():
                        print(f"  [error] Company {i}: {exc}")
                    return None

            seen_urls: set[str] = set()
            for i in range(total_to_extract):
                row = await extract_company(i)
                if not row:
                    continue
                url = row.get("linkedin_url")
                if url:
                    normalized_url = normalize_salesnav_company_url(url)
                    if normalized_url in seen_urls:
                        continue
                    seen_urls.add(normalized_url)
                companies.append(row)
        except Exception as exc:
            print(f"[LinkedIn] Error scraping company results: {exc}")
            await self.scraper.debugger.capture(
                "scrape_company_results_error",
                context={"max_companies": max_companies, "error": str(exc)},
            )
        return companies

