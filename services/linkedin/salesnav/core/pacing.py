"""Small pacing helpers for load smoothing and stability."""

from __future__ import annotations

import asyncio
import random

import config


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


async def pacing_delay(
    base_seconds: float | None = None,
    variance_seconds: float | None = None,
    *,
    min_seconds: float | None = None,
    max_seconds: float | None = None,
) -> float:
    """
    Sleep with bounded jitter to avoid bursty automation behavior.
    Returns the effective delay (seconds) for optional logging.
    """
    base = config.SALESNAV_PACING_BASE_SECONDS if base_seconds is None else float(base_seconds)
    variance = config.SALESNAV_PACING_VARIANCE_SECONDS if variance_seconds is None else float(variance_seconds)
    lower = config.SALESNAV_PACING_MIN_SECONDS if min_seconds is None else float(min_seconds)
    upper = config.SALESNAV_PACING_MAX_SECONDS if max_seconds is None else float(max_seconds)
    sampled = random.gauss(base, max(0.0, variance))
    delay = _clamp(sampled, lower, upper)
    await asyncio.sleep(delay)
    return delay


async def pacing_backoff(attempt: int, *, base_seconds: float = 0.6, cap_seconds: float = 8.0) -> float:
    """
    Exponential backoff with jitter for transient failures/retries.
    """
    effective_attempt = max(0, int(attempt))
    target = min(cap_seconds, base_seconds * (2**effective_attempt))
    variance = max(0.05, target * 0.25)
    return await pacing_delay(target, variance, min_seconds=0.1, max_seconds=cap_seconds)
