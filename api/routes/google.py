"""Google browser research API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.routes._helpers import COMMON_ERROR_RESPONSES
from services.google import google_search_workflow
from services.google.workflows import GoogleHumanVerificationRequired


GOOGLE_PREFIX = "/api/google"

router = APIRouter(tags=["google"])


class GoogleSearchBrowserRequest(BaseModel):
    query: str = Field(min_length=1, description="Search query to run on Google")
    tab_id: str | None = Field(default=None, description="Optional existing browser tab id")
    max_results: int = Field(default=5, ge=1, le=20, description="Max organic results to return")
    wait_for_ai_overview_ms: int = Field(
        default=8000,
        ge=0,
        le=30000,
        description="How long to wait for Google AI Overview before fallback to organic results",
    )


class GoogleCitation(BaseModel):
    title: str
    url: str


class GoogleOrganicResult(BaseModel):
    rank: int
    title: str
    url: str
    snippet: str


class GoogleSearchBrowserResponse(BaseModel):
    query: str
    tab_id: str | None = None
    url: str
    ai_overview_present: bool
    ai_overview_summary: str | None = None
    ai_overview_citations: list[GoogleCitation] = Field(default_factory=list)
    organic_results: list[GoogleOrganicResult] = Field(default_factory=list)
    source_strategy: str = "ai_overview_then_organic"


@router.post(
    f"{GOOGLE_PREFIX}/search-browser",
    response_model=GoogleSearchBrowserResponse,
    responses=COMMON_ERROR_RESPONSES,
)
async def google_search_browser(req: GoogleSearchBrowserRequest) -> dict[str, Any]:
    try:
        return await google_search_workflow(
            query=req.query,
            tab_id=req.tab_id,
            max_results=req.max_results,
            wait_for_ai_overview_ms=req.wait_for_ai_overview_ms,
        )
    except GoogleHumanVerificationRequired as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "human_verification_required",
                "message": str(exc),
                "retry_suggestion": "Open the live browser session and complete the verification page, then retry.",
                "url": exc.url,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
