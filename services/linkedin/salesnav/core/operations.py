"""Operation wrapper with retries and debug capture."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable


_RETRYABLE_MARKERS = (
    "timeout",
    "detached",
    "navigation",
    "target closed",
    "execution context was destroyed",
)


def _is_retryable_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in _RETRYABLE_MARKERS)


async def run_operation_with_retries(
    *,
    op_name: str,
    fn: Callable[[], Awaitable[Any]],
    retries: int = 2,
    retry_wait_seconds: float = 0.8,
    debug: Any | None = None,
    debug_context: dict[str, Any] | None = None,
) -> Any:
    last_exc: Exception | None = None
    attempts = max(1, int(retries) + 1)
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except Exception as exc:
            last_exc = exc
            if attempt >= attempts or not _is_retryable_error(exc):
                break
            await asyncio.sleep(max(0.1, retry_wait_seconds))

    if debug is not None:
        try:
            await debug.capture(op_name, context={"attempts": attempts, **(debug_context or {})})
        except Exception:
            pass
    raise last_exc if last_exc is not None else RuntimeError(f"Operation failed: {op_name}")

