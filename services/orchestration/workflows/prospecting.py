"""
Prospecting workflow service — find companies and scrape leads.

Wraps the SalesNav company search and lead scraping into two atomic
operations that return enriched results with DB deduplication.
"""

from typing import Any, Dict, List, Optional

import database as db


# ---------------------------------------------------------------------------
# prospect: search for companies matching criteria
# ---------------------------------------------------------------------------

async def prospect(
    query: str,
    industry: Optional[str] = None,
    location: Optional[str] = None,
    max_companies: int = 10,
    save_to_db: bool = True,
) -> Dict[str, Any]:
    """
    Search for companies via SalesNav and optionally save to DB.
    Enriches the response with existing-company deduplication.

    Returns:
        {
          "companies": [ ... ],
          "saved_count": int,
          "existing_count": int,
          "query": str
        }
    """
    from api.routes.salesnav_routes.company_search import search_companies
    from api.routes.salesnav_routes.models import CompanySearchRequest

    request = CompanySearchRequest(
        query=query,
        max_companies=max_companies,
        save_to_db=save_to_db,
    )

    try:
        result = await search_companies(request)
    except Exception as exc:
        return {
            "companies": [],
            "saved_count": 0,
            "existing_count": 0,
            "query": query,
            "error": str(exc),
        }

    companies = []
    if hasattr(result, "companies"):
        companies = result.companies if isinstance(result.companies, list) else []
    elif isinstance(result, dict):
        companies = result.get("companies", [])

    # Enrich with existing-company info from DB
    company_names = []
    for c in companies:
        name = c.get("company_name") or c.get("name") or ""
        if name:
            company_names.append(name)

    existing_map: Dict[str, Any] = {}
    if company_names:
        try:
            with db.get_db() as conn:
                cursor = conn.cursor()
                for name in company_names:
                    cursor.execute(
                        "SELECT id, company_name, status FROM targets WHERE LOWER(company_name) = LOWER(?) LIMIT 1",
                        (name,),
                    )
                    row = cursor.fetchone()
                    if row:
                        existing_map[name.lower()] = dict(row)
        except Exception:
            pass

    existing_count = len(existing_map)
    saved_count = 0
    if hasattr(result, "saved_count") and result.saved_count is not None:
        saved_count = result.saved_count
    elif isinstance(result, dict):
        saved_count = result.get("saved_count", 0)

    return {
        "companies": companies,
        "saved_count": saved_count,
        "existing_count": existing_count,
        "existing_companies": existing_map,
        "query": query,
    }


# ---------------------------------------------------------------------------
# scrape_leads_batch: scrape decision-makers from a list of companies
# ---------------------------------------------------------------------------

async def scrape_leads_batch(
    company_names: List[str],
    title_filter: Optional[str] = None,
    max_per_company: int = 5,
) -> Dict[str, Any]:
    """
    Scrape leads from multiple companies in one call.

    Returns:
        {
          "leads": [ ... ],
          "saved_count": int,
          "companies_processed": int,
          "errors": [ ... ] | None
        }
    """
    from api.routes.salesnav_routes.lead_scraping import scrape_leads
    from api.routes.salesnav_routes.models import CompanyRef, ScrapeLeadsRequest

    company_refs = [CompanyRef(name=n) for n in company_names if n]

    if not company_refs:
        return {
            "leads": [],
            "saved_count": 0,
            "companies_processed": 0,
            "errors": None,
        }

    request = ScrapeLeadsRequest(
        companies=company_refs,
        title_filter=title_filter,
        max_per_company=max_per_company,
    )

    try:
        result = await scrape_leads(request)
        return {
            "leads": [l.model_dump() if hasattr(l, "model_dump") else l for l in (result.leads or [])],
            "saved_count": result.saved_count,
            "companies_processed": result.companies_processed,
            "errors": [e.model_dump() if hasattr(e, "model_dump") else e for e in (result.errors or [])] if result.errors else None,
        }
    except Exception as exc:
        return {
            "leads": [],
            "saved_count": 0,
            "companies_processed": 0,
            "errors": [{"company": "batch", "error": str(exc)}],
        }
