"""Sales Navigator company collection flow using browser workflow recipes."""

from __future__ import annotations

import asyncio
import re
from difflib import get_close_matches
from typing import Any, Dict, List, Optional

import database as db
from services.web_automation.browser.workflows.recipes import search_and_extract
from services.web_automation.linkedin.salesnav.filter_parser import SalesNavFilterParser, infer_company_vertical
from ..core.pacing import pacing_delay


class SalesNavCompanyCollectionFlow:
    """Collect company results from SalesNav account search and optionally persist."""

    _search_gate_lock: asyncio.Lock = asyncio.Lock()
    _last_search_started_at: float = 0.0
    _min_search_interval_seconds: float = 8.0

    def __init__(self, scraper: Any = None):
        self.scraper = scraper
        self.filter_parser = SalesNavFilterParser()

    @classmethod
    async def _throttle_account_search(cls) -> None:
        """
        Bound back-to-back account searches across flow instances in this process.
        This is a stability/load-control guard for recipe-level searches.
        """
        loop = asyncio.get_running_loop()
        async with cls._search_gate_lock:
            elapsed = loop.time() - cls._last_search_started_at
            if elapsed < cls._min_search_interval_seconds:
                wait_floor = cls._min_search_interval_seconds - elapsed
                await pacing_delay(
                    base_seconds=wait_floor + 0.8,
                    variance_seconds=0.5,
                    min_seconds=wait_floor,
                    max_seconds=wait_floor + 2.0,
                )
            cls._last_search_started_at = loop.time()

    def _extract_company_focus(self, query: str) -> Optional[str]:
        text = (query or "").strip()
        if not text:
            return None

        # Prefer explicit quoted entity if present.
        quoted = re.search(r"[\"'“”](.+?)[\"'“”]", text)
        if quoted:
            candidate = str(quoted.group(1) or "").strip(" .,:;\"'`()[]{}")
            if candidate:
                return candidate

        text = re.sub(
            r"^\s*(please\s+)?(find|search(?:\s+for)?|show|look\s+up|lookup|collect|scrape|get)\s+",
            "",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(r"^\s*(company|account)\s+(named|called)\s+", "", text, flags=re.IGNORECASE)
        text = re.sub(r"^\s*(company|account)\s+", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s+(on|in|from|using)\s+(linkedin\s+)?sales\s*navigator.*$", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s+on\s+linkedin.*$", "", text, flags=re.IGNORECASE)
        text = text.strip(" .,:;\"'`()[]{}")
        if not text:
            return None

        lowered = text.lower()
        generic_markers = (
            "companies",
            "industry",
            "vertical",
            "near me",
            "healthcare",
            "manufacturing",
            "startups",
            "startup",
            "saas",
            "software companies",
        )
        if any(marker in lowered for marker in generic_markers):
            return None

        # Reject criteria-heavy strings that are unlikely to be a single company entity.
        if any(token in lowered for token in (" with ", " where ", " that ", " and ", " or ")):
            return None

        words = [w for w in re.split(r"\s+", text) if w]
        if not words:
            return None
        if len(words) > 5:
            return None
        return text

    def _resolve_known_company_name(self, candidate: Optional[str]) -> Optional[str]:
        if not candidate:
            return None
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT company_name
                FROM targets
                WHERE LOWER(company_name) = LOWER(?)
                LIMIT 1
                """,
                (candidate,),
            )
            exact = cursor.fetchone()
            if exact and exact[0]:
                return exact[0]

            cursor.execute("SELECT company_name FROM targets WHERE company_name IS NOT NULL")
            names = [row[0] for row in cursor.fetchall() if row and row[0]]

        if not names:
            return candidate
        match = get_close_matches(candidate, names, n=1, cutoff=0.82)
        return match[0] if match else candidate

    def _build_keyword_fallback_filters(self, query: str) -> Optional[Dict]:
        focus = self._extract_company_focus(query)
        if not focus:
            return None
        normalized_focus = self._resolve_known_company_name(focus)
        if not normalized_focus:
            return None
        return {
            "industry": [],
            "headquarters_location": [],
            "company_headcount": None,
            "annual_revenue": None,
            "company_headcount_growth": None,
            "number_of_followers": None,
            "keywords": [normalized_focus],
        }

    @staticmethod
    def _extract_hq_filter_value(filters: dict | None) -> dict[str, str]:
        if not isinstance(filters, dict):
            return {}
        hq = filters.get("headquarters_location")
        if isinstance(hq, str) and hq.strip():
            return {"headquarters_location": hq.strip()}
        if isinstance(hq, list) and hq:
            first = next((str(x).strip() for x in hq if str(x).strip()), "")
            if first:
                return {"headquarters_location": first}
        return {}

    @staticmethod
    def _normalize_companies(payload: dict | None, max_companies: int) -> list[dict]:
        raw_companies = payload.get("items", []) if isinstance(payload, dict) else []
        return [
            {
                "company_name": company.get("company_name") or company.get("name"),
                "name": company.get("company_name") or company.get("name"),
                "industry": company.get("industry") or company.get("subtitle") or company.get("title"),
                "linkedin_url": company.get("sales_nav_url") or company.get("linkedin_url"),
                "sales_nav_url": company.get("sales_nav_url") or company.get("linkedin_url"),
                "employee_count": company.get("employee_count") or company.get("company_size"),
                "location": company.get("location"),
                "about": company.get("about"),
                "strategic_priorities": company.get("strategic_priorities") or [],
                "ai_summary": company.get("ai_summary"),
                "has_ai_summary": bool(company.get("has_ai_summary")),
                "interaction_map": company.get("interaction_map") or {},
            }
            for company in raw_companies
            if (company.get("company_name") or company.get("name"))
        ][:max_companies]

    async def _run_account_search(self, query: str, filters: dict | None, max_companies: int) -> list[dict]:
        await self._throttle_account_search()
        search = await search_and_extract(
            task="salesnav_search_account",
            query=query,
            filter_values=filters or None,
            click_target=None,
            extract_type="company",
            tab_id=None,
            limit=max(1, min(max_companies, 100)),
            wait_ms=3500,
        )
        return self._normalize_companies(search, max_companies=max_companies)

    async def _collect_with_fallback(
        self, query: str, filters: dict, max_companies: int, result: dict
    ) -> list[dict]:
        companies: list[dict] = []
        primary_error: Exception | None = None
        try:
            companies = await self._run_account_search(query=query, filters=filters, max_companies=max_companies)
        except Exception as exc:
            primary_error = exc
            print(f"[Company Collector] Primary scrape failed: {exc}")

        fallback_filters = self._build_keyword_fallback_filters(query)
        should_retry = (primary_error is not None) or (not companies and fallback_filters is not None)
        if not (should_retry and fallback_filters):
            if primary_error is not None and not companies:
                raise primary_error
            return companies

        print(f"[Company Collector] Retrying with keyword fallback: {fallback_filters.get('keywords')}")
        await pacing_delay(base_seconds=2.0, variance_seconds=0.8, min_seconds=0.8, max_seconds=4.0)
        retry_query = " ".join(fallback_filters.get("keywords") or []) or query
        try:
            companies = await self._run_account_search(
                query=retry_query,
                filters=fallback_filters,
                max_companies=max_companies,
            )
            result["filters_applied_fallback"] = fallback_filters
            return companies
        except Exception:
            if primary_error is not None:
                raise primary_error
            raise

    async def collect_companies(
        self,
        query: str,
        max_companies: int = 100,
        headless: bool = False,
        save_to_db: bool = True,
        on_page_ready=None,
    ) -> Dict:
        _ = headless
        _ = on_page_ready
        result: dict = {
            "query": query,
            "companies": [],
            "filters_applied": {},
            "status": "pending",
            "error": None,
        }
        try:
            print(f"\n[Company Collector] Parsing query: {query}")
            filters = self.filter_parser.parse_query(query)
            result["filters_applied"] = filters
            print(f"[Company Collector] Parsed filters: {filters}")
            print(f"[Company Collector] Collecting up to {max_companies} companies...")

            companies = await self._collect_with_fallback(
                query=query,
                filters=filters if isinstance(filters, dict) else {},
                max_companies=max_companies,
                result=result,
            )

            result["companies"] = companies
            result["status"] = "success" if companies else "empty"
            print(f"[Company Collector] Collected {len(companies)} companies")

            if save_to_db and companies:
                saved_count = await asyncio.to_thread(self._save_companies_to_db, companies, query)
                result["saved_count"] = saved_count
                print(f"[Company Collector] Saved {saved_count} companies to database")
            return result
        except Exception as exc:
            print(f"[Company Collector] Error: {exc}")
            result["status"] = "error"
            result["error"] = str(exc)
            return result

    def _save_companies_to_db(self, companies: List[Dict], source_query: str) -> int:
        saved_count = 0
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(targets)")
            target_columns = {str(row[1]).lower() for row in cursor.fetchall()}
            has_vertical = "vertical" in target_columns
            has_notes = "notes" in target_columns
            has_source = "source" in target_columns
            has_status = "status" in target_columns

            for company in companies:
                try:
                    company_name = company.get("company_name")
                    if not company_name:
                        continue

                    domain = company.get("domain")
                    if not domain:
                        domain = re.sub(r"[\W_]+", "-", company_name.lower()).strip("-")

                    vertical = company.get("industry")
                    if not vertical or not str(vertical).strip():
                        vertical = infer_company_vertical(company_name=company_name, domain=domain)

                    cursor.execute("SELECT id FROM targets WHERE domain = ? OR company_name = ?", (domain, company_name))
                    existing = cursor.fetchone()

                    if existing:
                        set_parts = ["company_name = ?"]
                        params = [company_name]
                        if has_vertical:
                            set_parts.append("vertical = ?")
                            params.append(vertical)
                        if has_source:
                            set_parts.append("source = ?")
                            params.append("salesnav_automated")
                        if has_notes:
                            set_parts.append("notes = ?")
                            params.append(f"Collected via query: {source_query}")
                        params.append(existing[0])
                        cursor.execute(f"UPDATE targets SET {', '.join(set_parts)} WHERE id = ?", tuple(params))
                    else:
                        insert_columns = ["domain", "company_name"]
                        insert_values = [domain, company_name]
                        if has_vertical:
                            insert_columns.append("vertical")
                            insert_values.append(vertical)
                        if has_source:
                            insert_columns.append("source")
                            insert_values.append("salesnav_automated")
                        if has_notes:
                            insert_columns.append("notes")
                            insert_values.append(f"Collected via query: {source_query}")
                        if has_status:
                            insert_columns.append("status")
                            insert_values.append("pending")
                        placeholders = ", ".join(["?"] * len(insert_columns))
                        cursor.execute(
                            f"INSERT INTO targets ({', '.join(insert_columns)}) VALUES ({placeholders})",
                            tuple(insert_values),
                        )
                    saved_count += 1
                except Exception as exc:
                    print(f"[Company Collector] Error saving company {company.get('company_name')}: {exc}")
                    continue
        return saved_count


async def collect_companies_from_query(
    query: str,
    max_companies: int = 100,
    headless: bool = False,
    save_to_db: bool = True,
    on_page_ready=None,
) -> Dict:
    flow = SalesNavCompanyCollectionFlow()
    return await flow.collect_companies(
        query=query,
        max_companies=max_companies,
        headless=headless,
        save_to_db=save_to_db,
        on_page_ready=on_page_ready,
    )
