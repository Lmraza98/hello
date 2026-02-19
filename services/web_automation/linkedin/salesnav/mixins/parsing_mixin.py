from __future__ import annotations

import asyncio
import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

import config
from ..core.selectors import SEL


class SalesNavParsingMixin:
    def _parse_headcount_bucket(raw: str) -> Optional[tuple[int, Optional[int]]]:
        """Parse range text like '11-50', '1,001-5,000', or '10,001+' into numeric bounds."""
        if not raw:
            return None
        text = raw.replace(",", "").strip()
        plus_match = re.fullmatch(r"(\d+)\s*\+", text)
        if plus_match:
            return int(plus_match.group(1)), None
        range_match = re.fullmatch(r"(\d+)\s*-\s*(\d+)", text)
        if range_match:
            return int(range_match.group(1)), int(range_match.group(2))
        return None

    def _expand_headcount_range_to_salesnav_options(cls, requested: str) -> List[str]:
        """
        Map flexible input (e.g. '11-500', '501-1000', '10001+') to Sales Nav bucket labels.
        Returns one or more concrete options to click.
        """
        salesnav_buckets = [
            "1-10",
            "11-50",
            "51-200",
            "201-500",
            "501-1,000",
            "1,001-5,000",
            "5,001-10,000",
            "10,001+",
        ]

        if not requested:
            return []

        normalized_requested = requested.replace(",", "").strip()
        for bucket in salesnav_buckets:
            if normalized_requested == bucket.replace(",", ""):
                return [bucket]

        requested_bounds = cls._parse_headcount_bucket(normalized_requested)
        if not requested_bounds:
            return []

        requested_min, requested_max = requested_bounds
        matched = []
        for bucket in salesnav_buckets:
            bucket_bounds = cls._parse_headcount_bucket(bucket)
            if not bucket_bounds:
                continue
            bucket_min, bucket_max = bucket_bounds

            # Overlap test for closed/open-ended intervals.
            if requested_max is None and bucket_max is None:
                overlaps = requested_min == bucket_min
            elif requested_max is None:
                overlaps = bucket_max is None and bucket_min >= requested_min
            elif bucket_max is None:
                overlaps = requested_max >= bucket_min
            else:
                overlaps = not (requested_max < bucket_min or requested_min > bucket_max)

            if overlaps:
                matched.append(bucket)

        return matched

    def _parse_employee_text(raw: str) -> Optional[str]:
        """
        Extract the employee-count display string from text like
        "Construction Â· 8.5K+ employees on LinkedIn".

        Returns a human-friendly string such as "8.5K+" or "1,234",
        or None if nothing is found.
        """
        # First, try the full "N employees" pattern (most reliable)
        m = re.search(
            r'([\d,]+(?:\.\d+)?)\s*([KkMm])?\+?\s+employees?',
            raw, re.IGNORECASE,
        )
        if m:
            number_part = m.group(1)     # e.g. "8.5" or "1,234"
            suffix = m.group(2) or ''    # e.g. "K" or ""
            plus = '+' if '+' in raw[m.start():m.end() + 2] else ''
            return f"{number_part}{suffix.upper()}{plus}"
        return None

    def _employee_display_to_int(display: str) -> int:
        """
        Convert a display string like "8.5K+" to an approximate integer (8500).
        Used only for validation / sanity checks.
        """
        s = display.replace(',', '').replace('+', '').strip().upper()
        multiplier = 1
        if s.endswith('K'):
            multiplier = 1_000
            s = s[:-1]
        elif s.endswith('M'):
            multiplier = 1_000_000
            s = s[:-1]
        try:
            return int(float(s) * multiplier)
        except ValueError:
            return 0

