"""Unified hybrid search routes."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES

router = APIRouter(prefix="/api/search", tags=["search"])


class HybridSearchRequest(BaseModel):
    query: str
    entity_types: list[str] = Field(
        default_factory=lambda: [
            "contact",
            "company",
            "campaign",
            "note",
            "conversation",
            "email_message",
            "email_thread",
            "file_chunk",
        ]
    )
    filters: dict[str, Any] = Field(default_factory=dict)
    k: int = 10


class HybridSearchResponse(BaseModel):
    results: list[dict[str, Any]] = Field(default_factory=list)


class ResolveEntityRequest(BaseModel):
    name_or_identifier: str
    entity_types: list[str] = Field(default_factory=lambda: ["contact", "company", "campaign"])
    k: int = 10


class ResolveEntityResponse(BaseModel):
    results: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/hybrid", response_model=HybridSearchResponse, responses=COMMON_ERROR_RESPONSES)
def hybrid_search(request: HybridSearchRequest):
    results = db.hybrid_search(
        query=request.query,
        entity_types=request.entity_types,
        filters=request.filters,
        k=request.k,
    )
    return {"results": results}


@router.post("/resolve", response_model=ResolveEntityResponse, responses=COMMON_ERROR_RESPONSES)
def resolve_entity(request: ResolveEntityRequest):
    results = db.resolve_entity(
        name_or_identifier=request.name_or_identifier,
        entity_types=request.entity_types,
        limit=request.k,
    )
    return {"results": results}
