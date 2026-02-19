"""Filter-ID extraction helpers from SalesNav URL/state."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional


class SalesNavFilterUrlFilterIdFlow:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def get_filter_id_from_url(self, filter_type: str, filter_value: str) -> Optional[str]:
        try:
            if filter_type == "INDUSTRY":
                await self.scraper.apply_industry(filter_value)
            elif filter_type == "REGION":
                await self.scraper.apply_location(filter_value)
            else:
                return None
            await asyncio.sleep(2)
            current_url = self.page.url
            if "query=" not in current_url:
                return None
            pattern = rf"type:{filter_type}[^)]*id:(\d+),text:[^,)]*{re.escape(filter_value.split(',')[0].strip())}"
            match = re.search(pattern, current_url)
            if match:
                return match.group(1)
            pattern = rf"type:{filter_type}[^)]*id:(\d+)"
            matches = re.findall(pattern, current_url)
            if matches:
                return matches[-1]
            return None
        except Exception as exc:
            print(f"[LinkedIn] Error getting filter ID from URL for {filter_type}={filter_value}: {exc}")
            return None

    async def get_filter_id(self, filter_type: str, filter_value: str) -> Optional[str]:
        try:
            if filter_type.upper() in {"HEADQUARTERS_LOCATION", "REGION"}:
                return await self.scraper.filter_url_location_flow.get_location_id_from_dropdown(filter_value)
            if filter_type.upper() == "INDUSTRY":
                return await self.get_filter_id_from_url("INDUSTRY", filter_value)
            return await self.get_filter_id_from_url(filter_type.upper(), filter_value)
        except Exception as exc:
            print(f"[LinkedIn] Error getting filter ID for {filter_type}={filter_value}: {exc}")
            return None
