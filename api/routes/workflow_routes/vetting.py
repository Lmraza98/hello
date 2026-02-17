"""Vetting workflow endpoints."""

from fastapi import APIRouter

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.workflow_routes.models import (
    LookupAndResearchRequest,
    LookupAndResearchResponse,
    VetBatchRequest,
    VetBatchResponse,
)

router = APIRouter()


@router.post("/lookup-and-research", response_model=LookupAndResearchResponse, responses=COMMON_ERROR_RESPONSES)
async def lookup_and_research_endpoint(request: LookupAndResearchRequest):
    """
    Batch-lookup companies in the database and run web research + ICP
    assessment for each one.  Returns all data needed for the vetting UI.
    """
    from services.workflows.vetting import lookup_and_research

    result = await lookup_and_research(
        company_names=request.company_names,
        icp_context=request.icp_context,
    )
    return result


@router.post("/vet-batch", response_model=VetBatchResponse, responses=COMMON_ERROR_RESPONSES)
def vet_batch_endpoint(request: VetBatchRequest):
    """
    Record vetting decisions (approve / skip) for a batch of companies.
    """
    from services.workflows.vetting import vet_batch

    decisions = [d.model_dump() for d in request.decisions]
    result = vet_batch(decisions)
    return result
