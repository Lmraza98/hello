"""Credential endpoints for Salesforce API."""

from fastapi import APIRouter, HTTPException

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.salesforce_routes.models import CredentialsInput, CredentialsResponse
from services.salesforce.credentials import clear_credentials, save_credentials

router = APIRouter()


@router.post("/credentials", response_model=CredentialsResponse, responses=COMMON_ERROR_RESPONSES)
async def save_salesforce_credentials(data: CredentialsInput):
    """Save Salesforce username and password (encrypted)."""
    if not data.username or not data.password:
        raise HTTPException(400, "Username and password are required")

    success = save_credentials(data.username, data.password)
    if success:
        return CredentialsResponse(success=True, message="Credentials saved successfully")

    raise HTTPException(500, "Failed to save credentials. Is the cryptography package installed?")


@router.delete("/credentials", response_model=CredentialsResponse, responses=COMMON_ERROR_RESPONSES)
async def delete_salesforce_credentials():
    """Clear stored Salesforce credentials."""
    success = clear_credentials()
    return CredentialsResponse(
        success=True,
        message="Credentials cleared" if success else "No credentials to clear",
    )
