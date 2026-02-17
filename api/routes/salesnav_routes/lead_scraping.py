"""Lead scraping endpoint for Sales Navigator."""

from fastapi import APIRouter, HTTPException

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.browser_stream import broadcast_event
from api.routes.salesnav_routes.helpers import to_absolute_linkedin_url
from api.routes.salesnav_routes.models import ScrapeLeadsRequest, SalesNavScrapeLeadsResponse
from services.browser_workflows.recipes import extract_from_current, search_and_extract

router = APIRouter()


@router.post("/scrape-leads", response_model=SalesNavScrapeLeadsResponse, responses=COMMON_ERROR_RESPONSES)
async def scrape_leads(request: ScrapeLeadsRequest):
    """
    Scrape leads (decision-makers) from a list of companies.
    For each company, navigates to the company on Sales Navigator,
    clicks "Decision Makers", and scrapes the results.
    Contacts are saved to the database.
    """
    from services.contacts import save_linkedin_contacts

    all_leads = []
    errors = []

    try:
        for idx, company in enumerate(request.companies):
            try:
                print(f"[SalesNav] Scraping leads from {company.name} ({idx + 1}/{len(request.companies)})")
                await broadcast_event(
                    "browser_automation_progress",
                    {
                        "action": "scrape_leads",
                        "message": f"Scraping {company.name} ({idx + 1}/{len(request.companies)})",
                        "company": company.name,
                        "index": idx + 1,
                        "total": len(request.companies),
                    },
                )

                # Navigate SalesNav to the target account.
                search = await search_and_extract(
                    task="salesnav_search_account",
                    query=company.name,
                    filter_values=None,
                    click_target=company.name,
                    extract_type="company",
                    tab_id=None,
                    limit=5,
                    wait_ms=3500,
                )
                extracted = await extract_from_current(
                    task="salesnav_extract_leads",
                    extract_type="lead",
                    tab_id=search.get("tab_id") if isinstance(search, dict) else None,
                    query=company.name,
                    limit=max(1, min(request.max_per_company * 3, 100)),
                )
                leads = extracted.get("items", []) if isinstance(extracted, dict) else []
                employees = []
                for lead in leads:
                    name = lead.get("name")
                    if not name:
                        continue
                    employees.append(
                        {
                            "name": name,
                            "title": lead.get("title"),
                            "linkedin_url": to_absolute_linkedin_url(lead.get("linkedin_url")),
                        }
                    )

                if request.title_filter and employees:
                    title_keywords = [token.strip().lower() for token in request.title_filter.split(",") if token.strip()]
                    if title_keywords:
                        filtered = []
                        for employee in employees:
                            title = (employee.get("title") or "").lower()
                            if any(keyword in title for keyword in title_keywords):
                                filtered.append(employee)
                        if filtered:
                            employees = filtered

                employees = employees[: request.max_per_company]
                if employees:
                    save_linkedin_contacts(
                        company_name=company.name,
                        employees=employees,
                        domain=company.domain,
                    )

                all_leads.extend({**employee, "company": company.name} for employee in employees)
                print(f"[SalesNav] Got {len(employees)} leads from {company.name}")
            except Exception as exc:
                print(f"[SalesNav] Error scraping {company.name}: {exc}")
                errors.append({"company": company.name, "error": str(exc)})
                continue

        return SalesNavScrapeLeadsResponse(
            success=True,
            leads=all_leads,
            saved_count=len(all_leads),
            companies_processed=len(request.companies),
            errors=errors if errors else None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
