"""
Centralized web search helpers.

Currently supports Tavily. This module exists to:
- standardize API key lookup
- standardize timeouts / error shape
- centralize logging and future rate limiting
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_TAVILY_URL = os.getenv("TAVILY_URL", "https://api.tavily.com/search")
_DEFAULT_TIMEOUT_SECONDS = float(os.getenv("TAVILY_TIMEOUT_SECONDS", "20"))
_DEFAULT_MAX_RESULTS = int(os.getenv("TAVILY_DEFAULT_MAX_RESULTS", "5"))


def _get_tavily_api_key() -> str:
    """Best-effort key lookup without hard dependency on config."""
    key = os.getenv("TAVILY_API_KEY", "") or os.getenv("TAVILY_KEY", "")
    if key:
        return key
    try:
        import config  # local project module

        return getattr(config, "TAVILY_API_KEY", "") or ""
    except Exception:
        return ""


def _clamp_max_results(max_results: int) -> int:
    try:
        mr = int(max_results)
    except Exception:
        mr = _DEFAULT_MAX_RESULTS
    # Tavily is typically used with small result sets; keep it bounded.
    return max(1, min(mr, 20))


def _shape_success(query: str, include_answer: bool, data: Dict[str, Any], max_results: int) -> Dict[str, Any]:
    raw_results = data.get("results") or []
    results: List[Dict[str, Any]] = []
    for r in list(raw_results)[:max_results]:
        if not isinstance(r, dict):
            continue
        results.append(
            {
                "title": (r.get("title") or "") if isinstance(r.get("title"), str) else "",
                "url": (r.get("url") or "") if isinstance(r.get("url"), str) else "",
                # Keep payload small / consistent across call sites.
                "content": ((r.get("content") or "") if isinstance(r.get("content"), str) else "")[:500],
            }
        )

    shaped: Dict[str, Any] = {
        "provider": "tavily",
        "query": query,
        "results": results,
    }
    # Keep response shape stable across call sites (answer is always present).
    shaped["answer"] = data.get("answer") if include_answer else None
    return shaped


def _shape_error(query: str, message: str) -> Dict[str, Any]:
    return {
        "provider": "tavily",
        "query": query,
        "answer": None,
        "results": [],
        "error": message,
    }


async def tavily_search(
    query: str,
    max_results: int,
    include_answer: bool = True,
    search_depth: str = "basic",
) -> Dict[str, Any]:
    """
    Tavily search (async).

    Returns a standardized dict:
    - on success: {provider, query, answer?, results}
    - on error:   {provider, query, answer: None, results: [], error: "..."}
    """
    api_key = _get_tavily_api_key()
    if not api_key:
        return _shape_error(query, "TAVILY_API_KEY not configured")

    max_results = _clamp_max_results(max_results)

    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": search_depth,
        "max_results": max_results,
        "include_answer": include_answer,
    }

    timeout = httpx.Timeout(_DEFAULT_TIMEOUT_SECONDS)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(_TAVILY_URL, json=payload)
        if resp.status_code >= 400:
            logger.warning("Tavily HTTP %s for query=%r", resp.status_code, query)
            return _shape_error(query, f"Tavily HTTP {resp.status_code}")
        data = resp.json()
        if not isinstance(data, dict):
            return _shape_error(query, "Tavily returned non-JSON response")
        return _shape_success(query, include_answer, data, max_results)
    except httpx.TimeoutException:
        return _shape_error(query, "Tavily request timed out")
    except Exception as e:
        logger.exception("Tavily search failed for query=%r", query)
        return _shape_error(query, str(e))


def tavily_search_sync(
    query: str,
    max_results: int,
    include_answer: bool = True,
    search_depth: str = "basic",
) -> Dict[str, Any]:
    """
    Tavily search (sync). Same standardized response as `tavily_search`.

    Useful for threadpool / non-async contexts.
    """
    api_key = _get_tavily_api_key()
    if not api_key:
        return _shape_error(query, "TAVILY_API_KEY not configured")

    max_results = _clamp_max_results(max_results)

    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": search_depth,
        "max_results": max_results,
        "include_answer": include_answer,
    }

    timeout = httpx.Timeout(_DEFAULT_TIMEOUT_SECONDS)
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(_TAVILY_URL, json=payload)
        if resp.status_code >= 400:
            logger.warning("Tavily HTTP %s for query=%r", resp.status_code, query)
            return _shape_error(query, f"Tavily HTTP {resp.status_code}")
        data = resp.json()
        if not isinstance(data, dict):
            return _shape_error(query, "Tavily returned non-JSON response")
        return _shape_success(query, include_answer, data, max_results)
    except httpx.TimeoutException:
        return _shape_error(query, "Tavily request timed out")
    except Exception as e:
        logger.exception("Tavily search failed for query=%r", query)
        return _shape_error(query, str(e))

