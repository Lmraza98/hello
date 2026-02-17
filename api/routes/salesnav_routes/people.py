"""People search endpoint for Sales Navigator."""

from fastapi import APIRouter, HTTPException

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.browser_nav import (
    BrowserNavigateRequest,
    browser_navigate,
)
from api.routes.salesnav_routes.helpers import normalize, people_search_url, to_absolute_linkedin_url
from api.routes.salesnav_routes.models import SalesNavPersonSearchResponse, SalesNavSearchRequest
from services.browser_workflows.recipes import extract_from_current

router = APIRouter()


@router.post("/search", response_model=SalesNavPersonSearchResponse, responses=COMMON_ERROR_RESPONSES)
async def salesnav_person_search(request: SalesNavSearchRequest):
    """
    Search people in Sales Navigator and return lightweight profile cards.
    """
    full_name = f"{request.first_name} {request.last_name}".strip()
    keyword = " ".join(part for part in [full_name, request.company or ""] if part).strip()
    max_results = max(1, min(request.max_results, 20))

    try:
        print(f"[SalesNav] People search keyword: {keyword}")
        nav = await browser_navigate(BrowserNavigateRequest(url=people_search_url(keyword)))
        extracted = await extract_from_current(
            task="salesnav_extract_leads",
            extract_type="lead",
            tab_id=nav.get("tab_id") if isinstance(nav, dict) else None,
            query=keyword,
            limit=max_results * 3,
        )
        employees = extracted.get("items", []) if isinstance(extracted, dict) else []

        query_name = normalize(full_name)
        query_first = normalize(request.first_name)
        query_last = normalize(request.last_name)
        query_company = normalize(request.company or "")

        ranked = []
        for employee in employees or []:
            name = employee.get("name") or ""
            title = employee.get("title") or ""
            linkedin_url = to_absolute_linkedin_url(employee.get("linkedin_url"))
            if not name:
                continue

            name_normalized = normalize(name)
            title_normalized = normalize(title)
            score = 0

            if query_name and query_name in name_normalized:
                score += 5
            if query_first and query_first in name_normalized:
                score += 2
            if query_last and query_last in name_normalized:
                score += 3
            if query_company and query_company in title_normalized:
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

        return SalesNavPersonSearchResponse(success=True, searched_query=keyword, profiles=profiles)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
