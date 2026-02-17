"""Higher-level workflow helpers for navigation + extraction."""

from __future__ import annotations

from typing import Any

from ..core.filters import normalize_salesnav_lead_url


class SalesNavWorkflowFlow:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    async def scrape_company_contacts(
        self,
        company_name: str,
        domain: str,
        max_contacts: int = 10,
        extract_public_urls: bool = False,
    ) -> dict:
        result = {"company_name": company_name, "domain": domain, "employees": [], "status": "pending"}
        company_url = await self.scraper.search_company(company_name)
        if not company_url:
            result["status"] = "company_not_found"
            return result

        if await self.scraper.click_decision_makers():
            if extract_public_urls:
                employees = await self.scraper.scrape_current_results_with_public_urls(
                    max_employees=max_contacts * 2,
                    extract_public_urls=True,
                )
            else:
                employees = await self.scraper.scrape_current_results(max_employees=max_contacts * 2)
            result["employees"] = employees
        else:
            print("[LinkedIn] Trying direct people search...")
            result["employees"] = await self.scraper.get_company_employees(
                company_url,
                max_employees=max_contacts,
                title_filter=None,
            )

        seen = set()
        unique_employees = []
        for emp in result["employees"]:
            normalized_lead = normalize_salesnav_lead_url(
                str(emp.get("sales_nav_url") or emp.get("linkedin_url") or "")
            )
            name_key = str(emp.get("name") or "").lower().strip()
            title_key = str(emp.get("title") or "").lower().strip()
            dedupe_key = normalized_lead or f"{name_key}|{title_key}|{company_name.lower().strip()}"
            if dedupe_key not in seen and len(name_key) > 2:
                seen.add(dedupe_key)
                unique_employees.append(emp)

        result["employees"] = unique_employees[:max_contacts]
        for emp in result["employees"]:
            # Raw employee contract: always expose explicit URL fields.
            emp.setdefault("sales_nav_url", None)
            emp.setdefault("public_url", None)
            emp.setdefault("has_public_url", bool(emp.get("public_url")))
        result["status"] = "success" if result["employees"] else "no_employees_found"
        return result

    async def search_companies_with_filters(self, filters: dict, max_companies: int = 100):
        if not await self.scraper.navigate_to_account_search():
            return []
        await self.scraper.apply_filters(filters)
        return await self.scraper.scrape_company_results(max_companies=max_companies)

