"""Shared helpers for Sales Navigator route modules."""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import quote

from api.routes.browser_stream import broadcast_event, set_active_browser_page


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def to_absolute_linkedin_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    normalized = url.strip()
    if not normalized:
        return None
    if normalized.startswith("http://") or normalized.startswith("https://"):
        return normalized
    if normalized.startswith("/"):
        return f"https://www.linkedin.com{normalized}"
    if normalized.startswith("www.linkedin.com/") or normalized.startswith("linkedin.com/"):
        return f"https://{normalized}"
    return normalized


def people_search_url(keyword: str) -> str:
    return f"https://www.linkedin.com/sales/search/people?query=(keywords%3A{quote(keyword)})"


@asynccontextmanager
async def automation_scope(action: str, payload: Optional[dict] = None):
    """Broadcast start/stop events and clear viewer page reference."""
    await broadcast_event("browser_automation_start", payload or {"action": action})
    try:
        yield
    finally:
        set_active_browser_page(None)
        await broadcast_event("browser_automation_stop", {"action": action})
