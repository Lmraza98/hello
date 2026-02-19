"""Human-like browser interaction primitives for anti-bot evasion.

This module provides a transparent middleware layer that makes automated
browser interactions look human.  It wraps the raw Playwright primitives
with:

- Per-character typing with variable delay
- Click with mouse-move path + position jitter (never dead-centre)
- Smooth, variable-speed scrolling
- Random micro-pauses between actions

Usage
-----
The ``StealthConfig`` dataclass controls how aggressive the evasion is.
Workflows that target internal tools can set ``stealth=False`` to skip
the overhead.  Everything else gets the default human-like config.

These functions operate on a raw Playwright ``Page`` — they do NOT go
through the ``browser_act`` HTTP endpoint, so they can be called from
both ``BrowserWorkflow`` and challenge-resolution code without circular
imports.
"""

from __future__ import annotations

import asyncio
import math
import random
from dataclasses import dataclass, field
from typing import Any

import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class StealthConfig:
    """Per-workflow stealth tunables.

    Reasonable defaults target aggressive sites (LinkedIn, Cloudflare).
    Lower values suit internal/soft targets.
    """

    enabled: bool = True

    # Typing
    type_char_delay_min_ms: int = 40
    type_char_delay_max_ms: int = 160
    type_mistake_probability: float = 0.0  # 0 = no mistakes

    # Clicking
    click_jitter: bool = True
    click_move_steps_min: int = 5
    click_move_steps_max: int = 18
    click_pre_delay_min_ms: int = 30
    click_pre_delay_max_ms: int = 180

    # Scrolling
    scroll_step_min: int = 3
    scroll_step_max: int = 9
    scroll_step_delay_min_ms: int = 40
    scroll_step_delay_max_ms: int = 160

    # Generic inter-action delay
    action_delay_min_ms: int = 120
    action_delay_max_ms: int = 600

    @classmethod
    def from_frontmatter(cls, fm: dict[str, Any] | None) -> "StealthConfig":
        """Build config from a skill frontmatter ``stealth:`` block."""
        if not fm or not isinstance(fm, dict):
            return cls()
        stealth = fm.get("stealth")
        if isinstance(stealth, bool):
            return cls(enabled=stealth)
        if not isinstance(stealth, dict):
            return cls()
        return cls(
            enabled=_as_bool(stealth.get("enabled"), True),
            type_char_delay_min_ms=_as_int(stealth.get("type_char_delay_min_ms"), cls.type_char_delay_min_ms),
            type_char_delay_max_ms=_as_int(stealth.get("type_char_delay_max_ms"), cls.type_char_delay_max_ms),
            click_jitter=_as_bool(stealth.get("click_jitter"), True),
            click_move_steps_min=_as_int(stealth.get("click_move_steps_min"), cls.click_move_steps_min),
            click_move_steps_max=_as_int(stealth.get("click_move_steps_max"), cls.click_move_steps_max),
            click_pre_delay_min_ms=_as_int(stealth.get("click_pre_delay_min_ms"), cls.click_pre_delay_min_ms),
            click_pre_delay_max_ms=_as_int(stealth.get("click_pre_delay_max_ms"), cls.click_pre_delay_max_ms),
            scroll_step_min=_as_int(stealth.get("scroll_step_min"), cls.scroll_step_min),
            scroll_step_max=_as_int(stealth.get("scroll_step_max"), cls.scroll_step_max),
            action_delay_min_ms=_as_int(stealth.get("action_delay_min_ms"), cls.action_delay_min_ms),
            action_delay_max_ms=_as_int(stealth.get("action_delay_max_ms"), cls.action_delay_max_ms),
        )


def _as_int(v: Any, fallback: int) -> int:
    try:
        return int(v)
    except Exception:
        return fallback


def _as_bool(v: Any, fallback: bool) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in {"true", "1", "yes"}
    return fallback


# ---------------------------------------------------------------------------
# Delay helpers
# ---------------------------------------------------------------------------

async def human_delay(min_ms: int = 80, max_ms: int = 350) -> None:
    """Sleep for a random interval within [min_ms, max_ms]."""
    lo = max(0, min_ms)
    hi = max(lo + 1, max_ms)
    await asyncio.sleep(random.uniform(lo, hi) / 1000.0)


async def action_delay(cfg: StealthConfig) -> None:
    """Inter-action pause — inserted between sequential browser operations."""
    if not cfg.enabled:
        return
    await human_delay(cfg.action_delay_min_ms, cfg.action_delay_max_ms)


# ---------------------------------------------------------------------------
# Mouse helpers
# ---------------------------------------------------------------------------

def _jitter_point(box: dict[str, float], *, spread_lo: float = 0.25, spread_hi: float = 0.75) -> tuple[float, float]:
    """Return a point inside *box* that is NOT dead-centre.

    The ``spread_lo``/``spread_hi`` range controls how far from the edges
    the point can land (0.5 = centre, 0.0 = left/top edge).
    """
    x = box["x"] + box["width"] * random.uniform(spread_lo, spread_hi)
    y = box["y"] + box["height"] * random.uniform(spread_lo, spread_hi)
    return x, y


def _bezier_steps(
    x0: float, y0: float,
    x1: float, y1: float,
    num_steps: int,
) -> list[tuple[float, float]]:
    """Generate a slightly curved path between two points.

    Uses a single random control point so the path looks like
    a natural hand-move rather than a straight line.
    """
    # Random control point offset perpendicular to the line
    dx = x1 - x0
    dy = y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1:
        return [(x1, y1)]
    # Perpendicular direction
    px, py = -dy / dist, dx / dist
    # Offset magnitude: 10-30% of distance, random side
    offset = dist * random.uniform(0.08, 0.28) * random.choice([-1, 1])
    cx = (x0 + x1) / 2 + px * offset
    cy = (y0 + y1) / 2 + py * offset

    points: list[tuple[float, float]] = []
    for i in range(1, num_steps + 1):
        t = i / num_steps
        inv = 1 - t
        bx = inv * inv * x0 + 2 * inv * t * cx + t * t * x1
        by = inv * inv * y0 + 2 * inv * t * cy + t * t * y1
        # Add micro-jitter so the path isn't perfectly smooth
        bx += random.uniform(-0.8, 0.8)
        by += random.uniform(-0.8, 0.8)
        points.append((bx, by))
    return points


async def human_mouse_move(page: Any, target_x: float, target_y: float, cfg: StealthConfig) -> None:
    """Move the mouse to (target_x, target_y) along a slightly curved path."""
    if not cfg.enabled:
        return
    # Get current mouse position (Playwright doesn't expose it directly;
    # start from a random viewport point on the first call).
    start_x = random.uniform(100, 800)
    start_y = random.uniform(100, 600)

    steps = random.randint(cfg.click_move_steps_min, cfg.click_move_steps_max)
    path = _bezier_steps(start_x, start_y, target_x, target_y, steps)
    for px, py in path:
        await page.mouse.move(px, py)
        await asyncio.sleep(random.uniform(0.004, 0.018))


# ---------------------------------------------------------------------------
# High-level primitives
# ---------------------------------------------------------------------------

async def human_click(
    page: Any,
    locator: Any,
    cfg: StealthConfig,
    *,
    timeout: int = 15_000,
) -> None:
    """Click *locator* with human-like mouse movement + position jitter.

    Falls back to a plain ``locator.click()`` if bounding-box detection fails
    (e.g. elements positioned off-screen).
    """
    if not cfg.enabled or not cfg.click_jitter:
        await locator.click(timeout=timeout)
        return

    try:
        await locator.scroll_into_view_if_needed(timeout=min(timeout, 5_000))
    except Exception:
        # Not all locators support scrolling; ignore and proceed.
        pass

    try:
        box = await locator.bounding_box()
    except Exception:
        box = None

    if box and box.get("width", 0) > 0 and box.get("height", 0) > 0:
        x, y = _jitter_point(box)
        await human_mouse_move(page, x, y, cfg)
        await human_delay(cfg.click_pre_delay_min_ms, cfg.click_pre_delay_max_ms)
        await page.mouse.click(x, y)
    else:
        # Fallback — still add a small pre-click pause.
        await human_delay(cfg.click_pre_delay_min_ms, cfg.click_pre_delay_max_ms)
        await locator.click(timeout=timeout)


async def human_type(
    page: Any,
    text: str,
    cfg: StealthConfig,
) -> None:
    """Type *text* character-by-character with variable per-key delay."""
    if not cfg.enabled:
        await page.keyboard.type(text, delay=50)
        return
    for char in text:
        await page.keyboard.type(char)
        delay_ms = random.uniform(cfg.type_char_delay_min_ms, cfg.type_char_delay_max_ms)
        await asyncio.sleep(delay_ms / 1000.0)


async def human_scroll(
    page: Any,
    cfg: StealthConfig,
    *,
    direction: str = "down",
    distance: int = 400,
) -> None:
    """Scroll the page with variable step sizes + pauses like a human."""
    if not cfg.enabled:
        delta = distance if direction == "down" else -distance
        await page.mouse.wheel(0, delta)
        return
    steps = random.randint(cfg.scroll_step_min, cfg.scroll_step_max)
    per_step = distance / steps
    for _ in range(steps):
        delta = per_step * random.uniform(0.6, 1.4)
        if direction != "down":
            delta = -delta
        await page.mouse.wheel(0, delta)
        await asyncio.sleep(
            random.uniform(cfg.scroll_step_delay_min_ms, cfg.scroll_step_delay_max_ms) / 1000.0
        )


async def human_press_and_hold(
    page: Any,
    locator: Any,
    cfg: StealthConfig,
    *,
    hold_min_s: float = 1.5,
    hold_max_s: float = 4.0,
) -> None:
    """Press-and-hold on *locator* (used for Cloudflare Turnstile).

    Moves the mouse to the element, presses the button down, waits
    a random interval, then releases.
    """
    try:
        box = await locator.bounding_box()
    except Exception:
        box = None

    if box and box.get("width", 0) > 0 and box.get("height", 0) > 0:
        x, y = _jitter_point(box, spread_lo=0.35, spread_hi=0.65)
        await human_mouse_move(page, x, y, cfg)
        await human_delay(200, 500)
        await page.mouse.down()
        await asyncio.sleep(random.uniform(hold_min_s, hold_max_s))
        await page.mouse.up()
    else:
        # Fallback: just click
        await locator.click(timeout=15_000)


# ---------------------------------------------------------------------------
# Fingerprint evasion init script
# ---------------------------------------------------------------------------

STEALTH_INIT_SCRIPT = """
(() => {
  // --- navigator.webdriver ------------------------------------------------
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  // Some sites check the prototype chain
  if (navigator.__proto__) {
    try { delete navigator.__proto__.webdriver; } catch (_) {}
  }

  // --- chrome.runtime (makes us look like a real Chrome) ------------------
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {},
      sendMessage: function() {},
    };
  }

  // --- navigator.plugins (Playwright default is empty) --------------------
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer',
          description: 'Portable Document Format', length: 1 },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
          description: '', length: 1 },
        { name: 'Native Client', filename: 'internal-nacl-plugin',
          description: '', length: 2 },
      ];
      arr.item = (i) => arr[i] || null;
      arr.namedItem = (n) => arr.find(p => p.name === n) || null;
      arr.refresh = () => {};
      return arr;
    },
  });

  // --- navigator.languages ------------------------------------------------
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // --- navigator.permissions.query (notifications check) ------------------
  const origQuery = navigator.permissions && navigator.permissions.query;
  if (origQuery) {
    navigator.permissions.query = (params) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return origQuery.call(navigator.permissions, params);
    };
  }

  // --- WebGL vendor/renderer (avoid "Google Inc. / ANGLE" fingerprint) ----
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';              // UNMASKED_VENDOR_WEBGL
    if (param === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
    return getParam.call(this, param);
  };
  const getParam2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParam2.call(this, param);
  };

  // --- Prevent Playwright-specific iframe detection -----------------------
  // Some anti-bot checks look for the __playwright* properties on window.
  const pwKeys = Object.getOwnPropertyNames(window).filter(k =>
    k.startsWith('__playwright') || k.startsWith('__pw')
  );
  for (const key of pwKeys) {
    try { delete window[key]; } catch (_) {}
    try {
      Object.defineProperty(window, key, {
        get: () => undefined,
        configurable: true,
      });
    } catch (_) {}
  }

  // --- canvas fingerprint slight noise ------------------------------------
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    const ctx = this.getContext('2d');
    if (ctx && this.width > 0 && this.height > 0) {
      // Add imperceptible single-pixel noise
      const imgData = ctx.getImageData(0, 0, 1, 1);
      imgData.data[0] = imgData.data[0] ^ 1;
      ctx.putImageData(imgData, 0, 0);
    }
    return origToDataURL.apply(this, arguments);
  };

  // --- Connection / rtt (headless Chrome defaults are suspicious) ---------
  if (navigator.connection) {
    try {
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    } catch(_) {}
  }

  // --- Prevent detection via iframe contentWindow -------------------------
  // Cloudflare/Turnstile uses cross-frame checks
  const origContentWindow = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype, 'contentWindow'
  );
  if (origContentWindow && origContentWindow.get) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function() {
        const win = origContentWindow.get.call(this);
        if (win) {
          try {
            // Ensure the iframe's window also lacks webdriver
            Object.defineProperty(win.navigator, 'webdriver', {
              get: () => undefined, configurable: true
            });
          } catch (_) {}
        }
        return win;
      }
    });
  }
})();
"""

# Chrome launch arguments for anti-detection
STEALTH_LAUNCH_ARGS: list[str] = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-infobars",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-hang-monitor",
    "--disable-popup-blocking",
    "--disable-prompt-on-repost",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--no-first-run",
    "--password-store=basic",
    "--use-mock-keychain",
    # Avoid CDP detection (some anti-bots check for the DevTools port).
    "--remote-debugging-port=0",
]
