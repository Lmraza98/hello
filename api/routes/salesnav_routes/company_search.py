"""Company search endpoint for Sales Navigator."""

from fastapi import APIRouter, HTTPException

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.salesnav_routes.helpers import automation_scope
from api.routes.salesnav_routes.models import CompanySearchRequest, SalesNavCompanySearchResponse

router = APIRouter()


@router.post("/search-companies", response_model=SalesNavCompanySearchResponse, responses=COMMON_ERROR_RESPONSES)
async def search_companies(request: CompanySearchRequest):
    """
    Search for companies on Sales Navigator using a natural language query.
    Uses GPT-4 to parse the query into SalesNav filters, then scrapes results.
    Companies are optionally saved to the database.
    """
    from services.web_automation.linkedin.salesnav.flows.company_collection import SalesNavCompanyCollectionFlow

    collector = SalesNavCompanyCollectionFlow()
    try:
        async with automation_scope("company_search", {"action": "company_search", "query": request.query}):
            result = await collector.collect_companies(
                query=request.query,
                max_companies=request.max_companies,
                headless=False,
                save_to_db=request.save_to_db,
            )
            return SalesNavCompanySearchResponse.model_validate(result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
