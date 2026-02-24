"""SalesNav account-search URL query builder.

Builds deterministic Sales Navigator query URLs using keywords + structured
filter payloads, without UI filter interaction.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from functools import lru_cache
from pathlib import Path
import re
from typing import Any
from urllib.parse import quote, unquote


BASE_ACCOUNT_SEARCH_URL = "https://www.linkedin.com/sales/search/company"
BASE_PEOPLE_SEARCH_URL = "https://www.linkedin.com/sales/search/people"


class SalesNavQueryBuildError(ValueError):
    def __init__(self, unmapped_filters: list[dict[str, str]]):
        self.unmapped_filters = unmapped_filters
        super().__init__("one_or_more_filters_are_unmapped")


@dataclass
class SalesNavQueryBuildResult:
    url: str
    query: str
    applied_filters: dict[str, dict[str, Any]]
    unmapped_filters: list[dict[str, str]]


_INDUSTRY_ID_BY_NAME: dict[str, str] = {
    "hospitals and health care": "14",
    "optometrists": "2050",
    "chiropractors": "2048",
}

_COMPANY_HEADCOUNT_ID_BY_LABEL: dict[str, str] = {
    "1-10": "B",
    "11-50": "C",
    "51-200": "D",
    "201-500": "E",
    "501-1000": "F",
    "501-1,000": "F",
    "1001-5000": "G",
    "1,001-5,000": "G",
    "5001-10000": "H",
    "5,001-10,000": "H",
    "10001+": "I",
    "10,001+": "I",
}

_FORTUNE_ID_BY_LABEL: dict[str, list[str]] = {
    "fortune 50": ["1"],
    "fortune 51-100": ["2"],
    "fortune 101-250": ["3"],
    "fortune 251-500": ["4"],
    # "Fortune 500" represented as the union of 50/100/250/500 buckets.
    "fortune 500": ["1", "2", "3", "4"],
}

_REGION_ID_BY_NAME: dict[str, str] = {
    "united states": "103644278",
}

_FOLLOWER_ID_BY_LABEL: dict[str, str] = {
    "1-50": "NFR1",
    "51-100": "NFR2",
    "101-1000": "NFR3",
    "1001-5000": "NFR4",
    "5001+": "NFR5",
    "5,001+": "NFR5",
}

_JOB_OPPORTUNITIES_ID_BY_LABEL: dict[str, str] = {
    "has job opportunities": "JO1",
    "hiring on linkedin": "JO1",
}

_ACCOUNT_ACTIVITIES_ID_BY_LABEL: dict[str, str] = {
    "senior leadership changes in last 3 months": "SLC",
}

_RELATIONSHIP_ID_BY_LABEL: dict[str, str] = {
    "1st degree connections": "F",
    "1st degree": "F",
}

_DEPARTMENT_ID_BY_NAME: dict[str, int] = {
    "accounting": 1,
    "administrative": 2,
    "arts and design": 3,
    "business development": 4,
    "community and social services": 5,
    "consulting": 6,
    "education": 7,
    "engineering": 8,
    "entrepreneurship": 9,
    "finance": 10,
    "healthcare services": 11,
    "human resources": 12,
    "information technology": 13,
    "legal": 14,
    "marketing": 15,
    "media and communication": 16,
    "military and protective services": 17,
    "operations": 18,
    "product management": 19,
    "program and project management": 20,
    "purchasing": 21,
    "quality assurance": 22,
    "real estate": 23,
    "research": 24,
    "sales": 25,
    "support": 26,
}

_PEOPLE_FUNCTION_ID_BY_LABEL: dict[str, str] = {
    "accounting": "1",
    "administrative": "2",
    "arts and design": "3",
    "business development": "4",
    "community and social services": "5",
    "consulting": "6",
    "education": "7",
    "engineering": "8",
    "entrepreneurship": "9",
    "finance": "10",
    "healthcare services": "11",
    "human resources": "12",
    "information technology": "13",
    "legal": "14",
    "marketing": "15",
    "media and communication": "16",
    "military and protective services": "17",
    "operations": "18",
    "product management": "19",
    "program and project management": "20",
    "purchasing": "21",
    "quality assurance": "22",
    "real estate": "23",
    "research": "24",
    "sales": "25",
    "customer success and support": "26",
    "support": "26",
}

_PEOPLE_SENIORITY_ID_BY_LABEL: dict[str, str] = {
    "in training": "100",
    "entry level": "110",
    "senior": "120",
    "strategic": "130",
    "entry level manager": "200",
    "experienced manager": "210",
    "director": "220",
    "vice president": "300",
    "vp": "300",
    "cxo": "310",
    "owner / partner": "320",
    "owner/partner": "320",
    "owner partner": "320",
}


@lru_cache(maxsize=1)
def _load_filter_ids_file_maps() -> dict[str, dict[str, str]]:
    """
    Load canonical text->id mappings from `data/linkedin/salesnav-filters-ids.json`.

    Supports JSON-first formats and a legacy markdown/yaml-like fallback.
    """
    path = Path("data/linkedin/salesnav-filters-ids.json")
    out: dict[str, dict[str, str]] = {
        "INDUSTRY": {},
        "COMPANY_HEADCOUNT": {},
        "FORTUNE": {},
        "REGION": {},
        "NUM_OF_FOLLOWERS": {},
        "JOB_OPPORTUNITIES": {},
        "ACCOUNT_ACTIVITIES": {},
        "RELATIONSHIP": {},
    }
    if not path.exists():
        return out

    try:
        raw = path.read_text(encoding="utf-8")
    except Exception:
        return out

    # Preferred path: valid JSON.
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            # Shape A: {"filters":{"INDUSTRY":[{"id":"14","text":"..."}]}}
            node = parsed.get("filters") if isinstance(parsed.get("filters"), dict) else parsed
            if isinstance(node, dict):
                for filter_type, items in node.items():
                    ftype = _clean(filter_type).upper()
                    if ftype not in out:
                        out[ftype] = {}
                    if isinstance(items, list):
                        for item in items:
                            if not isinstance(item, dict):
                                continue
                            raw_id = _clean(item.get("id"))
                            text = _clean(item.get("text"))
                            if raw_id and text:
                                out[ftype][_norm(text)] = raw_id
                return out
        if isinstance(parsed, list):
            # Shape B: [{"id":"14","text":"..."}] -> assume INDUSTRY.
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                raw_id = _clean(item.get("id"))
                text = _clean(item.get("text"))
                if raw_id and text:
                    out["INDUSTRY"][_norm(text)] = raw_id
            return out
    except Exception:
        pass

    # Legacy fallback: markdown/yaml-like list.
    lines = raw.splitlines()
    current_type = "INDUSTRY"
    pending_id: str | None = None
    section_re = re.compile(r"^#\s*([A-Z_ ]+)\s+filter values", flags=re.IGNORECASE)
    id_re = re.compile(r"^-\s*id:\s*([^\s#]+)\s*$", flags=re.IGNORECASE)
    text_re = re.compile(r"^\s*text:\s*(.+?)\s*$", flags=re.IGNORECASE)

    for raw in lines:
        line = raw.strip("\n")
        stripped = line.strip()
        if not stripped:
            continue
        m_section = section_re.match(stripped)
        if m_section:
            normalized = re.sub(r"\s+", "_", _clean(m_section.group(1)).upper())
            current_type = normalized
            if current_type not in out:
                out[current_type] = {}
            pending_id = None
            continue
        m_id = id_re.match(stripped)
        if m_id:
            pending_id = _clean(m_id.group(1))
            continue
        m_text = text_re.match(line)
        if m_text and pending_id:
            text = _clean(m_text.group(1))
            if text:
                out.setdefault(current_type, {})[_norm(text)] = pending_id
            pending_id = None
    return out


@lru_cache(maxsize=1)
def _load_salesnav_filter_catalog_options() -> dict[str, set[str]]:
    path = Path("data/linkedin/salesnav-filters.json")
    out: dict[str, set[str]] = {
        "industry": set(),
        "company_headcount": set(),
    }
    if not path.exists():
        return out
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return out
    root = payload.get("sales_navigator_filters") if isinstance(payload, dict) else {}
    if not isinstance(root, dict):
        return out
    personal = root.get("personal") if isinstance(root.get("personal"), dict) else {}
    company = root.get("company") if isinstance(root.get("company"), dict) else {}

    industries = personal.get("industry") if isinstance(personal.get("industry"), dict) else {}
    out["industry"] = {_norm(x) for x in (industries.get("options") or []) if _clean(x)}

    headcount = company.get("company_headcount") if isinstance(company.get("company_headcount"), dict) else {}
    out["company_headcount"] = {_norm(x) for x in (headcount.get("options") or []) if _clean(x)}
    return out


@lru_cache(maxsize=1)
def _load_observed_filter_id_maps() -> dict[str, dict[str, str]]:
    """
    Build text->id maps from previously observed SalesNav query URLs saved in debug manifests.
    This lets the URL builder reuse known IDs without hardcoding every value.
    """
    out: dict[str, dict[str, str]] = {
        "INDUSTRY": {},
        "COMPANY_HEADCOUNT": {},
        "FORTUNE": {},
        "REGION": {},
        "NUM_OF_FOLLOWERS": {},
        "JOB_OPPORTUNITIES": {},
        "ACCOUNT_ACTIVITIES": {},
        "RELATIONSHIP": {},
    }
    base = Path("data/debug")
    if not base.exists():
        return out

    def _walk_urls(node: Any) -> list[str]:
        if isinstance(node, dict):
            urls: list[str] = []
            for key, value in node.items():
                if isinstance(value, str) and key in {"url", "current_url"} and "linkedin.com/sales/search/company" in value:
                    urls.append(value)
                else:
                    urls.extend(_walk_urls(value))
            return urls
        if isinstance(node, list):
            urls: list[str] = []
            for item in node:
                urls.extend(_walk_urls(item))
            return urls
        return []

    for manifest in base.rglob("manifest.json"):
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
        except Exception:
            continue
        for url in _walk_urls(payload):
            if "query=" not in url:
                continue
            decoded = url
            try:
                # Query payload is frequently encoded once or twice in captured logs.
                from urllib.parse import unquote

                decoded = unquote(unquote(url))
            except Exception:
                pass
            for seg in decoded.split("(type:")[1:]:
                filter_type = seg.split(",", 1)[0].strip().upper()
                if filter_type not in out:
                    continue
                for m in re.finditer(r"id:([^,\)\s]+),text:([^,\)]+),selectionType:", seg):
                    raw_id = _clean(m.group(1))
                    raw_text = _clean(m.group(2))
                    if not raw_id or not raw_text:
                        continue
                    out[filter_type][_norm(raw_text)] = raw_id
    return out


def _lookup_filter_id(filter_type: str, text: str, static_map: dict[str, str]) -> str | None:
    k = _norm(text)
    value = static_map.get(k)
    if value:
        return value
    from_file = _load_filter_ids_file_maps().get(filter_type.upper(), {})
    if k in from_file:
        return from_file[k]
    observed = _load_observed_filter_id_maps().get(filter_type.upper(), {})
    return observed.get(k)


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _norm(value: Any) -> str:
    return _clean(value).lower()


def _as_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            text = _clean(item)
            if text:
                out.append(text)
        return out
    text = _clean(value)
    return [text] if text else []


def infer_industry_from_query_text(query: Any) -> str | None:
    """
    Deterministically infer account industry text from a free-form query, using
    canonical SalesNav catalogs/IDs as the grounding source.
    """
    text = _clean(query)
    if not text:
        return None
    low = _norm(text)

    # Prefer explicit "X industry/sector/market" phrasing.
    m = re.search(r"\b(?:in|for)\s+the\s+([a-z0-9&,\-/ ]+?)\s+(?:industry|sector|market)\b", low)
    candidate = _clean(m.group(1)) if m else ""

    synonym_to_canonical = {
        "tech": "Technology, Information and Internet",
        "technology": "Technology, Information and Internet",
        "software": "Technology, Information and Internet",
        "healthcare": "Hospitals and Health Care",
        "health care": "Hospitals and Health Care",
        "hospital": "Hospitals and Health Care",
        "construction": "Construction",
        "finance": "Financial Services",
        "financial services": "Financial Services",
        "fintech": "Financial Services",
        "banking": "Financial Services",
        "bank": "Financial Services",
    }

    def _resolve(raw: str) -> str | None:
        value = _clean(raw)
        if not value:
            return None
        norm = _norm(value)
        if norm in synonym_to_canonical:
            return synonym_to_canonical[norm]
        catalog = _load_salesnav_filter_catalog_options().get("industry", set())
        if norm in catalog and _lookup_filter_id("INDUSTRY", value, _INDUSTRY_ID_BY_NAME):
            return value
        return None

    resolved = _resolve(candidate)
    if resolved:
        return resolved

    # Fallback token scan for common industry anchors in full query text.
    for token, canonical in synonym_to_canonical.items():
        if re.search(rf"(^|[^a-z0-9]){re.escape(token)}([^a-z0-9]|$)", low):
            if _lookup_filter_id("INDUSTRY", canonical, _INDUSTRY_ID_BY_NAME):
                return canonical

    return None


def _encode_text(text: str) -> str:
    return quote(text, safe="")


def _parse_int_range(value: str) -> tuple[int, int] | None:
    text = _norm(value).replace("%", "").replace("m", "")
    match = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", text)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _format_query_number(value: float | int) -> str:
    try:
        num = float(value)
    except Exception:
        return str(value)
    if abs(num - int(num)) < 1e-9:
        return str(int(num))
    return f"{num:.6f}".rstrip("0").rstrip(".")


def _parse_annual_revenue_range(value: str) -> tuple[float, float] | None:
    text = _norm(value)
    text = (
        text.replace("$", "")
        .replace(",", "")
        .replace("usd", "")
        .replace("million", "")
        .replace("millions", "")
        .replace("mn", "")
        .replace("mm", "")
        .replace("m", "")
    ).strip()

    # Open-ended ranges use LinkedIn sentinel max=1001 in USD millions.
    # Examples: "1000+", "500+", "100m+"
    m_plus = re.match(r"^\s*(\d+(?:\.\d+)?)\s*\+\s*$", text)
    if m_plus:
        mn = float(m_plus.group(1))
        return mn, 1001.0

    # Explicit numeric ranges: "0.5-1", "10-50", "2.5 - 20"
    m_range = re.match(r"^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$", text)
    if not m_range:
        return None
    return float(m_range.group(1)), float(m_range.group(2))


def _build_industry_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    def _canonicalize_industry_value(value: str) -> str:
        text = _clean(value)
        low = _norm(text)
        if not low:
            return text

        # Strip common noisy wrappers produced by NL decomposition.
        low = re.sub(r"\b(companies?|businesses|organizations?|orgs)\b", " ", low)
        low = re.sub(r"\b(in|within|for|the|industry|sector|market)\b", " ", low)
        low = re.sub(r"\s+", " ", low).strip(" ,.;")

        synonym_map = {
            "tech": "Technology, Information and Internet",
            "technology": "Technology, Information and Internet",
            "software": "Technology, Information and Internet",
            "healthcare": "Hospitals and Health Care",
            "health care": "Hospitals and Health Care",
            "hospital": "Hospitals and Health Care",
            "construction": "Construction",
            "finance": "Financial Services",
            "financial services": "Financial Services",
            "fintech": "Financial Services",
            "banking": "Financial Services",
            "bank": "Financial Services",
        }
        if low in synonym_map:
            return synonym_map[low]

        # Token-level fallback for phrases like "companies in the tech".
        if "tech" in low or "technology" in low or "software" in low:
            return "Technology, Information and Internet"
        if "health" in low or "hospital" in low:
            return "Hospitals and Health Care"
        if "construction" in low:
            return "Construction"
        if "finance" in low or "fintech" in low or "bank" in low:
            return "Financial Services"

        # If exact catalog text exists, preserve original casing from input.
        catalog = _load_salesnav_filter_catalog_options().get("industry", set())
        if low in catalog:
            return text
        return text

    values = _as_string_list(raw)
    if not values:
        return None, None, None
    parts: list[str] = []
    resolved: list[dict[str, str]] = []
    normalized_values: list[str] = []
    for raw_value in values:
        value = _canonicalize_industry_value(raw_value)
        industry_id = _lookup_filter_id("INDUSTRY", value, _INDUSTRY_ID_BY_NAME)
        if not industry_id:
            known_catalog = _norm(value) in _load_salesnav_filter_catalog_options().get("industry", set())
            reason = "known_industry_missing_id_mapping" if known_catalog else "unmapped_industry_id"
            return None, None, {"filter": "industry", "value": raw_value, "reason": reason}
        parts.append(f"(id:{industry_id},text:{_encode_text(value)},selectionType:INCLUDED)")
        resolved.append({"id": industry_id, "text": value})
        normalized_values.append(value)
    clause = f"(type:INDUSTRY,values:List({','.join(parts)}))"
    return clause, {"value": normalized_values, "applied": True, "resolved": resolved, "source": "url_query"}, None


def _build_headcount_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    values = _as_string_list(raw)
    if not values:
        return None, None, None
    parts: list[str] = []
    resolved: list[dict[str, str]] = []
    for value in values:
        bucket_id = _COMPANY_HEADCOUNT_ID_BY_LABEL.get(_norm(value).replace(" ", ""))
        if not bucket_id:
            bucket_id = _lookup_filter_id("COMPANY_HEADCOUNT", value, _COMPANY_HEADCOUNT_ID_BY_LABEL)
        if not bucket_id:
            return None, None, {"filter": "company_headcount", "value": value, "reason": "unmapped_headcount_bucket"}
        parts.append(f"(id:{bucket_id},text:{_encode_text(value)},selectionType:INCLUDED)")
        resolved.append({"id": bucket_id, "text": value})
    clause = f"(type:COMPANY_HEADCOUNT,values:List({','.join(parts)}))"
    return clause, {"value": values, "applied": True, "resolved": resolved, "source": "url_query"}, None


def _build_fortune_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    ids = _FORTUNE_ID_BY_LABEL.get(_norm(value))
    if not ids:
        return None, None, {"filter": "fortune", "value": value, "reason": "unmapped_fortune_bucket"}
    id_to_text = {
        "1": "Fortune 50",
        "2": "Fortune 51-100",
        "3": "Fortune 101-250",
        "4": "Fortune 251-500",
    }
    parts = [f"(id:{i},text:{_encode_text(id_to_text[i])},selectionType:INCLUDED)" for i in ids]
    clause = f"(type:FORTUNE,values:List({','.join(parts)}))"
    return clause, {"value": value, "applied": True, "resolved": [{"id": i} for i in ids], "source": "url_query"}, None


def _build_region_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    values = _as_string_list(raw)
    if not values:
        return None, None, None
    parts: list[str] = []
    resolved: list[dict[str, str]] = []
    for value in values:
        region_value = value
        region_id = _lookup_filter_id("REGION", region_value, _REGION_ID_BY_NAME)
        if not region_id and "," in region_value:
            # Many prompts resolve to state-level strings like "California, United States".
            # If REGION mapping is unavailable, degrade gracefully to country-level "United States"
            # so URL-building still succeeds and navigation can start.
            tail = region_value.split(",")[-1].strip().lower()
            if tail in {"united states", "usa", "u.s.", "u.s.a"}:
                region_value = "United States"
                region_id = _lookup_filter_id("REGION", region_value, _REGION_ID_BY_NAME)
        if not region_id:
            return None, None, {"filter": "headquarters_location", "value": value, "reason": "unmapped_region_id"}
        parts.append(f"(id:{region_id},text:{_encode_text(region_value)},selectionType:INCLUDED)")
        resolved.append({"id": region_id, "text": region_value})
    clause = f"(type:REGION,values:List({','.join(parts)}))"
    normalized_values = [item.get("text", "") for item in resolved]
    return clause, {"value": normalized_values, "applied": True, "resolved": resolved, "source": "url_query"}, None


def _build_followers_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    followers_id = _FOLLOWER_ID_BY_LABEL.get(_norm(value))
    if not followers_id:
        followers_id = _lookup_filter_id("NUM_OF_FOLLOWERS", value, _FOLLOWER_ID_BY_LABEL)
    if not followers_id:
        return None, None, {"filter": "number_of_followers", "value": value, "reason": "unmapped_followers_bucket"}
    clause = f"(type:NUM_OF_FOLLOWERS,values:List((id:{followers_id},text:{_encode_text(value)},selectionType:INCLUDED)))"
    return clause, {"value": value, "applied": True, "resolved": [{"id": followers_id}], "source": "url_query"}, None


def _build_job_opportunities_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    option_id = _JOB_OPPORTUNITIES_ID_BY_LABEL.get(_norm(value))
    if not option_id:
        option_id = _lookup_filter_id("JOB_OPPORTUNITIES", value, _JOB_OPPORTUNITIES_ID_BY_LABEL)
    if not option_id:
        return None, None, {"filter": "job_opportunities", "value": value, "reason": "unmapped_job_opportunities_option"}
    clause = f"(type:JOB_OPPORTUNITIES,values:List((id:{option_id},text:{_encode_text('Hiring on Linkedin')},selectionType:INCLUDED)))"
    return clause, {"value": value, "applied": True, "resolved": [{"id": option_id}], "source": "url_query"}, None


def _build_recent_activities_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    option_id = _ACCOUNT_ACTIVITIES_ID_BY_LABEL.get(_norm(value))
    if not option_id:
        option_id = _lookup_filter_id("ACCOUNT_ACTIVITIES", value, _ACCOUNT_ACTIVITIES_ID_BY_LABEL)
    if not option_id:
        return None, None, {"filter": "recent_activities", "value": value, "reason": "unmapped_account_activities_option"}
    clause = (
        f"(type:ACCOUNT_ACTIVITIES,values:List((id:{option_id},"
        f"text:{_encode_text('Senior leadership changes in last 3 months')},selectionType:INCLUDED)))"
    )
    return clause, {"value": value, "applied": True, "resolved": [{"id": option_id}], "source": "url_query"}, None


def _build_connection_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    option_id = _RELATIONSHIP_ID_BY_LABEL.get(_norm(value))
    if not option_id:
        option_id = _lookup_filter_id("RELATIONSHIP", value, _RELATIONSHIP_ID_BY_LABEL)
    if not option_id:
        return None, None, {"filter": "connection", "value": value, "reason": "unmapped_relationship_option"}
    clause = f"(type:RELATIONSHIP,values:List((id:{option_id},text:{_encode_text('1st Degree Connections')},selectionType:INCLUDED)))"
    return clause, {"value": value, "applied": True, "resolved": [{"id": option_id}], "source": "url_query"}, None


def _as_id_list(raw: Any) -> list[str]:
    out: list[str] = []
    for item in _as_string_list(raw):
        cleaned = _clean(item)
        if cleaned:
            out.append(cleaned)
    return out


def _extract_org_id_from_sales_company_url(raw: Any) -> str | None:
    text = _clean(raw)
    if not text:
        return None
    m = re.search(r"/sales/company/(\d+)", text)
    if not m:
        return None
    return m.group(1)


def _normalize_company_urn(raw: Any) -> str | None:
    text = _clean(raw)
    if not text:
        return None
    value = text
    # Best effort decode for pre-encoded URNs.
    for _ in range(2):
        decoded = unquote(value)
        if decoded == value:
            break
        value = decoded
    if re.fullmatch(r"\d+", value):
        return f"urn:li:organization:{value}"
    m = re.search(r"urn:li:organization:(\d+)", value)
    if m:
        return f"urn:li:organization:{m.group(1)}"
    return None


def _coerce_current_company_entries(filters: dict[str, Any]) -> list[dict[str, str]]:
    raw_name = filters.get("current_company")
    raw_urn = filters.get("current_company_urn")
    raw_sales = filters.get("current_company_sales_nav_url")
    names = _as_string_list(raw_name)
    urns = _as_id_list(raw_urn)
    sales_urls = _as_string_list(raw_sales)
    max_len = max(len(names), len(urns), len(sales_urls), 0)
    if max_len == 0:
        return []

    entries: list[dict[str, str]] = []
    for i in range(max_len):
        name = names[i] if i < len(names) else (names[0] if len(names) == 1 else "")
        urn_raw = urns[i] if i < len(urns) else (urns[0] if len(urns) == 1 else "")
        sales_url = sales_urls[i] if i < len(sales_urls) else (sales_urls[0] if len(sales_urls) == 1 else "")

        urn = _normalize_company_urn(urn_raw)
        if not urn:
            org_id = _extract_org_id_from_sales_company_url(sales_url)
            if org_id:
                urn = f"urn:li:organization:{org_id}"
        if not urn:
            # Some callers may put an ID or URN in current_company directly.
            urn = _normalize_company_urn(name)

        if not name:
            # Never use the URN as display text.
            name = ""
        entries.append({"name": _clean(name), "urn": _clean(urn or "")})

    return entries


def _build_people_current_company_clause(filters: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    entries = _coerce_current_company_entries(filters)
    if not entries:
        return None, None, None
    parts: list[str] = []
    resolved: list[dict[str, str]] = []
    for item in entries:
        name = _clean(item.get("name"))
        urn = _normalize_company_urn(item.get("urn"))
        if not name or not urn:
            return None, None, {"filter": "current_company", "value": name or "", "reason": "missing_current_company_identity"}
        parts.append(
            f"(id:{_encode_text(urn)},text:{_encode_text(name)},selectionType:INCLUDED,parent:(id:0))"
        )
        resolved.append({"name": name, "urn": urn})
    clause = f"(type:CURRENT_COMPANY,values:List({','.join(parts)}))"
    return clause, {"value": [x.get("name") for x in resolved], "applied": True, "resolved": resolved, "source": "url_query"}, None


def _build_people_function_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    values = _as_string_list(raw)
    if not values:
        return None, None, None
    parts: list[str] = []
    resolved: list[dict[str, str]] = []
    for value in values:
        function_id = _PEOPLE_FUNCTION_ID_BY_LABEL.get(_norm(value))
        if not function_id:
            return None, None, {"filter": "function", "value": value, "reason": "unmapped_function_id"}
        parts.append(f"(id:{function_id},text:{_encode_text(value)},selectionType:INCLUDED)")
        resolved.append({"id": function_id, "text": value})
    clause = f"(type:FUNCTION,values:List({','.join(parts)}))"
    return clause, {"value": values, "applied": True, "resolved": resolved, "source": "url_query"}, None


def _build_people_seniority_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    values = _as_string_list(raw)
    if not values:
        return None, None, None
    parts: list[str] = []
    resolved: list[dict[str, str]] = []
    for value in values:
        seniority_id = _PEOPLE_SENIORITY_ID_BY_LABEL.get(_norm(value))
        if not seniority_id:
            return None, None, {"filter": "seniority_level", "value": value, "reason": "unmapped_seniority_level_id"}
        parts.append(f"(id:{seniority_id},text:{_encode_text(value)},selectionType:INCLUDED)")
        resolved.append({"id": seniority_id, "text": value})
    clause = f"(type:SENIORITY_LEVEL,values:List({','.join(parts)}))"
    return clause, {"value": values, "applied": True, "resolved": resolved, "source": "url_query"}, None


def _build_people_region_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    values = _as_string_list(raw)
    if not values:
        return None, None, None
    normalized_values: list[str] = []
    for value in values:
        low = _norm(value)
        if low in {"united states", "us", "u.s.", "usa", "u.s.a"}:
            normalized_values.append("United States")
        else:
            return None, None, {"filter": "headquarters_location", "value": value, "reason": "people_region_unsupported_v1"}
    return _build_region_clause(normalized_values)


def _build_growth_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    parsed = _parse_int_range(value)
    if not parsed:
        return None, None, {"filter": "company_headcount_growth", "value": value, "reason": "expected_numeric_percent_range"}
    mn, mx = parsed
    clause = f"(type:COMPANY_HEADCOUNT_GROWTH,rangeValue:(min:{mn},max:{mx}))"
    return clause, {"value": value, "applied": True, "resolved": [{"min": mn, "max": mx}], "source": "url_query"}, None


def _build_annual_revenue_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    parsed = _parse_annual_revenue_range(value)
    if not parsed:
        return None, None, {"filter": "annual_revenue", "value": value, "reason": "expected_numeric_millions_range"}
    mn, mx = parsed
    clause = (
        f"(type:ANNUAL_REVENUE,rangeValue:(min:{_format_query_number(mn)},max:{_format_query_number(mx)}),"
        f"selectedSubFilter:USD)"
    )
    return clause, {"value": value, "applied": True, "resolved": [{"min": mn, "max": mx, "currency": "USD"}], "source": "url_query"}, None


def _parse_department_range(value: str) -> tuple[int, int, int] | None:
    text = _clean(value)
    match = re.match(r"^(.+?)\s+(\d+)\s*-\s*(\d+)\s*%?$", text)
    if not match:
        return None
    department = _norm(match.group(1))
    dept_id = _DEPARTMENT_ID_BY_NAME.get(department)
    if not dept_id:
        return None
    return dept_id, int(match.group(2)), int(match.group(3))


def _build_department_headcount_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    parsed = _parse_department_range(value)
    if not parsed:
        return None, None, {"filter": "department_headcount", "value": value, "reason": "expected_<department>_<min>-<max>_format"}
    dept_id, mn, mx = parsed
    clause = f"(type:DEPARTMENT_HEADCOUNT,rangeValue:(min:{mn},max:{mx}),selectedSubFilter:{dept_id})"
    return clause, {"value": value, "applied": True, "resolved": [{"department_id": dept_id, "min": mn, "max": mx}], "source": "url_query"}, None


def _build_department_growth_clause(raw: Any) -> tuple[str | None, dict[str, Any] | None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    parsed = _parse_department_range(value)
    if not parsed:
        return None, None, {"filter": "department_headcount_growth", "value": value, "reason": "expected_<department>_<min>-<max>%_format"}
    dept_id, mn, mx = parsed
    clause = f"(type:DEPARTMENT_HEADCOUNT_GROWTH,rangeValue:(min:{mn},max:{mx}),selectedSubFilter:{dept_id})"
    return clause, {"value": value, "applied": True, "resolved": [{"department_id": dept_id, "min": mn, "max": mx}], "source": "url_query"}, None


def _unsupported_toggle(name: str, raw: Any) -> tuple[None, None, dict[str, str] | None]:
    value = _clean(raw)
    if not value:
        return None, None, None
    return None, None, {"filter": name, "value": value, "reason": "url_mapping_not_available"}


def build_salesnav_account_search_url(
    *,
    keyword: str | None,
    filters: dict[str, Any] | None,
) -> SalesNavQueryBuildResult:
    clause_builders: dict[str, Any] = {
        "industry": _build_industry_clause,
        "headquarters_location": _build_region_clause,
        "company_headcount": _build_headcount_clause,
        "annual_revenue": _build_annual_revenue_clause,
        "company_headcount_growth": _build_growth_clause,
        "fortune": _build_fortune_clause,
        "number_of_followers": _build_followers_clause,
        "department_headcount": _build_department_headcount_clause,
        "department_headcount_growth": _build_department_growth_clause,
        "job_opportunities": _build_job_opportunities_clause,
        "recent_activities": _build_recent_activities_clause,
        "connection": _build_connection_clause,
        "companies_in_crm": lambda v: _unsupported_toggle("companies_in_crm", v),
        "saved_accounts": lambda v: _unsupported_toggle("saved_accounts", v),
        "account_lists": lambda v: _unsupported_toggle("account_lists", v),
    }

    applied_filters: dict[str, dict[str, Any]] = {}
    unmapped_filters: list[dict[str, str]] = []
    filter_clauses: list[str] = []
    safe_filters = filters if isinstance(filters, dict) else {}

    for name, raw in safe_filters.items():
        key = _norm(name)
        builder = clause_builders.get(key)
        if not builder:
            value = _clean(raw)
            if value:
                unmapped_filters.append({"filter": key or str(name), "value": value, "reason": "unsupported_filter_name"})
            continue
        clause, meta, err = builder(raw)
        if err:
            unmapped_filters.append(err)
            continue
        if clause and meta:
            filter_clauses.append(clause)
            applied_filters[key] = meta

    if unmapped_filters:
        raise SalesNavQueryBuildError(unmapped_filters)

    keyword_value = _clean(keyword)
    query_parts: list[str] = []
    if keyword_value:
        query_parts.append("spellCorrectionEnabled:true")
        query_parts.append(f"keywords:{keyword_value}")
    if filter_clauses:
        query_parts.append(f"filters:List({','.join(filter_clauses)})")

    if query_parts:
        query_body = f"({','.join(query_parts)})"
        url = f"{BASE_ACCOUNT_SEARCH_URL}?query={quote(query_body, safe='')}&viewAllFilters=true"
    else:
        query_body = ""
        url = f"{BASE_ACCOUNT_SEARCH_URL}?viewAllFilters=true"

    return SalesNavQueryBuildResult(
        url=url,
        query=query_body,
        applied_filters=applied_filters,
        unmapped_filters=unmapped_filters,
    )


def build_salesnav_people_search_url(
    *,
    keyword: str | None,
    filters: dict[str, Any] | None,
) -> SalesNavQueryBuildResult:
    safe_filters = filters if isinstance(filters, dict) else {}
    clause_builders: dict[str, Any] = {
        "current_company": lambda _v: _build_people_current_company_clause(safe_filters),
        "function": _build_people_function_clause,
        "seniority_level": _build_people_seniority_clause,
        "industry": _build_industry_clause,
        "company_headcount": _build_headcount_clause,
        "annual_revenue": _build_annual_revenue_clause,
        "headquarters_location": _build_people_region_clause,
    }

    applied_filters: dict[str, dict[str, Any]] = {}
    unmapped_filters: list[dict[str, str]] = []
    filter_clauses: list[str] = []
    processed: set[str] = set()

    for name, raw in safe_filters.items():
        key = _norm(name)
        if key in {"current_company_urn", "current_company_sales_nav_url"}:
            continue
        if key in processed:
            continue
        builder = clause_builders.get(key)
        if not builder:
            value = _clean(raw)
            if value:
                unmapped_filters.append({"filter": key or str(name), "value": value, "reason": "unsupported_filter_name"})
            continue
        clause, meta, err = builder(raw)
        processed.add(key)
        if err:
            unmapped_filters.append(err)
            continue
        if clause and meta:
            filter_clauses.append(clause)
            applied_filters[key] = meta

    if unmapped_filters:
        raise SalesNavQueryBuildError(unmapped_filters)

    keyword_value = _clean(keyword)
    query_parts: list[str] = ["recentSearchParam:(doLogHistory:true)"]
    if filter_clauses:
        query_parts.append(f"filters:List({','.join(filter_clauses)})")
    if keyword_value:
        query_parts.append(f"keywords:{keyword_value}")

    query_body = f"({','.join(query_parts)})"
    url = f"{BASE_PEOPLE_SEARCH_URL}?query={quote(query_body, safe='')}&viewAllFilters=true"
    return SalesNavQueryBuildResult(
        url=url,
        query=query_body,
        applied_filters=applied_filters,
        unmapped_filters=unmapped_filters,
    )
