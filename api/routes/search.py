"""Unified hybrid search routes."""

from typing import Any

from fastapi import APIRouter
import json

from pydantic import BaseModel, Field, model_validator, field_validator

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

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_payload(cls, value: Any):
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if not payload.get("query") and isinstance(payload.get("name_or_identifier"), str):
            payload["query"] = payload["name_or_identifier"].strip()
        return payload

    @field_validator("entity_types", mode="before")
    @classmethod
    def _coerce_entity_types(cls, value: Any):
        if value is None:
            return value
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        if isinstance(value, (tuple, set)):
            return [str(part).strip() for part in value if str(part).strip()]
        if isinstance(value, list):
            return [str(part).strip() for part in value if str(part).strip()]
        return value

    @field_validator("filters", mode="before")
    @classmethod
    def _coerce_filters(cls, value: Any):
        if value is None:
            return {}
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return value if isinstance(value, dict) else {}

    @field_validator("k", mode="before")
    @classmethod
    def _coerce_k(cls, value: Any):
        if value is None:
            return 10
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return 10
            try:
                return int(value)
            except ValueError:
                return 10
        return value


class HybridSearchResponse(BaseModel):
    results: list[dict[str, Any]] = Field(default_factory=list)
    timings: dict[str, Any] | None = None


class ResolveEntityRequest(BaseModel):
    name_or_identifier: str
    entity_types: list[str] = Field(default_factory=lambda: ["contact", "company", "campaign"])
    k: int = 10

    @field_validator("entity_types", mode="before")
    @classmethod
    def _coerce_entity_types(cls, value: Any):
        if value is None:
            return value
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        if isinstance(value, (tuple, set)):
            return [str(part).strip() for part in value if str(part).strip()]
        if isinstance(value, list):
            return [str(part).strip() for part in value if str(part).strip()]
        return value

    @field_validator("k", mode="before")
    @classmethod
    def _coerce_k(cls, value: Any):
        if value is None:
            return 10
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return 10
            try:
                return int(value)
            except ValueError:
                return 10
        return value


class ResolveEntityResponse(BaseModel):
    results: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/hybrid", response_model=HybridSearchResponse, responses=COMMON_ERROR_RESPONSES)
def hybrid_search(request: HybridSearchRequest):
    timings: dict[str, Any] = {}
    results = db.hybrid_search(
        query=request.query,
        entity_types=request.entity_types,
        filters=request.filters,
        k=request.k,
        debug_timing=timings,
    )
    return {"results": results, "timings": timings}


@router.post("/resolve", response_model=ResolveEntityResponse, responses=COMMON_ERROR_RESPONSES)
def resolve_entity(request: ResolveEntityRequest):
    results = db.resolve_entity(
        name_or_identifier=request.name_or_identifier,
        entity_types=request.entity_types,
        limit=request.k,
    )
    return {"results": results}
