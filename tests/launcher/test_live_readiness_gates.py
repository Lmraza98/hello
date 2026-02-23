from __future__ import annotations

import os
import urllib.error
import urllib.request

import pytest


def _base_url() -> str:
    return os.getenv("WORKFLOW_BUILDER_LIVE_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def _assert_http_ok(path: str, timeout: float = 10.0) -> None:
    url = f"{_base_url()}{path}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            status = int(getattr(response, "status", 0) or 0)
    except urllib.error.URLError as exc:
        raise AssertionError(f"live readiness check failed for {url}: {exc}") from exc
    assert 200 <= status < 300, f"unexpected status {status} for {url}"


@pytest.mark.live
def test_gate_backend_api_ready() -> None:
    _assert_http_ok("/api/stats", timeout=10.0)


@pytest.mark.live
def test_gate_bridge_ready() -> None:
    _assert_http_ok("/api/browser/tabs", timeout=15.0)

