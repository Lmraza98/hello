"""
API routes for Salesforce credential management and auth status.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.salesforce_credentials import (
    save_credentials,
    get_credentials,
    clear_credentials,
    credentials_configured,
)
from services.salesforce_auth_manager import (
    get_auth_status,
    SalesforceAuthStatus,
    trigger_reauth,
    is_reauth_in_progress,
)


router = APIRouter(prefix="/api/salesforce", tags=["salesforce"])


class CredentialsInput(BaseModel):
    username: str
    password: str


class CredentialsResponse(BaseModel):
    success: bool
    message: str


class AuthStatusResponse(BaseModel):
    status: str  # "authenticated", "expired", "not_configured"
    username: Optional[str] = None
    message: str


class ReauthResponse(BaseModel):
    success: bool
    message: str
    in_progress: bool


@router.post("/credentials", response_model=CredentialsResponse)
async def save_salesforce_credentials(data: CredentialsInput):
    """Save Salesforce username and password (encrypted)."""
    if not data.username or not data.password:
        raise HTTPException(400, "Username and password are required")
    
    success = save_credentials(data.username, data.password)
    
    if success:
        return CredentialsResponse(
            success=True,
            message="Credentials saved successfully"
        )
    else:
        raise HTTPException(500, "Failed to save credentials. Is the cryptography package installed?")


@router.get("/auth-status", response_model=AuthStatusResponse)
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
            message="No Salesforce credentials configured. Add them in Settings."
        )
    
    # Get the stored username for display
    creds = get_credentials()
    username = creds["username"] if creds else None
    
    # Check actual auth status
    status = await get_auth_status()
    
    if status == SalesforceAuthStatus.AUTHENTICATED:
        return AuthStatusResponse(
            status="authenticated",
            username=username,
            message="Salesforce session is active"
        )
    elif status == SalesforceAuthStatus.EXPIRED:
        return AuthStatusResponse(
            status="expired",
            username=username,
            message="Salesforce session has expired. Re-authentication required."
        )
    else:
        return AuthStatusResponse(
            status="not_configured",
            message="Salesforce authentication state unknown"
        )


@router.delete("/credentials", response_model=CredentialsResponse)
async def delete_salesforce_credentials():
    """Clear stored Salesforce credentials."""
    success = clear_credentials()
    
    return CredentialsResponse(
        success=True,
        message="Credentials cleared" if success else "No credentials to clear"
    )


@router.post("/reauth", response_model=ReauthResponse)
async def trigger_salesforce_reauth():
    """
    Trigger Salesforce re-authentication.
    
    This will:
    1. Open the browser viewer (non-headless)
    2. Auto-fill stored credentials on the login page
    3. Wait for user to complete MFA if required
    4. Save the new session
    
    Returns immediately; the auth flow runs in background with browser visible.
    """
    if not credentials_configured():
        raise HTTPException(400, "No credentials configured. Save credentials first.")
    
    if is_reauth_in_progress():
        return ReauthResponse(
            success=False,
            message="Re-authentication already in progress",
            in_progress=True
        )
    
    # Start the re-auth process (async, runs in background)
    await trigger_reauth()
    
    return ReauthResponse(
        success=True,
        message="Re-authentication started. Complete MFA in the browser viewer if required.",
        in_progress=True
    )
