"""Low-level browser interaction helpers for reliability and load smoothing.

These utilities use Playwright mouse APIs directly and are intended for
deterministic interaction quality (visibility, movement, scroll readiness),
not behavioral simulation/evasion.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
from typing import Tuple

from playwright.async_api import Locator, Page

# Last known pointer position keyed by page identity.
_mouse_pos: dict[int, Tuple[float, float]] = {}
_page_profiles: dict[int, dict[str, float | int]] = {}
_logger = logging.getLogger(__name__)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _near(value: float, relative_jitter: float, *, rng: random.Random | None = None) -> float:
    """Sample a high-precision float near a baseline value."""
    source = rng or random
    jitter = abs(float(relative_jitter))
    return float(value) * (1.0 + source.uniform(-jitter, jitter))


def _build_runtime_profile(*, rng: random.Random | None = None) -> dict[str, float | int]:
    """Generate near-baseline interaction values with randomized precision."""
    default_width = _clamp(_near(1920.0, 0.10, rng=rng), 1280.0, 2560.0)
    default_height = _clamp(_near(1080.0, 0.10, rng=rng), 720.0, 1440.0)
    default_padding = _clamp(_near(10.0, 0.25, rng=rng), 6.0, 18.0)
    visible_timeout_ms = int(round(_clamp(_near(8000.0, 0.15, rng=rng), 3000.0, 12000.0)))
    attached_timeout_ms = int(round(_clamp(_near(8000.0, 0.15, rng=rng), 3000.0, 12000.0)))
    return {
        "default_width": default_width,
        "default_height": default_height,
        "default_padding": default_padding,
        "visible_timeout_ms": visible_timeout_ms,
        "attached_timeout_ms": attached_timeout_ms,
        "wait_base_s": _clamp(_near(0.6, 0.25, rng=rng), 0.3, 0.95),
        "wait_variance_s": _clamp(_near(0.2, 0.30, rng=rng), 0.08, 0.35),
        "wait_min_s": _clamp(_near(0.05, 0.30, rng=rng), 0.02, 0.1),
        "wait_max_s": _clamp(_near(12.0, 0.20, rng=rng), 8.0, 18.0),
        "move_step_distance_px": _clamp(_near(75.0, 0.20, rng=rng), 45.0, 110.0),
        "move_min_steps": _clamp(_near(4.0, 0.30, rng=rng), 2.0, 8.0),
        "move_max_steps": _clamp(_near(24.0, 0.25, rng=rng), 14.0, 40.0),
        "post_move_wait_s": _clamp(_near(0.06, 0.30, rng=rng), 0.02, 0.12),
        "post_move_wait_var_s": _clamp(_near(0.03, 0.40, rng=rng), 0.01, 0.06),
        "click_inner_low_ratio": _clamp(_near(0.15, 0.20, rng=rng), 0.08, 0.3),
        "click_inner_high_ratio": _clamp(_near(0.85, 0.10, rng=rng), 0.7, 0.94),
        "post_click_wait_s": _clamp(_near(0.05, 0.30, rng=rng), 0.02, 0.1),
        "post_click_wait_var_s": _clamp(_near(0.02, 0.40, rng=rng), 0.005, 0.04),
        "wheel_chunk_px": int(round(_clamp(_near(120.0, 0.15, rng=rng), 80.0, 180.0))),
        "wheel_wait_s": _clamp(_near(0.035, 0.25, rng=rng), 0.01, 0.08),
        "wheel_wait_var_s": _clamp(_near(0.015, 0.35, rng=rng), 0.004, 0.035),
        "margin_top_ratio": _clamp(_near(0.15, 0.18, rng=rng), 0.08, 0.25),
        "margin_bottom_ratio": _clamp(_near(0.85, 0.08, rng=rng), 0.7, 0.93),
        "scroll_down_target_ratio": _clamp(_near(0.6, 0.18, rng=rng), 0.4, 0.8),
        "scroll_up_target_ratio": _clamp(_near(0.35, 0.20, rng=rng), 0.2, 0.5),
        "post_scroll_wait_s": _clamp(_near(0.10, 0.30, rng=rng), 0.04, 0.2),
        "post_scroll_wait_var_s": _clamp(_near(0.04, 0.30, rng=rng), 0.015, 0.08),
        "idle_default_duration_s": _clamp(_near(2.0, 0.25, rng=rng), 1.0, 3.5),
        "idle_interval_mean_s": _clamp(_near(0.45, 0.25, rng=rng), 0.2, 0.8),
        "idle_interval_std_s": _clamp(_near(0.12, 0.30, rng=rng), 0.04, 0.22),
        "idle_interval_min_s": _clamp(_near(0.1, 0.30, rng=rng), 0.04, 0.2),
        "idle_interval_max_s": _clamp(_near(1.2, 0.20, rng=rng), 0.8, 2.0),
        "idle_wait_variance_floor_s": _clamp(_near(0.02, 0.30, rng=rng), 0.005, 0.05),
        "idle_wait_variance_ratio": _clamp(_near(0.2, 0.25, rng=rng), 0.1, 0.35),
        "idle_drift_std_px": _clamp(_near(4.0, 0.30, rng=rng), 1.8, 8.0),
        "idle_move_min_steps": int(round(_clamp(_near(1.0, 0.30, rng=rng), 1.0, 2.0))),
        "idle_move_max_steps": int(round(_clamp(_near(3.0, 0.30, rng=rng), 2.0, 6.0))),
    }


_BASE_PROFILE = _build_runtime_profile(rng=random.Random(0))


def _profile_for_page(page: Page | None) -> dict[str, float | int]:
    if page is None:
        return _BASE_PROFILE
    pid = id(page)
    profile = _page_profiles.get(pid)
    if profile is None:
        profile = _build_runtime_profile()
        _page_profiles[pid] = profile
        _logger.debug("SalesNav interaction profile initialized for page_id=%s: %s", pid, profile)
    return profile


def _viewport_center(page: Page, *, profile: dict[str, float | int] | None = None) -> tuple[float, float]:
    active = profile or _profile_for_page(page)
    viewport = page.viewport_size or {"width": int(active["default_width"]), "height": int(active["default_height"])}
    return float(viewport["width"]) / 2.0, float(viewport["height"]) / 2.0


async def wait_with_jitter(
    base_s: float | None = None,
    variance: float | None = None,
    *,
    profile: dict[str, float | int] | None = None,
) -> float:
    """Wait with bounded gaussian jitter to smooth automation load patterns."""
    active = profile or _BASE_PROFILE
    base = float(active["wait_base_s"] if base_s is None else base_s)
    spread = max(0.0, float(active["wait_variance_s"] if variance is None else variance))
    sampled = random.gauss(base, spread)
    delay = _clamp(sampled, float(active["wait_min_s"]), float(active["wait_max_s"]))
    await asyncio.sleep(delay)
    return delay


async def _move_to_point(page: Page, x: float, y: float) -> tuple[float, float]:
    """Move pointer to an absolute point with distance-based stepping."""
    profile = _profile_for_page(page)
    pid = id(page)
    start_x, start_y = _mouse_pos.get(pid, _viewport_center(page, profile=profile))
    distance = math.hypot(x - start_x, y - start_y)
    steps = int(
        _clamp(
            distance / float(profile["move_step_distance_px"]),
            float(profile["move_min_steps"]),
            float(profile["move_max_steps"]),
        )
    )
    await page.mouse.move(x, y, steps=steps)
    _mouse_pos[pid] = (x, y)
    await wait_with_jitter(
        float(profile["post_move_wait_s"]),
        float(profile["post_move_wait_var_s"]),
        profile=profile,
    )
    return x, y


async def move_to_element(page: Page, locator: Locator) -> tuple[float, float]:
    """Move pointer to the center of a visible element with distance-based steps."""
    profile = _profile_for_page(page)
    await locator.first.wait_for(state="visible", timeout=int(profile["visible_timeout_ms"]))
    box = await locator.first.bounding_box()
    if not box:
        raise RuntimeError("Element has no bounding box for pointer movement.")

    target_x = float(box["x"]) + float(box["width"]) / 2.0
    target_y = float(box["y"]) + float(box["height"]) / 2.0

    return await _move_to_point(page, target_x, target_y)


async def click_locator(page: Page, locator: Locator) -> None:
    """Move to a locator and click at an in-bounds point using mouse APIs."""
    profile = _profile_for_page(page)
    await locator.first.wait_for(state="visible", timeout=int(profile["visible_timeout_ms"]))
    box = await locator.first.bounding_box()
    if not box:
        raise RuntimeError("Element has no bounding box for click.")

    # Avoid fragile center/edge clicks by targeting a stable inner area.
    x = float(box["x"]) + random.uniform(
        float(box["width"]) * float(profile["click_inner_low_ratio"]),
        float(box["width"]) * float(profile["click_inner_high_ratio"]),
    )
    y = float(box["y"]) + random.uniform(
        float(box["height"]) * float(profile["click_inner_low_ratio"]),
        float(box["height"]) * float(profile["click_inner_high_ratio"]),
    )
    await _move_to_point(page, x, y)
    await wait_with_jitter(
        float(profile["post_click_wait_s"]),
        float(profile["post_click_wait_var_s"]),
        profile=profile,
    )
    await page.mouse.click(x, y)
    _mouse_pos[id(page)] = (x, y)


async def wheel_scroll(page: Page, delta_y: int) -> int:
    """Scroll by wheel in fixed-size increments with short jittered pauses."""
    profile = _profile_for_page(page)
    remaining = int(delta_y)
    if remaining == 0:
        return 0

    direction = 1 if remaining > 0 else -1
    remaining_abs = abs(remaining)
    scrolled = 0
    chunk = int(profile["wheel_chunk_px"])

    while remaining_abs > 0:
        step = min(chunk, remaining_abs)
        dy = direction * step
        await page.mouse.wheel(0, dy)
        remaining_abs -= step
        scrolled += dy
        await wait_with_jitter(
            float(profile["wheel_wait_s"]),
            float(profile["wheel_wait_var_s"]),
            profile=profile,
        )
    return scrolled


async def scroll_into_view(page: Page, locator: Locator) -> None:
    """Bring a locator into view using wheel scrolling and a final DOM fallback."""
    profile = _profile_for_page(page)
    await locator.first.wait_for(state="attached", timeout=int(profile["attached_timeout_ms"]))
    box = await locator.first.bounding_box()
    if not box:
        await locator.first.scroll_into_view_if_needed(timeout=int(profile["attached_timeout_ms"]))
        return

    viewport = page.viewport_size or {"width": int(profile["default_width"]), "height": int(profile["default_height"])}
    vh = float(viewport["height"])
    top = float(box["y"])
    bottom = top + float(box["height"])
    margin_top = vh * float(profile["margin_top_ratio"])
    margin_bottom = vh * float(profile["margin_bottom_ratio"])

    if bottom > margin_bottom:
        target_delta = int(bottom - (vh * float(profile["scroll_down_target_ratio"])))
        await wheel_scroll(page, target_delta)
        await wait_with_jitter(
            float(profile["post_scroll_wait_s"]),
            float(profile["post_scroll_wait_var_s"]),
            profile=profile,
        )
    elif top < margin_top:
        target_delta = -int((vh * float(profile["scroll_up_target_ratio"])) - top)
        await wheel_scroll(page, target_delta)
        await wait_with_jitter(
            float(profile["post_scroll_wait_s"]),
            float(profile["post_scroll_wait_var_s"]),
            profile=profile,
        )

    # Final deterministic fallback ensures visibility.
    await locator.first.scroll_into_view_if_needed(timeout=int(profile["attached_timeout_ms"]))


async def idle_drift(page: Page, duration_seconds: float | None = None) -> None:
    """Idle pacing helper that keeps timing smooth during long waits."""
    profile = _profile_for_page(page)
    pid = id(page)
    if duration_seconds is None:
        duration_seconds = float(profile["idle_default_duration_s"])
    cx, cy = _mouse_pos.get(pid, _viewport_center(page, profile=profile))
    viewport = page.viewport_size or {"width": int(profile["default_width"]), "height": int(profile["default_height"])}
    pad = float(profile["default_padding"])
    max_x = max(pad, float(viewport["width"]) - pad)
    max_y = max(pad, float(viewport["height"]) - pad)
    remaining = max(0.0, float(duration_seconds))
    while remaining > 0:
        interval = min(
            remaining,
            _clamp(
                random.gauss(float(profile["idle_interval_mean_s"]), float(profile["idle_interval_std_s"])),
                float(profile["idle_interval_min_s"]),
                float(profile["idle_interval_max_s"]),
            ),
        )
        await wait_with_jitter(
            interval,
            max(float(profile["idle_wait_variance_floor_s"]), interval * float(profile["idle_wait_variance_ratio"])),
            profile=profile,
        )
        dx = random.gauss(0.0, float(profile["idle_drift_std_px"]))
        dy = random.gauss(0.0, float(profile["idle_drift_std_px"]))
        cx = _clamp(cx + dx, pad, max_x)
        cy = _clamp(cy + dy, pad, max_y)
        await page.mouse.move(
            cx,
            cy,
            steps=random.randint(int(profile["idle_move_min_steps"]), int(profile["idle_move_max_steps"])),
        )
        remaining -= interval
    _mouse_pos[pid] = (cx, cy)


def _set_profile_for_testing(page: Page | None, profile: dict[str, float | int]) -> None:
    """Test-only helper to force profile values."""
    if page is None:
        _BASE_PROFILE.update(profile)
        return
    _page_profiles[id(page)] = dict(profile)
