"""Prospecting workflow endpoints."""

from fastapi import APIRouter

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.workflow_routes.models import (
    ProspectRequest,
    ProspectResponse,
    ScrapeLeadsBatchRequest,
    ScrapeLeadsBatchResponse,
)

router = APIRouter()


@router.post("/prospect", response_model=ProspectResponse, responses=COMMON_ERROR_RESPONSES)
async def prospect_endpoint(request: ProspectRequest):
    """
    Search for target companies via Sales Navigator.
    Results include deduplication against existing DB companies.
    """
    from services.workflows.prospecting import prospect

    result = await prospect(
        query=request.query,
        industry=request.industry,
        location=request.location,
        max_companies=request.max_companies,
        save_to_db=request.save_to_db,
    )
    return result


@router.post("/scrape-leads-batch", response_model=ScrapeLeadsBatchResponse, responses=COMMON_ERROR_RESPONSES)
async def scrape_leads_batch_endpoint(request: ScrapeLeadsBatchRequest):
    """
    Scrape decision-makers from multiple companies in one call.
    Contacts are saved to the database.
    """
    from services.workflows.prospecting import scrape_leads_batch

    result = await scrape_leads_batch(
        company_names=request.company_names,
        title_filter=request.title_filter,
        max_per_company=request.max_per_company,
    )
    return result
