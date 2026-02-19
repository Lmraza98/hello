from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException

from services.web_automation.browser.backends.base import BrowserBackend


GATEWAY_TIMEOUT_SECONDS = 45
PROXY_BASE_DEFAULT = "http://127.0.0.1:9223"


def _proxy_base_url() -> str:
    raw = (os.getenv("BROWSER_GATEWAY_BASE_URL") or PROXY_BASE_DEFAULT).strip()
    return raw.rstrip("/")


async def _proxy_request(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    base = _proxy_base_url()
    url = f"{base}/{path.lstrip('/')}"
    timeout = httpx.Timeout(GATEWAY_TIMEOUT_SECONDS, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(method, url, json=payload)
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "browser_gateway_unreachable",
                "message": f"Browser gateway is not reachable at {base}",
            },
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "browser_gateway_error", "message": str(exc)},
        ) from exc

    if response.status_code >= 400:
        detail: Any
        try:
            detail = response.json()
        except ValueError:
            detail = {"message": response.text}
        raise HTTPException(
            status_code=response.status_code,
            detail={
                "code": "browser_gateway_request_failed",
                "message": "Browser gateway request failed",
                "details": detail,
            },
        )
    content_type = (response.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        return response.json()
    return {"ok": True, "raw": response.text}


class ProxyBackend(BrowserBackend):
    async def health(self) -> dict[str, Any]:
        out = await _proxy_request("GET", "/health")
        if isinstance(out, dict):
            out.setdefault("mode", "proxy")
        return out

    async def tabs(self) -> dict[str, Any]:
        out = await _proxy_request("GET", "/tabs")
        return out if isinstance(out, dict) else {"tabs": [], "active_tab_id": None, "mode": "proxy"}

    async def navigate(
        self,
        *,
        url: str,
        tab_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"url": url}
        if tab_id:
            payload["tab_id"] = tab_id
        if timeout_ms is not None:
            payload["timeout_ms"] = int(timeout_ms)
        out = await _proxy_request("POST", "/navigate", payload)
        return out if isinstance(out, dict) else {"ok": True, "tab_id": tab_id, "url": url, "mode": "proxy"}

    async def snapshot(self, *, tab_id: str | None = None, mode: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if tab_id:
            payload["tab_id"] = tab_id
        if mode:
            payload["mode"] = mode
        out = await _proxy_request("POST", "/snapshot", payload or None)
        return out if isinstance(out, dict) else {"ok": False, "tab_id": tab_id, "mode": mode or "role", "refs": []}

    async def find_ref(
        self,
        *,
        text: str,
        role: str | None = None,
        tab_id: str | None = None,
        timeout_ms: int = 8000,
        poll_ms: int = 400,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"text": text}
        if role:
            payload["role"] = role
        if tab_id:
            payload["tab_id"] = tab_id
        payload["timeout_ms"] = timeout_ms
        payload["poll_ms"] = poll_ms
        out = await _proxy_request("POST", "/find_ref", payload)
        return out if isinstance(out, dict) else {"ok": False, "tab_id": tab_id, "error": True}

    async def act(
        self,
        *,
        action: str,
        ref: str | int | None = None,
        value: str | None = None,
        tab_id: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"action": action}
        if ref is not None:
            payload["ref"] = ref
        if value is not None:
            payload["value"] = value
        if tab_id:
            payload["tab_id"] = tab_id
        out = await _proxy_request("POST", "/act", payload)
        return out if isinstance(out, dict) else {"ok": False, "tab_id": tab_id, "error": True}

    async def wait(self, *, ms: int, tab_id: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"ms": ms}
        if tab_id:
            payload["tab_id"] = tab_id
        out = await _proxy_request("POST", "/wait", payload)
        return out if isinstance(out, dict) else {"ok": True, "tab_id": tab_id, "waited_ms": ms}

    async def screenshot(
        self,
        *,
        tab_id: str | None = None,
        full_page: bool | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if tab_id:
            payload["tab_id"] = tab_id
        if full_page is not None:
            payload["full_page"] = full_page
        out = await _proxy_request("POST", "/screenshot", payload or None)
        return out if isinstance(out, dict) else {"ok": False, "tab_id": tab_id, "error": True}
