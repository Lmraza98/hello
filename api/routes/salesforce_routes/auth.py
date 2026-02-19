"""Auth status and reauthentication endpoints for Salesforce API."""

from fastapi import APIRouter, HTTPException

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.salesforce_routes.models import AuthStatusResponse, ReauthResponse
from services.web_automation.salesforce.auth_manager import (
    SalesforceAuthStatus,
    get_auth_status,
    is_reauth_in_progress,
    trigger_reauth,
)
from services.web_automation.salesforce.credentials import credentials_configured, get_credentials

router = APIRouter()


@router.get("/auth-status", response_model=AuthStatusResponse, responses=COMMON_ERROR_RESPONSES)
async def get_salesforce_auth_status():
    """
    Get current Salesforce authentication status.

    Returns:
    - "authenticated": Session is valid
    - "expired": Session exists but has expired
    - "not_configured": No credentials saved
    """
    if not credentials_configured():
        return AuthStatusResponse(
            status="not_configured",
            message="No Salesforce credentials configured. Add them in Settings.",
        )

    creds = get_credentials()
    username = creds["username"] if creds else None
    status = await get_auth_status()

    if status == SalesforceAuthStatus.AUTHENTICATED:
        return AuthStatusResponse(
            status="authenticated",
            username=username,
            message="Salesforce session is active",
        )
    if status == SalesforceAuthStatus.EXPIRED:
        return AuthStatusResponse(
            status="expired",
            username=username,
            message="Salesforce session has expired. Re-authentication required.",
        )
    return AuthStatusResponse(
        status="not_configured",
        message="Salesforce authentication state unknown",
    )


@router.post("/reauth", response_model=ReauthResponse, responses=COMMON_ERROR_RESPONSES)
async def trigger_salesforce_reauth():
    """
    Trigger Salesforce re-authentication.

    Returns immediately; the auth flow runs in the background with browser visible.
    """
    if not credentials_configured():
        raise HTTPException(400, "No credentials configured. Save credentials first.")

    if is_reauth_in_progress():
        return ReauthResponse(
            success=False,
            message="Re-authentication already in progress",
            in_progress=True,
        )

    await trigger_reauth()
    return ReauthResponse(
        success=True,
        message="Re-authentication started. Complete MFA in the browser viewer if required.",
        in_progress=True,
    )
