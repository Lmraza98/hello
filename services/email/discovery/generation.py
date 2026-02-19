"""Email generation helpers."""

import re

def _split_name(name: str) -> tuple[str, str, str, str]:
    clean = re.sub(r"\s+", " ", (name or "").strip())
    if not clean:
        return "", "", "", ""
    parts = clean.split(" ")
    first = parts[0].lower()
    last = parts[-1].lower() if len(parts) > 1 else ""
    last = re.sub(r"\s+", "", last)
    return first, last, first[:1], last[:1]


def generate_email(name: str, pattern: str, domain: str) -> str:
    """
    Generate email address from name using discovered pattern.
    """
    first, last, f, l = _split_name(name)

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
