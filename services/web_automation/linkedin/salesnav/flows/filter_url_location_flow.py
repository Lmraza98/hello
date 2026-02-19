"""Location-ID extraction from SalesNav dropdown flow."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional


class SalesNavFilterUrlLocationFlow:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def get_location_id_from_dropdown(self, location: str) -> Optional[str]:
        try:
            location_fieldset = self.page.locator('fieldset[data-x-search-filter="HEADQUARTERS_LOCATION"]')
            if await location_fieldset.count() == 0:
                return None
            expand_button = location_fieldset.locator("button.search-filter__focus-target--button").first
            if await expand_button.count() > 0 and await expand_button.get_attribute("aria-expanded") != "true":
                await expand_button.click()
                await asyncio.sleep(1)
            search_input = location_fieldset.locator('input[placeholder*="Add locations" i]').first
            if await search_input.count() == 0:
                return None
            await search_input.click()
            await asyncio.sleep(0.2)
            await search_input.fill("")
            await asyncio.sleep(0.2)
            primary_part = [p.strip() for p in location.split(",")][0]
            for char in primary_part:
                await search_input.type(char, delay=80)
            try:
                await self.page.wait_for_selector('[role="listbox"]', state="visible", timeout=5000)
            except Exception:
                pass
            await self.scraper.filter_applier._wait_for_dropdown_to_settle(timeout_seconds=8.0)
            options = self.page.locator('li[role="option"]')
            option_count = await options.count()
            if option_count == 0:
                return None

            best_match = None
            best_score = 0
            for i in range(option_count):
                try:
                    option = options.nth(i)
                    span = option.locator("span.t-14").first
                    if await span.count() == 0:
                        continue
                    option_text = await span.text_content()
                    if not option_text:
                        continue
                    score = self.scraper.filter_applier._score_location_match(option_text, location)
                    if score > best_score:
                        best_score = score
                        best_match = option
                        if score >= 100:
                            break
                except Exception:
                    continue
            if best_match is None or best_score == 0:
                await search_input.fill("")
                await asyncio.sleep(0.5)
                return None

            option_html = await best_match.evaluate("el => el.outerHTML")
            match = re.search(r'data-x-search-filter-typeahead-suggestion="[^"]*?(\d+)"', option_html)
            if match:
                location_id = match.group(1)
                await search_input.fill("")
                await asyncio.sleep(0.5)
                return location_id
            include_button = best_match.locator("button[data-x-search-filter-typeahead-suggestion]").first
            if await include_button.count() > 0:
                button_attr = await include_button.get_attribute("data-x-search-filter-typeahead-suggestion")
                if button_attr:
                    match = re.search(r"(\d+)", button_attr)
                    if match:
                        location_id = match.group(1)
                        await search_input.fill("")
                        await asyncio.sleep(0.5)
                        return location_id
            match = re.search(r'data-[^=]*="?(\d{6,})"?', option_html)
            if match:
                location_id = match.group(1)
                await search_input.fill("")
                await asyncio.sleep(0.5)
                return location_id
            await search_input.fill("")
            await asyncio.sleep(0.5)
            return None
        except Exception as exc:
            print(f"[LinkedIn] Error getting location ID from dropdown for {location}: {exc}")
            return None

