"""LLM-backed person-name classifier for ingestion-time normalization."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Optional

from openai import OpenAI

import config
from api.observability import compute_openai_cost_usd, record_cost


_FENCE_START = re.compile(r"^```(?:json)?\s*", re.IGNORECASE)
_FENCE_END = re.compile(r"\s*```$", re.IGNORECASE)
_VALID_NAME_CHARS = re.compile(r"[^A-Za-z\u00C0-\u024F'\-\s]")
_KNOWN_PREFIXES = {"mr", "mrs", "ms", "miss", "dr", "prof", "rev", "sir", "dame"}
_KNOWN_SUFFIXES = {
    "md",
    "m.d",
    "phd",
    "ph.d",
    "mba",
    "dmd",
    "dds",
    "do",
    "d.o",
    "jr",
    "sr",
    "ii",
    "iii",
    "iv",
    "v",
}


@dataclass
class ClassifiedName:
    original: str
    cleaned_full_name: str
    prefix_title: str
    suffix_credentials: str
    first: str
    middle: str
    last: str
    first_initial: str
    last_initial: str
    needs_review: bool
    review_reason: Optional[str]
    confidence: float


def _clean_part(value: Any) -> str:
    text = str(value or "").strip()
    text = _VALID_NAME_CHARS.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.title()


def _fallback_classify(raw_name: str, reason: Optional[str] = None) -> ClassifiedName:
    clean = _VALID_NAME_CHARS.sub(" ", str(raw_name or "").strip())
    clean = re.sub(r"\s+", " ", clean).strip()
    parts = clean.split() if clean else []

    prefix = ""
    suffix_parts: list[str] = []
    if parts and parts[0].lower().rstrip(".") in _KNOWN_PREFIXES:
        prefix = parts.pop(0).title().rstrip(".")
    while parts and parts[-1].lower().rstrip(".") in _KNOWN_SUFFIXES:
        suffix_parts.insert(0, parts.pop(-1).upper().replace(".", ""))
    suffix = " ".join(suffix_parts)

    first = parts[0].title() if parts else ""
    last = parts[-1].title() if len(parts) > 1 else ""
    middle = " ".join(p.title() for p in parts[1:-1]) if len(parts) > 2 else ""
    cleaned_full_name = " ".join(part for part in [first, middle, last] if part).strip()

    needs_review = len(parts) != 2
    review_reason = reason or ("Non-standard token count" if needs_review else None)
    return ClassifiedName(
        original=raw_name or "",
        cleaned_full_name=cleaned_full_name,
        prefix_title=prefix,
        suffix_credentials=suffix,
        first=first,
        middle=middle,
        last=last,
        first_initial=first[:1].lower(),
        last_initial=last[:1].lower(),
        needs_review=needs_review,
        review_reason=review_reason,
        confidence=0.4 if needs_review else 0.6,
    )


def _parse_llm_payload(raw_name: str, content: str) -> ClassifiedName:
    cleaned = _FENCE_START.sub("", (content or "").strip())
    cleaned = _FENCE_END.sub("", cleaned)
    payload = json.loads(cleaned)

    prefix_title = _clean_part(payload.get("prefix_title"))
    first = _clean_part(payload.get("first"))
    middle = _clean_part(payload.get("middle"))
    last = _clean_part(payload.get("last"))
    suffix_credentials = str(payload.get("suffix_credentials") or "").strip().upper().replace(".", "")
    needs_review = bool(payload.get("needs_review", False))
    review_reason = str(payload.get("review_reason") or "").strip() or None
    try:
        confidence = float(payload.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    if not first and not last:
        return _fallback_classify(raw_name, reason="LLM returned empty fields")

    cleaned_full_name = " ".join(part for part in [first, middle, last] if part).strip()
    return ClassifiedName(
        original=raw_name or "",
        cleaned_full_name=cleaned_full_name,
        prefix_title=prefix_title,
        suffix_credentials=suffix_credentials,
        first=first,
        middle=middle,
        last=last,
        first_initial=first[:1].lower(),
        last_initial=last[:1].lower(),
        needs_review=needs_review,
        review_reason=review_reason,
        confidence=confidence,
    )


def _classify_with_llm(raw_name: str) -> ClassifiedName:
    if not config.OPENAI_API_KEY:
        return _fallback_classify(raw_name, reason="Missing OPENAI_API_KEY")

    prompt = f"""
Classify this person's name for CRM storage.

Name: {raw_name}

Rules:
- Keep apostrophes and hyphens.
- Use title case.
- Extract prefix_title when present (Dr, Prof, Mr, Ms, etc).
- Extract suffix_credentials when present (MD, PhD, MBA, Jr, etc).
- If ambiguous, provide best guess and set needs_review=true.
- If single name, put it in first and leave last empty.

Respond with JSON only:
{{
  "prefix_title": "string",
  "first": "string",
  "middle": "string",
  "last": "string",
  "suffix_credentials": "string",
  "needs_review": true,
  "review_reason": "string or null",
  "confidence": 0.0
}}
""".strip()

    client = OpenAI(api_key=config.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=config.LLM_MODEL_SMART,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=220,
    )

    usage = response.usage
    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    record_cost(
        provider="openai",
        model=config.LLM_MODEL_SMART,
        feature="identity",
        endpoint="services.identity.name_classifier.classify_name",
        usd=compute_openai_cost_usd(config.LLM_MODEL_SMART, prompt_tokens, completion_tokens),
        input_tokens=prompt_tokens,
        output_tokens=completion_tokens,
    )

    content = response.choices[0].message.content or ""
    return _parse_llm_payload(raw_name, content)


@lru_cache(maxsize=4096)
def _classify_cached(raw_name: str) -> ClassifiedName:
    raw_name = str(raw_name or "").strip()
    if not raw_name:
        return _fallback_classify(raw_name, reason="Empty name")
    try:
        return _classify_with_llm(raw_name)
    except Exception as exc:
        return _fallback_classify(raw_name, reason=f"LLM fallback: {exc}")


def classify_name(raw_name: str) -> ClassifiedName:
    """Classify and normalize a person name for ingestion."""
    return _classify_cached(raw_name)

