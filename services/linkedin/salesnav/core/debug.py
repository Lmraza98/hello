"""Debug artifact capture for Sales Navigator operations."""

from __future__ import annotations

import datetime as dt
import json
import random
from pathlib import Path
from typing import Any

import config


class SalesNavDebug:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    def _debug_dir(self) -> Path:
        p = Path(config.DATA_DIR) / "debug"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def enabled(self) -> bool:
        return bool(getattr(config, "DEBUG_SNAPSHOTS", False))

    def sample_rate(self) -> float:
        raw = getattr(config, "DEBUG_SNAPSHOT_RATE", 0.0)
        try:
            v = float(raw)
        except Exception:
            v = 0.0
        return max(0.0, min(1.0, v))

    def should_capture_sample(self) -> bool:
        if not self.enabled():
            return False
        return random.random() <= self.sample_rate()

    async def capture(self, op_name: str, *, context: dict[str, Any] | None = None) -> dict[str, str]:
        page = self.scraper.page
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        base = self._debug_dir() / f"{op_name}_{stamp}"
        html_path = base.with_suffix(".html")
        png_path = base.with_suffix(".png")
        meta_path = base.with_suffix(".json")

        html = ""
        try:
            html = await page.content()
            html_path.write_text(html, encoding="utf-8")
        except Exception:
            pass
        try:
            await page.screenshot(path=str(png_path), full_page=False)
        except Exception:
            pass
        try:
            payload = {
                "op_name": op_name,
                "url": getattr(page, "url", ""),
                "captured_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "context": context or {},
            }
            meta_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception:
            pass
        return {"html": str(html_path), "png": str(png_path), "meta": str(meta_path)}

