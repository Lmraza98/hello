"""Shared helpers for route validation and common HTTP errors."""

from typing import Any

from fastapi import HTTPException

import database as db
from api.models import ErrorEnvelope

COMMON_ERROR_RESPONSES = {
    400: {"model": ErrorEnvelope, "description": "Bad Request"},
    401: {"model": ErrorEnvelope, "description": "Unauthorized"},
    404: {"model": ErrorEnvelope, "description": "Not Found"},
    500: {"model": ErrorEnvelope, "description": "Internal Server Error"},
}


def not_found(detail: str = "Not found") -> None:
    """Raise a 404 with a consistent shape."""
    raise HTTPException(status_code=404, detail=detail)


def internal_error(detail: str = "Internal server error") -> None:
    """Raise a 500 with a consistent shape."""
    raise HTTPException(status_code=500, detail=detail)


def require_campaign(campaign_id: int) -> dict[str, Any]:
    """Load a campaign or raise 404."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        not_found("Campaign not found")
    return campaign


def require_row_updated(rowcount: int, detail: str) -> None:
    """Assert an UPDATE/DELETE touched at least one row."""
    if rowcount == 0:
        not_found(detail)
