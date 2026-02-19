"""Outreach workflow endpoints."""

from fastapi import APIRouter

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.workflow_routes.models import (
    EnrollAndDraftRequest,
    EnrollAndDraftResponse,
    ResolveContactRequest,
    ResolveContactResponse,
)

router = APIRouter()


@router.post("/resolve-contact", response_model=ResolveContactResponse, responses=COMMON_ERROR_RESPONSES)
async def resolve_contact_endpoint(request: ResolveContactRequest):
    """
    Search for a contact by name across the local database and Sales Navigator.
    Returns candidates from both sources plus a best-match suggestion.
    """
    from services.orchestration.workflows.outreach import resolve_contact

    result = await resolve_contact(name=request.name, company=request.company)
    return result


@router.post("/enroll-and-draft", response_model=EnrollAndDraftResponse, responses=COMMON_ERROR_RESPONSES)
async def enroll_and_draft_endpoint(request: EnrollAndDraftRequest):
    """
    Enroll a contact in a campaign and generate an email draft.
    Optionally creates the contact first if ``create_if_missing`` is provided.
    """
    from services.orchestration.workflows.outreach import enroll_and_draft

    result = await enroll_and_draft(
        campaign_id=request.campaign_id,
        contact_id=request.contact_id,
        create_if_missing=request.create_if_missing,
    )
    return result
