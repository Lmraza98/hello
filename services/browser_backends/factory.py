from __future__ import annotations

import os
from typing import Any

from services.browser_backends.base import BrowserBackend


_backend_singleton: BrowserBackend | None = None


def get_browser_backend() -> BrowserBackend:
    global _backend_singleton
    if _backend_singleton is not None:
        return _backend_singleton

    mode = (os.getenv("BROWSER_GATEWAY_MODE", "") or "").strip().lower()
    if mode == "proxy":
        from services.browser_backends.proxy import ProxyBackend

        _backend_singleton = ProxyBackend()
        return _backend_singleton

    if mode == "openclaw":
        from services.browser_backends.openclaw import OpenClawBackend

        _backend_singleton = OpenClawBackend()
        return _backend_singleton

    if mode == "camoufox":
        from services.browser_backends.camoufox import CamoufoxBackend

        _backend_singleton = CamoufoxBackend()
        return _backend_singleton

    from services.browser_backends.local_playwright import LocalPlaywrightBackend

    _backend_singleton = LocalPlaywrightBackend()
    return _backend_singleton


def reset_browser_backend_for_tests() -> None:
    global _backend_singleton
    _backend_singleton = None
