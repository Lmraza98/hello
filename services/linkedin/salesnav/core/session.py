"""Session/auth checks for Sales Navigator."""

from __future__ import annotations

from urllib.parse import urlparse
from typing import Any


def is_salesnav_host(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    return host.endswith("linkedin.com")


def is_salesnav_authenticated_url(url: str) -> bool:
    """True when URL is on linkedin.com/sales/* and not auth/login/checkpoint."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    path = (parsed.path or "").lower()
    if not host.endswith("linkedin.com"):
        return False
    if not path.startswith("/sales/"):
        return False
    blocked_markers = ("/sales/login", "checkpoint", "authwall", "/login")
    return not any(marker in f"{path}?{parsed.query}".lower() for marker in blocked_markers)


class SalesNavSessionManager:
    """Session/auth helper facade used by the scraper class."""

    def __init__(self, scraper: Any):
        self.scraper = scraper

    def is_authenticated_url(self, url: str) -> bool:
        return is_salesnav_authenticated_url(url)

