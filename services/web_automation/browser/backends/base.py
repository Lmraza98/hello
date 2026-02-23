from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BrowserBackend(ABC):
    """Backend interface for browser_nav primitives.

    Backends must preserve the public API contract expected by `api/routes/browser_nav.py`.
    """

    @abstractmethod
    async def health(self) -> dict[str, Any]: ...

    @abstractmethod
    async def tabs(self) -> dict[str, Any]: ...

    @abstractmethod
    async def navigate(
        self,
        *,
        url: str,
        tab_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]: ...

    @abstractmethod
    async def snapshot(self, *, tab_id: str | None = None, mode: str | None = None) -> dict[str, Any]: ...

    @abstractmethod
    async def find_ref(
        self,
        *,
        text: str,
        role: str | None = None,
        tab_id: str | None = None,
        timeout_ms: int = 8000,
        poll_ms: int = 400,
    ) -> dict[str, Any]: ...

    @abstractmethod
    async def act(
        self,
        *,
        action: str,
        ref: str | int | None = None,
        value: str | None = None,
        tab_id: str | None = None,
    ) -> dict[str, Any]: ...

    @abstractmethod
    async def wait(self, *, ms: int, tab_id: str | None = None) -> dict[str, Any]: ...

    @abstractmethod
    async def screenshot(
        self,
        *,
        tab_id: str | None = None,
        full_page: bool | None = None,
    ) -> dict[str, Any]: ...

    @abstractmethod
    async def shutdown(self) -> dict[str, Any]: ...
