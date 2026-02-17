"""Direct SalesNav search URL construction flow."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional
from urllib.parse import quote, unquote


class SalesNavFilterUrlBuildFlow:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    async def build_search_url(self, filters: dict) -> Optional[str]:
        try:
            session_id = None
            industry_filters = []
            location_filters = []

            if filters.get("industry"):
                industries = filters["industry"] if isinstance(filters["industry"], list) else [filters["industry"]]
                if industries:
                    print("[LinkedIn] Applying first industry filter to get sessionId...")
                    await self.scraper.apply_industry(industries[0])
                    await asyncio.sleep(2)
                    current_url = self.page.url
                    if "sessionId=" in current_url:
                        session_id = current_url.split("sessionId=")[1].split("&")[0]
                        print(f"[LinkedIn] Extracted sessionId: {session_id[:20]}...")
                    if "query=" in current_url:
                        query_part = current_url.split("query=")[1].split("&")[0]
                        query_decoded = unquote(query_part)
                        industry_pattern = r"type:INDUSTRY[^)]*?id:(\d+),text:([^,)]+),selectionType:(\w+)"
                        for industry_id, industry_text, selection_type in re.findall(industry_pattern, query_decoded):
                            industry_filters.append(
                                {
                                    "type": "INDUSTRY",
                                    "id": industry_id,
                                    "text": unquote(industry_text),
                                    "selectionType": selection_type,
                                }
                            )
                            print(f"[LinkedIn] Extracted industry: {unquote(industry_text)} (ID: {industry_id})")
                        for industry in industries[1:]:
                            industry_id = await self.scraper.filter_url_filter_id_flow.get_filter_id_from_url(
                                "INDUSTRY", industry
                            )
                            if industry_id:
                                industry_filters.append(
                                    {"type": "INDUSTRY", "id": industry_id, "text": industry, "selectionType": "INCLUDED"}
                                )

            if not session_id:
                print("[LinkedIn] Could not extract sessionId, falling back to UI filter application")
                return None

            if filters.get("headquarters_location"):
                locations = filters["headquarters_location"] if isinstance(filters["headquarters_location"], list) else [filters["headquarters_location"]]
                print("[LinkedIn] Extracting location IDs from dropdown (NOT applying filters)...")
                for location in locations:
                    location_id = await self.scraper.filter_url_location_flow.get_location_id_from_dropdown(location)
                    if location_id and len(location_id) >= 6:
                        location_filters.append(
                            {"type": "REGION", "id": location_id, "text": location, "selectionType": "INCLUDED"}
                        )
                        print(f"[LinkedIn] [ok] Extracted location ID: {location} (ID: {location_id})")
                        continue

                    print(f"[LinkedIn] Could not extract ID for location: {location}, applying filter to get ID from URL...")
                    await self.scraper.apply_location(location)
                    await asyncio.sleep(2)
                    current_url = self.page.url
                    if "query=" not in current_url:
                        continue
                    query_part = current_url.split("query=")[1].split("&")[0]
                    query_decoded = unquote(query_part)
                    region_pattern = r"type:REGION[^)]*?id:(\d+),text:([^,)]+)"
                    region_matches = re.findall(region_pattern, query_decoded)
                    location_id = None
                    location_normalized = location.strip().lower()
                    location_parts = [part.strip().lower() for part in location.split(",")]
                    primary_location = location_parts[0] if location_parts else location_normalized
                    best_match_score = 0
                    for match_id, match_text in region_matches:
                        decoded = unquote(match_text).strip().lower()
                        if decoded == location_normalized:
                            location_id = match_id
                            break
                        if primary_location in decoded and location_normalized in decoded and best_match_score < 2:
                            location_id = match_id
                            best_match_score = 2
                        elif primary_location in decoded and best_match_score < 1:
                            location_id = match_id
                            best_match_score = 1
                    if not location_id and region_matches:
                        location_id = region_matches[-1][0]
                    if location_id:
                        location_filters = [f for f in location_filters if f["text"] != location]
                        location_filters.append(
                            {"type": "REGION", "id": location_id, "text": location, "selectionType": "INCLUDED"}
                        )
                        print(f"[LinkedIn] [ok] Extracted location ID from URL: {location} (ID: {location_id})")
                    else:
                        print(f"[LinkedIn] [warn] Could not extract location ID from URL for: {location}")

            all_filters = industry_filters + location_filters
            if not all_filters:
                print("[LinkedIn] No valid filters extracted, falling back to UI")
                return None

            filters_by_type = {}
            for filter_item in all_filters:
                filters_by_type.setdefault(filter_item["type"], []).append(filter_item)
            filter_parts = []
            for filter_type, filter_items in filters_by_type.items():
                values = [
                    f"(id:{item['id']},text:{quote(item['text'])},selectionType:{item['selectionType']})"
                    for item in filter_items
                ]
                filter_parts.append(f"(type:{filter_type},values:List({','.join(values)}))")
            query_value = f"(filters:List({','.join(filter_parts)}))"
            url = f"https://www.linkedin.com/sales/search/company?query={quote(query_value)}&sessionId={quote(session_id)}"
            print(
                f"[LinkedIn] [ok] Built complete URL with {len(industry_filters)} industry and {len(location_filters)} location filters"
            )
            return url
        except Exception as exc:
            print(f"[LinkedIn] Error building search URL: {exc}")
            return None
