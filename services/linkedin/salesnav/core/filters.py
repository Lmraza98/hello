"""Filter utility helpers."""

from __future__ import annotations

from difflib import SequenceMatcher


def split_bullet_text(text: str) -> list[str]:
    clean = str(text or "")
    bullet_variants = ["•", "â€¢", "Ã¢â‚¬Â¢"]
    for token in bullet_variants:
        if token in clean:
            return [part.strip() for part in clean.split(token) if part.strip()]
    return [clean.strip()] if clean.strip() else []


def similarity_score(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def normalize_salesnav_company_url(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    return value.split("?", 1)[0].split("#", 1)[0]


def normalize_salesnav_lead_url(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    return value.split("?", 1)[0].split("#", 1)[0]

