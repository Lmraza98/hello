"""SalesNav browser workflow endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.routes._helpers import COMMON_ERROR_RESPONSES
from services.browser_workflows.recipes import extract_from_current, list_sub_items, search_and_extract

router = APIRouter()


class BrowserExtractCompaniesRequest(BaseModel):
    tab_id: str | None = None
    limit: int = Field(default=5, ge=1, le=100)


class BrowserExtractLeadsRequest(BaseModel):
    tab_id: str | None = None
    limit: int = Field(default=25, ge=1, le=200)


class BrowserSalesNavListEmployeesRequest(BaseModel):
    query: str | None = None
    tab_id: str | None = None
    limit: int = Field(default=50, ge=1, le=200)


class BrowserSalesNavSearchRequest(BaseModel):
    query: str
    wait_ms: int = Field(default=3000, ge=500, le=30_000)
    limit: int = Field(default=5, ge=1, le=100)
    keyword: str | None = None
    headquarters_location: str | None = None
    filters: dict[str, Any] | None = None
    click_company: str | None = None
    tab_id: str | None = None


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _resolve_first_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                return item.strip()
    return None


def _resolve_location_filter(headquarters_location: str | None, filters: dict[str, Any] | None) -> str | None:
    if headquarters_location and headquarters_location.strip():
        return headquarters_location.strip()
    if isinstance(filters, dict):
        return _resolve_first_string(filters.get("headquarters_location"))
    return None


def _coerce_filters(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in raw.items():
        key = _clean_text(k)
        if not key or v is None:
            continue
        if isinstance(v, list):
            values = [_clean_text(item) for item in v if _clean_text(item)]
            if values:
                out[key] = values
            continue
        cleaned = _clean_text(v)
        if cleaned:
            out[key] = cleaned
    return out


@router.post("/browser/extract-companies", responses=COMMON_ERROR_RESPONSES)
async def salesnav_extract_companies(req: BrowserExtractCompaniesRequest):
    try:
        result = await extract_from_current(
            task="salesnav_extract_companies",
            extract_type="company",
            tab_id=req.tab_id,
            limit=req.limit,
        )
        items = result.get("items") if isinstance(result, dict) else []
        companies = items if isinstance(items, list) else []
        return {**result, "companies": companies, "count": len(companies)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/browser/extract-leads", responses=COMMON_ERROR_RESPONSES)
async def salesnav_extract_leads(req: BrowserExtractLeadsRequest):
    try:
        result = await extract_from_current(
            task="salesnav_extract_leads",
            extract_type="lead",
            tab_id=req.tab_id,
            limit=req.limit,
        )
        items = result.get("items") if isinstance(result, dict) else []
        leads = items if isinstance(items, list) else []
        return {**result, "leads": leads, "count": len(leads)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/browser/list-employees", responses=COMMON_ERROR_RESPONSES)
async def salesnav_list_employees(req: BrowserSalesNavListEmployeesRequest):
    try:
        result = await list_sub_items(
            task="salesnav_list_employees",
            tab_id=req.tab_id,
            parent_query=req.query.strip() if isinstance(req.query, str) and req.query.strip() else None,
            parent_task="salesnav_search_account" if isinstance(req.query, str) and req.query.strip() else None,
            entrypoint_action="employee_entrypoint",
            extract_type="lead",
            limit=req.limit,
            wait_ms=1200,
        )
        items = result.get("items") if isinstance(result, dict) else []
        employees = items if isinstance(items, list) else []
        return {**result, "employees": employees, "clicked_view_all": bool(result.get("ok")), "employee_entry_url": result.get("url")}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/browser/search-account", responses=COMMON_ERROR_RESPONSES)
async def salesnav_search_account(req: BrowserSalesNavSearchRequest):
    try:
        keyword = _clean_text(req.keyword or req.query)
        if not keyword:
            raise HTTPException(status_code=400, detail={"code": "missing_keyword", "message": "query or keyword is required"})

        filter_values: dict[str, Any] = _coerce_filters(req.filters)
        geo = _resolve_location_filter(req.headquarters_location, req.filters)
        if geo:
            filter_values["headquarters_location"] = geo

        result = await search_and_extract(
            task="salesnav_search_account",
            query=keyword,
            filter_values=filter_values or None,
            click_target=req.click_company,
            extract_type="company",
            tab_id=req.tab_id,
            limit=req.limit,
            wait_ms=req.wait_ms,
        )

        # Legacy aliases expected by existing UI/tooling.
        applied_filters = result.get("applied_filters") if isinstance(result, dict) else None
        hq = applied_filters.get("headquarters_location") if isinstance(applied_filters, dict) else None
        legacy_applied_filters: dict[str, Any] = {}
        if geo:
            legacy_applied_filters["headquarters_location"] = geo if isinstance(hq, dict) and hq.get("applied") else None
            legacy_applied_filters["headquarters_location_applied"] = bool(isinstance(hq, dict) and hq.get("applied"))
            legacy_applied_filters["headquarters_location_debug"] = hq.get("debug") if isinstance(hq, dict) else None

        click = result.get("click") if isinstance(result, dict) else None
        clicked = bool(isinstance(click, dict) and click.get("clicked"))
        clicked_name = None
        clicked_url = None
        click_candidates: list[dict[str, Any]] = []
        if isinstance(click, dict):
            if clicked and isinstance(click.get("match"), dict):
                clicked_name = _clean_text((click.get("match") or {}).get("name")) or None
                clicked_url = _clean_text(click.get("url")) or None
            if not clicked:
                click_candidates = click.get("candidates") or []

        items = result.get("items") if isinstance(result, dict) else []
        companies = items if isinstance(items, list) else []

        return {
            **result,
            "query": req.query,
            "keyword": keyword,
            "applied_filters": legacy_applied_filters,
            "clicked": clicked,
            "clicked_name": clicked_name,
            "clicked_url": clicked_url,
            "click_candidates": click_candidates,
            "companies": companies,
            "count": len(companies),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
