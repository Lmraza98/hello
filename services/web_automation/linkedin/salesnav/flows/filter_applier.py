"""Filter application implementation for Sales Navigator."""

from __future__ import annotations

import asyncio
import random
import re
from difflib import SequenceMatcher
from typing import Any, Optional

from ..core.interaction import click_locator, idle_drift
from ..core.operations import run_operation_with_retries
from ..core.parsing import expand_headcount_range_to_salesnav_options


class SalesNavFilterApplier:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def apply_filters(self, filters: dict):
        print(f"[LinkedIn] Applying filters: {filters}")
        try:
            await self.scraper.waits.wait_for_results_container(timeout_ms=20_000)
            await asyncio.sleep(random.uniform(0.8, 1.5))
            if self.scraper.debugger.should_capture_sample():
                await self.scraper.debugger.capture("apply_filters_sample", context={"filters": filters})

            async def _apply_with_retry(filter_func, *args, max_retries=3):
                await run_operation_with_retries(
                    op_name=f"apply_filter_{getattr(filter_func, '__name__', 'unknown')}",
                    fn=lambda: filter_func(*args),
                    retries=max_retries - 1,
                    retry_wait_seconds=1.0,
                    debug=self.scraper.debugger,
                    debug_context={"args": [str(a) for a in args]},
                )
                if self.page:
                    await idle_drift(self.page, duration_seconds=random.uniform(0.5, 1.5))
                await asyncio.sleep(random.uniform(1.0, 1.8))

            if filters.get("industry"):
                industries = filters["industry"] if isinstance(filters["industry"], list) else [filters["industry"]]
                for industry in industries:
                    await _apply_with_retry(self.apply_industry, industry)
            if filters.get("headquarters_location"):
                locations = filters["headquarters_location"] if isinstance(filters["headquarters_location"], list) else [filters["headquarters_location"]]
                for location in locations:
                    await _apply_with_retry(self.apply_location, location)
            if filters.get("company_headcount"):
                await _apply_with_retry(self.apply_headcount, filters["company_headcount"])
            if filters.get("annual_revenue"):
                await _apply_with_retry(self.apply_revenue, filters["annual_revenue"])

            await asyncio.sleep(random.uniform(2, 3))
            for attempt in range(3):
                try:
                    await self.page.wait_for_selector('[data-x-search-result="COMPANY"], a[href*="/sales/company/"]', timeout=15000)
                    print("[LinkedIn] Results detected on page")
                    break
                except Exception:
                    print(f"[LinkedIn] Results not detected (attempt {attempt+1}/3), retrying...")
                    await asyncio.sleep(random.uniform(3, 5))
            print("[LinkedIn] Filters applied via UI")
        except Exception as exc:
            print(f"[LinkedIn] Error applying filters: {exc}")
            await self.scraper.debugger.capture("apply_filters_error", context={"filters": filters, "error": str(exc)})
            raise

    def _normalize_industry_text(self, text: str) -> str:
        normalized = text.strip().lower()
        normalized = normalized.replace(" & ", " and ").replace("&", " and ").replace(" + ", " and ")
        normalized = normalized.replace("/", " ")
        return " ".join(normalized.split())

    def _score_industry_match(self, option_text: str, target: str) -> int:
        option_clean = self._normalize_industry_text(option_text)
        target_clean = self._normalize_industry_text(target)
        if option_clean == target_clean:
            return 100
        if target_clean in option_clean or option_clean in target_clean:
            len_diff = abs(len(option_clean) - len(target_clean))
            return max(85, 95 - len_diff)
        return int(SequenceMatcher(None, option_clean, target_clean).ratio() * 100)

    async def apply_industry(self, industry: str):
        print(f"[LinkedIn] Applying industry filter: {industry}")
        industry_fieldset = self.page.locator('fieldset[data-x-search-filter="INDUSTRY"]')
        if await industry_fieldset.count() == 0:
            print("[LinkedIn] Industry filter fieldset not found")
            return
        expand_button = industry_fieldset.locator("button.search-filter__focus-target--button")
        if await expand_button.count() == 0:
            print("[LinkedIn] Industry filter expand button not found")
            return
        if await expand_button.get_attribute("aria-expanded") != "true":
            await click_locator(self.page, expand_button)
            await asyncio.sleep(2)
        search_input = industry_fieldset.locator('input[placeholder*="Add industries" i]').or_(
            industry_fieldset.locator('input[placeholder*="Industry" i]')
        ).or_(industry_fieldset.locator("input.artdeco-typeahead__input")).first
        if await search_input.count() == 0:
            print("[LinkedIn] Industry search input not found")
            return
        await search_input.click()
        await asyncio.sleep(0.5)
        await search_input.fill("")
        await asyncio.sleep(0.5)

        best_match = None
        best_score = 0
        chars_typed = 0
        for char in industry:
            await search_input.type(char, delay=80)
            chars_typed += 1
            if chars_typed >= 3 and (chars_typed == 3 or chars_typed % 2 == 0):
                await asyncio.sleep(0.3)
                listbox = self.page.locator('[role="listbox"]')
                if await listbox.count() == 0 or not await listbox.is_visible():
                    continue
                options = self.page.locator('li[role="option"]')
                for i in range(await options.count()):
                    option = options.nth(i)
                    txt_span = option.locator("span.t-14").first
                    if await txt_span.count() == 0:
                        continue
                    option_text = await txt_span.text_content()
                    if not option_text:
                        continue
                    score = self._score_industry_match(option_text, industry)
                    if score > best_score:
                        best_score = score
                        best_match = option
                        print(f"[LinkedIn] Option: '{option_text.strip()}' -> score {score} (after {chars_typed} chars)")
                    if best_score >= 85:
                        break
                if best_score >= 85:
                    break

        if best_match is None or best_score < 85:
            await asyncio.sleep(0.5)
            options = self.page.locator('li[role="option"]')
            for i in range(await options.count()):
                option = options.nth(i)
                txt_span = option.locator("span.t-14").first
                if await txt_span.count() == 0:
                    continue
                option_text = await txt_span.text_content()
                if not option_text:
                    continue
                score = self._score_industry_match(option_text, industry)
                if score > best_score:
                    best_score = score
                    best_match = option
                    print(f"[LinkedIn] Option: '{option_text.strip()}' -> score {score}")
        if best_match is None or best_score == 0:
            print(f"[LinkedIn] No matching industry found for '{industry}', skipping")
            return
        include_button = best_match.locator('[role="button"][aria-label*="Include"]').or_(
            best_match.locator("div._include-button_1cz98z")
        ).or_(best_match.locator('[data-x-search-filter-typeahead-suggestion^="include-"]')).first
        if await include_button.count() > 0:
            await click_locator(self.page, include_button)
        else:
            await click_locator(self.page, best_match)
        await asyncio.sleep(1.5)
        # Collapse filter panel
        try:
            if self.scraper and self.scraper.page:
                from playwright.async_api import Page
                page: Page = self.scraper.page
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.3)
        except Exception:
            pass
        print(f"[LinkedIn] Applied industry filter: {industry}")

    async def _wait_for_dropdown_to_settle(self, timeout_seconds: float = 8.0, poll_interval: float = 0.8) -> int:
        options = self.page.locator('li[role="option"]')
        last_count = 0
        stable_ticks = 0
        elapsed = 0.0
        while elapsed < timeout_seconds:
            current_count = await options.count()
            if current_count > 0 and current_count == last_count:
                stable_ticks += 1
                if stable_ticks >= 2:
                    return current_count
            else:
                stable_ticks = 0
            last_count = current_count
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        return last_count

    def _score_location_match(self, option_text: str, target: str) -> int:
        opt = option_text.strip().lower()
        tgt = target.strip().lower()
        if opt == tgt:
            return 100
        tgt_parts = [p.strip() for p in tgt.split(",")]
        opt_parts = [p.strip() for p in opt.split(",")]
        primary_tgt = tgt_parts[0]
        if primary_tgt not in opt:
            return 0
        if len(opt_parts) < len(tgt_parts):
            return 0
        if tgt in opt:
            return 80
        if primary_tgt == opt_parts[0]:
            return 60
        return 20

    async def apply_location(self, location: str):
        print(f"[LinkedIn] Applying location filter: {location}")
        fieldset = self.page.locator('fieldset[data-x-search-filter="HEADQUARTERS_LOCATION"]')
        if await fieldset.count() == 0:
            print("[LinkedIn] Headquarters Location filter fieldset not found")
            return
        expand = fieldset.locator("button.search-filter__focus-target--button")
        if await expand.count() == 0:
            print("[LinkedIn] Location filter expand button not found")
            return
        if await expand.get_attribute("aria-expanded") != "true":
            await click_locator(self.page, expand)
            await asyncio.sleep(2)
        search_input = fieldset.locator('input[placeholder*="Add locations" i]').or_(
            fieldset.locator('input[placeholder*="Location" i]')
        ).or_(fieldset.locator("input.artdeco-typeahead__input")).first
        if await search_input.count() == 0:
            print("[LinkedIn] Location search input not found")
            return
        await search_input.click()
        await asyncio.sleep(0.5)
        await search_input.fill("")
        await asyncio.sleep(0.5)
        primary_part = [p.strip() for p in location.split(",")][0]
        for char in primary_part:
            await search_input.type(char, delay=80)
        try:
            await self.page.wait_for_selector('[role="listbox"]', state="visible", timeout=5000)
        except Exception:
            pass
        await self._wait_for_dropdown_to_settle(timeout_seconds=8.0)

        result_options = self.page.locator('li[role="option"]')
        best_match = None
        best_score = 0
        for i in range(await result_options.count()):
            option = result_options.nth(i)
            txt_span = option.locator("span.t-14").first
            if await txt_span.count() == 0:
                continue
            option_text = await txt_span.text_content()
            if not option_text:
                continue
            score = self._score_location_match(option_text, location)
            if score > best_score:
                best_score = score
                best_match = option
                print(f"[LinkedIn] Option: '{option_text.strip()}' -> score {score}")
                if score >= 100:
                    break
        if best_match is None or best_score == 0:
            print(f"[LinkedIn] No matching location found for '{location}', skipping")
            return
        include_button = best_match.locator("button._include-button_1cz98z").or_(
            best_match.locator('button[aria-label*="Include" i]')
        ).or_(best_match.locator("div._include-button_1cz98z")).first
        if await include_button.count() > 0:
            await click_locator(self.page, include_button)
        else:
            await click_locator(self.page, best_match)
        await asyncio.sleep(1.5)
        # Collapse filter panel
        try:
            if self.scraper and self.scraper.page:
                from playwright.async_api import Page
                page: Page = self.scraper.page
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.3)
        except Exception:
            pass
        print(f"[LinkedIn] Applied location filter: {location}")

    async def apply_headcount(self, headcount_range: str):
        print(f"[LinkedIn] Applying headcount filter: {headcount_range}")
        fieldset = self.page.locator('fieldset[data-x-search-filter="COMPANY_HEADCOUNT"]')
        if await fieldset.count() == 0:
            print("[LinkedIn] Company Headcount filter fieldset not found")
            return
        expand = fieldset.locator("button.search-filter__focus-target--button")
        if await expand.count() == 0:
            print("[LinkedIn] Headcount filter expand button not found")
            return
        if await expand.get_attribute("aria-expanded") != "true":
            await click_locator(self.page, expand)
            await asyncio.sleep(2)
        target_ranges = expand_headcount_range_to_salesnav_options(headcount_range)
        if not target_ranges:
            print(f"[LinkedIn] No valid headcount targets resolved for '{headcount_range}'")
            return
        applied: list[str] = []
        for target in target_ranges:
            option = fieldset.locator(f'li[role="option"]:has-text("{target}")').or_(
                fieldset.locator(f'div.button--fill-click-area:has-text("{target}")')
            ).or_(fieldset.locator(f'[aria-label*="{target}"]')).first
            if await option.count() == 0:
                print(f"[LinkedIn] Headcount option '{target}' not found")
                continue
            clickable = option.locator("div.button--fill-click-area").first
            if await clickable.count() > 0:
                await click_locator(self.page, clickable)
            else:
                await click_locator(self.page, option)
            await asyncio.sleep(1.0)
            applied.append(target)
        if applied:
            # Collapse filter panel
            try:
                if self.scraper and self.scraper.page:
                    from playwright.async_api import Page
                    page: Page = self.scraper.page
                    await page.keyboard.press("Escape")
                    await asyncio.sleep(0.3)
            except Exception:
                pass
            print(f"[LinkedIn] Applied headcount filter(s): {', '.join(applied)}")

    async def apply_revenue(self, revenue_range: str):
        print(f"[LinkedIn] Applying revenue filter: {revenue_range}")
        fieldset = self.page.locator('fieldset[data-x-search-filter="ANNUAL_REVENUE"]')
        if await fieldset.count() == 0:
            print("[LinkedIn] Annual Revenue filter fieldset not found")
            return
        expand = fieldset.locator("button.search-filter__focus-target--button")
        if await expand.count() == 0:
            print("[LinkedIn] Revenue filter expand button not found")
            return
        if await expand.get_attribute("aria-expanded") != "true":
            await click_locator(self.page, expand)
            await asyncio.sleep(2)
        option = fieldset.locator(f'button:has-text("{revenue_range}")').or_(
            fieldset.locator(f'label:has-text("{revenue_range}")')
        ).or_(fieldset.locator(f'[aria-label*="{revenue_range}"]')).first
        if await option.count() == 0:
            print(f"[LinkedIn] Revenue range option '{revenue_range}' not found")
            return
        await click_locator(self.page, option)
        await asyncio.sleep(1.0)
        # Collapse filter panel
        try:
            if self.scraper and self.scraper.page:
                from playwright.async_api import Page
                page: Page = self.scraper.page
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.3)
        except Exception:
            pass
        print(f"[LinkedIn] Applied revenue filter: {revenue_range}")

