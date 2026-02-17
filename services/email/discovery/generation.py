"""Email generation helpers."""

import re

from services.identity.name_normalizer import normalize_name


def generate_email(name: str, pattern: str, domain: str) -> str:
    """
    Generate email address from name using discovered pattern.
    """
    normalized = normalize_name(name)

    first = normalized.first.lower() if normalized.first else ""
    last = re.sub(r"\s+", "", normalized.last.lower()) if normalized.last else ""
    f = normalized.first_initial
    l = normalized.last_initial

    if not first:
        return ""

    pattern_map = {
        "first.last": f"{first}.{last}",
        "firstlast": f"{first}{last}",
        "flast": f"{f}{last}",
        "first_last": f"{first}_{last}",
        "first-last": f"{first}-{last}",
        "first": first,
        "f.last": f"{f}.{last}",
        "lastfirst": f"{last}{first}",
        "last.first": f"{last}.{first}",
        "last_first": f"{last}_{first}",
        "last": last,
        "lfirst": f"{l}{first}",
        "fl": f"{f}{l}",
    }

    prefix = pattern_map.get(pattern, f"{first}.{last}")
    prefix = re.sub(r"\.+", ".", prefix)
    prefix = re.sub(r"_+", "_", prefix)
    prefix = re.sub(r"-+", "-", prefix)
    prefix = prefix.strip(".").strip("_").strip("-")

    if prefix and domain:
        return f"{prefix}@{domain}"
    return ""

