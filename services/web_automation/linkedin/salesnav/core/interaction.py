"""Low-level browser interaction helpers for reliability and load smoothing.

These utilities use Playwright mouse APIs directly and are intended for
deterministic interaction quality (visibility, movement, scroll readiness),
not behavioral simulation/evasion.
"""

from __future__ import annotations

import asyncio
import math
import random
from typing import Tuple

from playwright.async_api import Locator, Page

# Last known pointer position keyed by page identity.
_mouse_pos: dict[int, Tuple[float, float]] = {}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _viewport_center(page: Page) -> tuple[float, float]:
    viewport = page.viewport_size or {"width": 1920, "height": 1080}
    return float(viewport["width"]) / 2.0, float(viewport["height"]) / 2.0


async def wait_with_jitter(base_s: float = 0.6, variance: float = 0.2) -> float:
    """Wait with bounded gaussian jitter to smooth automation load patterns."""
    sampled = random.gauss(float(base_s), max(0.0, float(variance)))
    delay = _clamp(sampled, 0.05, 12.0)
    await asyncio.sleep(delay)
    return delay


async def _move_to_point(page: Page, x: float, y: float) -> tuple[float, float]:
    """Move pointer to an absolute point with distance-based stepping."""
    pid = id(page)
    start_x, start_y = _mouse_pos.get(pid, _viewport_center(page))
    distance = math.hypot(x - start_x, y - start_y)
    steps = int(_clamp(distance / 75.0, 4.0, 24.0))
    await page.mouse.move(x, y, steps=steps)
    _mouse_pos[pid] = (x, y)
    await wait_with_jitter(0.06, 0.03)
    return x, y


async def move_to_element(page: Page, locator: Locator) -> tuple[float, float]:
    """Move pointer to the center of a visible element with distance-based steps."""
    await locator.first.wait_for(state="visible", timeout=8_000)
    box = await locator.first.bounding_box()
    if not box:
        raise RuntimeError("Element has no bounding box for pointer movement.")

    target_x = float(box["x"]) + float(box["width"]) / 2.0
    target_y = float(box["y"]) + float(box["height"]) / 2.0

    return await _move_to_point(page, target_x, target_y)


async def click_locator(page: Page, locator: Locator) -> None:
    """Move to a locator and click at an in-bounds point using mouse APIs."""
    await locator.first.wait_for(state="visible", timeout=8_000)
    box = await locator.first.bounding_box()
    if not box:
        raise RuntimeError("Element has no bounding box for click.")

    # Avoid fragile center/edge clicks by targeting a stable inner area.
    x = float(box["x"]) + random.uniform(float(box["width"]) * 0.15, float(box["width"]) * 0.85)
    y = float(box["y"]) + random.uniform(float(box["height"]) * 0.15, float(box["height"]) * 0.85)
    await _move_to_point(page, x, y)
    await wait_with_jitter(0.05, 0.02)
    await page.mouse.click(x, y)
    _mouse_pos[id(page)] = (x, y)


async def wheel_scroll(page: Page, delta_y: int) -> int:
    """Scroll by wheel in fixed-size increments with short jittered pauses."""
    remaining = int(delta_y)
    if remaining == 0:
        return 0

    direction = 1 if remaining > 0 else -1
    remaining_abs = abs(remaining)
    scrolled = 0
    chunk = 120

    while remaining_abs > 0:
        step = min(chunk, remaining_abs)
        dy = direction * step
        await page.mouse.wheel(0, dy)
        remaining_abs -= step
        scrolled += dy
        await wait_with_jitter(0.035, 0.015)
    return scrolled


async def scroll_into_view(page: Page, locator: Locator) -> None:
    """Bring a locator into view using wheel scrolling and a final DOM fallback."""
    await locator.first.wait_for(state="attached", timeout=8_000)
    box = await locator.first.bounding_box()
    if not box:
        await locator.first.scroll_into_view_if_needed(timeout=8_000)
        return

    viewport = page.viewport_size or {"width": 1920, "height": 1080}
    vh = float(viewport["height"])
    top = float(box["y"])
    bottom = top + float(box["height"])
    margin_top = vh * 0.15
    margin_bottom = vh * 0.85

    if bottom > margin_bottom:
        target_delta = int(bottom - (vh * 0.6))
        await wheel_scroll(page, target_delta)
        await wait_with_jitter(0.10, 0.04)
    elif top < margin_top:
        target_delta = -int((vh * 0.35) - top)
        await wheel_scroll(page, target_delta)
        await wait_with_jitter(0.10, 0.04)

    # Final deterministic fallback ensures visibility.
    await locator.first.scroll_into_view_if_needed(timeout=8_000)


async def idle_drift(page: Page, duration_seconds: float = 2.0) -> None:
    """Idle pacing helper that keeps timing smooth during long waits."""
    pid = id(page)
    cx, cy = _mouse_pos.get(pid, (960.0, 540.0))
    remaining = max(0.0, float(duration_seconds))
    while remaining > 0:
        interval = min(remaining, _clamp(random.gauss(0.45, 0.12), 0.1, 1.2))
        await wait_with_jitter(interval, max(0.02, interval * 0.2))
        dx = random.gauss(0.0, 4.0)
        dy = random.gauss(0.0, 4.0)
        cx = _clamp(cx + dx, 10.0, 1910.0)
        cy = _clamp(cy + dy, 10.0, 1070.0)
        await page.mouse.move(cx, cy, steps=random.randint(1, 3))
        remaining -= interval
    _mouse_pos[pid] = (cx, cy)
