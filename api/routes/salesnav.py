"""
Sales Navigator search endpoints used by chat workflows.
"""
from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from api.routes.browser_stream import broadcast_event, set_active_browser_page
from services.linkedin.scraper import SalesNavigatorScraper
from urllib.parse import quote

router = APIRouter(prefix="/api/salesnav", tags=["salesnav"])


class SalesNavSearchRequest(BaseModel):
    first_name: str
    last_name: str
    company: Optional[str] = None
    max_results: int = 5


class CompanySearchRequest(BaseModel):
    query: str
    max_companies: int = 50
    save_to_db: bool = True


class CompanyRef(BaseModel):
    name: str
    domain: Optional[str] = None
    linkedin_url: Optional[str] = None


class ScrapeLeadsRequest(BaseModel):
    companies: List[CompanyRef]
    title_filter: Optional[str] = None
    max_per_company: int = 10


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()

def _abs_linkedin_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    u = url.strip()
    if not u:
        return None
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if u.startswith("/"):
        return f"https://www.linkedin.com{u}"
    if u.startswith("www.linkedin.com/") or u.startswith("linkedin.com/"):
        return f"https://{u}"
    return u


def _people_search_url(keyword: str) -> str:
    return f"https://www.linkedin.com/sales/search/people?query=(keywords%3A{quote(keyword)})"


@router.post("/search")
async def salesnav_person_search(request: SalesNavSearchRequest):
    """
    Search people in Sales Navigator and return lightweight profile cards.
    """
    full_name = f"{request.first_name} {request.last_name}".strip()
    keyword = " ".join(part for part in [full_name, request.company or ""] if part).strip()
    max_results = max(1, min(request.max_results, 20))

    scraper = SalesNavigatorScraper()
    try:
        await broadcast_event(
            "browser_automation_start",
            {"action": "salesnav_search", "query": keyword},
        )
        # Non-headless is much more reliable for the "Copy LinkedIn.com URL" flow
        # (clipboard + context menu behaviors can be flaky in headless).
        await scraper.start(headless=False)
        if not scraper.is_authenticated:
            return {
                "success": False,
                "profiles": [],
                "error": "LinkedIn Sales Navigator is not authenticated.",
            }

        set_active_browser_page(scraper.page)

        print(f"[SalesNav] People search keyword: {keyword}")

        # Navigate directly to People search so we can use the existing
        # "ellipsis -> Copy LinkedIn.com URL" extraction logic.
        await scraper.page.goto(_people_search_url(keyword), timeout=30000)

        # This method does a two-pass scrape:
        # - pass 1 collects basic info and the Sales Nav lead URL
        # - pass 2 clicks the ellipsis and copies the public linkedin.com/in URL
        employees = await scraper.scrape_current_results_with_public_urls(
            max_employees=max_results * 3,
            extract_public_urls=True,
        )

        q_name = _norm(full_name)
        q_first = _norm(request.first_name)
        q_last = _norm(request.last_name)
        q_company = _norm(request.company or "")

        ranked = []
        for employee in employees or []:
            name = employee.get("name") or ""
            title = employee.get("title") or ""
            linkedin_url = _abs_linkedin_url(employee.get("linkedin_url"))
            if not name:
                continue

            name_n = _norm(name)
            title_n = _norm(title)
            score = 0

            if q_name and q_name in name_n:
                score += 5
            if q_first and q_first in name_n:
                score += 2
            if q_last and q_last in name_n:
                score += 3
            if q_company and q_company in title_n:
                score += 1

            ranked.append(
                (
                    score,
                    {
                        "name": name,
                        "title": title,
                        "company": request.company,
                        "linkedin_url": linkedin_url,
                        "location": None,
                        "source": "Sales Navigator",
                    },
                )
            )

        ranked.sort(key=lambda item: item[0], reverse=True)
        profiles = [item[1] for item in ranked[:max_results]]

        # scrape_current_results_with_public_urls() already upgrades to public /in/ URLs when possible.

        return {
            "success": True,
            "searched_query": keyword,
            "profiles": profiles,
        }
    except Exception as exc:
        return {
            "success": False,
            "profiles": [],
            "error": str(exc),
        }
    finally:
        await broadcast_event("browser_automation_stop", {"action": "salesnav_search"})
        set_active_browser_page(None)
        await scraper.stop()


# ────────────────────────────────────────────────────────────────────
# Company search + lead scraping endpoints (used by lead_generation workflow)
# ────────────────────────────────────────────────────────────────────

@router.post("/search-companies")
async def search_companies(request: CompanySearchRequest):
    """
    Search for companies on Sales Navigator using a natural language query.
    Uses GPT-4 to parse the query into SalesNav filters, then scrapes results.
    Companies are optionally saved to the database.
    """
    from services.company_collector import CompanyCollector

    collector = CompanyCollector()
    try:
        await broadcast_event(
            "browser_automation_start",
            {"action": "company_search", "query": request.query},
        )

        result = await collector.collect_companies(
            query=request.query,
            max_companies=request.max_companies,
            headless=False,
            save_to_db=request.save_to_db,
            on_page_ready=lambda page: set_active_browser_page(page),
        )

        return result

    except Exception as exc:
        return {
            "status": "error",
            "error": str(exc),
            "companies": [],
            "filters_applied": {},
            "query": request.query,
        }
    finally:
        # Clean up browser page reference for the viewer stream
        set_active_browser_page(None)
        await broadcast_event("browser_automation_stop", {"action": "company_search"})


@router.post("/scrape-leads")
async def scrape_leads(request: ScrapeLeadsRequest):
    """
    Scrape leads (decision-makers) from a list of companies.
    For each company, navigates to the company on Sales Navigator,
    clicks 'Decision Makers', and scrapes the results.
    Contacts are saved to the database.
    """
    from services.linkedin.contacts import save_linkedin_contacts

    scraper = SalesNavigatorScraper()
    all_leads = []
    errors = []

    try:
        await broadcast_event(
            "browser_automation_start",
            {"action": "scrape_leads", "count": len(request.companies)},
        )

        await scraper.start(headless=False)

        if not scraper.is_authenticated:
            return {
                "success": False,
                "leads": [],
                "saved_count": 0,
                "error": "LinkedIn Sales Navigator is not authenticated.",
            }

        set_active_browser_page(scraper.page)

        for idx, company in enumerate(request.companies):
            try:
                print(f"[SalesNav] Scraping leads from {company.name} ({idx + 1}/{len(request.companies)})")

                await broadcast_event(
                    "browser_automation_start",
                    {
                        "action": f"Scraping {company.name} ({idx + 1}/{len(request.companies)})",
                    },
                )

                result = await scraper.scrape_company_contacts(
                    company_name=company.name,
                    domain=company.domain or "",
                    max_contacts=request.max_per_company,
                    extract_public_urls=False,  # Faster; public URLs not needed for DB save
                )

                employees = result.get("employees", [])

                # Apply title filter if provided
                if request.title_filter and employees:
                    title_keywords = [
                        t.strip().lower()
                        for t in request.title_filter.split(",")
                        if t.strip()
                    ]
                    if title_keywords:
                        filtered = []
                        for emp in employees:
                            emp_title = (emp.get("title") or "").lower()
                            if any(kw in emp_title for kw in title_keywords):
                                filtered.append(emp)
                        # If filter removes everything, keep original (decision makers are already filtered)
                        if filtered:
                            employees = filtered

                if employees:
                    save_linkedin_contacts(
                        company_name=company.name,
                        employees=employees,
                        domain=company.domain,
                    )

                all_leads.extend(
                    {**emp, "company": company.name} for emp in employees
                )

                print(f"[SalesNav] Got {len(employees)} leads from {company.name}")

            except Exception as exc:
                print(f"[SalesNav] Error scraping {company.name}: {exc}")
                errors.append({"company": company.name, "error": str(exc)})
                continue

        return {
            "success": True,
            "leads": all_leads,
            "saved_count": len(all_leads),
            "companies_processed": len(request.companies),
            "errors": errors if errors else None,
        }

    except Exception as exc:
        return {
            "success": False,
            "leads": all_leads,
            "saved_count": 0,
            "error": str(exc),
        }
    finally:
        await broadcast_event("browser_automation_stop", {"action": "scrape_leads"})
        set_active_browser_page(None)
        await scraper.stop()
