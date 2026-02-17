"""Shared parsing helpers for Sales Navigator text/range normalization."""

from __future__ import annotations

import re
from typing import Optional


def parse_headcount_bucket(raw: str) -> Optional[tuple[int, Optional[int]]]:
    """Parse range text like '11-50', '1,001-5,000', or '10,001+' into bounds."""
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


def expand_headcount_range_to_salesnav_options(requested: str) -> list[str]:
    """
    Map flexible input (e.g. '11-500', '501-1000', '10001+') to Sales Nav buckets.
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

    requested_bounds = parse_headcount_bucket(normalized_requested)
    if not requested_bounds:
        return []
    requested_min, requested_max = requested_bounds

    matched: list[str] = []
    for bucket in salesnav_buckets:
        bucket_bounds = parse_headcount_bucket(bucket)
        if not bucket_bounds:
            continue
        bucket_min, bucket_max = bucket_bounds
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


def parse_employee_text(raw: str) -> Optional[str]:
    """
    Extract the employee-count display string from text like
    'Construction · 8.5K+ employees on LinkedIn'.
    """
    match = re.search(r"([\d,]+(?:\.\d+)?)\s*([KkMm])?\+?\s+employees?", raw, re.IGNORECASE)
    if match:
        number_part = match.group(1)
        suffix = match.group(2) or ""
        plus = "+" if "+" in raw[match.start() : match.end() + 2] else ""
        return f"{number_part}{suffix.upper()}{plus}"
    return None


def employee_display_to_int(display: str) -> int:
    """Convert display like '8.5K+' to approximate integer (8500)."""
    value = str(display or "").replace(",", "").replace("+", "").strip().upper()
    multiplier = 1
    if value.endswith("K"):
        multiplier = 1_000
        value = value[:-1]
    elif value.endswith("M"):
        multiplier = 1_000_000
        value = value[:-1]
    try:
        return int(float(value) * multiplier)
    except ValueError:
        return 0

