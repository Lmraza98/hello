from __future__ import annotations

import json
import os
import re
from typing import Any
from dataclasses import dataclass
from difflib import SequenceMatcher


_DOC_TYPES = [
    "proposal",
    "contract",
    "transcript",
    "meeting_notes",
    "email_thread",
    "linkedin_export",
    "contact_list",
    "invoice",
    "report",
    "other",
]

_CONTACT_STOP_PHRASES = {
    "estimate request",
    "general information",
    "date requested",
    "brief project",
    "admin dashboard",
    "marketing website",
    "resident portal",
    "property owner",
}

_CONTACT_STOP_TOKENS = {
    "estimate",
    "request",
    "general",
    "information",
    "date",
    "brief",
    "project",
    "admin",
    "dashboard",
    "portal",
    "website",
    "owner",
}


@dataclass
class DocumentAnalysis:
    document_type: str
    document_type_confidence: float
    summary: str
    key_points: list[str]
    extracted_entities: dict


def _classify(filename: str, text: str) -> tuple[str, float]:
    t = f"{filename} {text[:2000]}".lower()
    rules = [
        ("proposal", ["proposal", "scope", "pricing"]),
        ("contract", ["agreement", "contract", "terms and conditions"]),
        ("transcript", ["transcript", "speaker", "recording"]),
        ("meeting_notes", ["meeting notes", "agenda", "action items"]),
        ("email_thread", ["from:", "to:", "subject:"]),
        ("linkedin_export", ["linkedin", "profile url", "connections"]),
        ("contact_list", ["email", "phone", "title", "contact"]),
        ("invoice", ["invoice", "amount due", "bill to"]),
        ("report", ["executive summary", "analysis", "findings"]),
    ]
    for doc_type, terms in rules:
        hits = sum(1 for term in terms if term in t)
        if hits >= 2:
            return doc_type, min(0.95, 0.65 + (hits * 0.1))
    return "other", 0.4


def _extract_companies(text: str) -> list[dict]:
    pattern = re.compile(r"\b([A-Z][A-Za-z0-9&.,\- ]{2,40}(?:Inc|LLC|Corp|Corporation|Ltd|Company))\b")
    seen: set[str] = set()
    out: list[dict] = []
    for match in pattern.finditer(text):
        name = match.group(1).strip()
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        snippet = text[max(0, match.start() - 40): min(len(text), match.end() + 40)]
        out.append({"name": name, "context": snippet})
        if len(out) >= 10:
            break
    return out


def _extract_contacts(text: str) -> list[dict]:
    pattern = re.compile(r"\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b")
    seen: set[str] = set()
    out: list[dict] = []
    for match in pattern.finditer(text):
        name = match.group(1).strip()
        name_norm = name.lower()
        if name_norm in _CONTACT_STOP_PHRASES:
            continue
        tokens = [tok for tok in re.split(r"\s+", name_norm) if tok]
        if len(tokens) != 2:
            continue
        if any(tok in _CONTACT_STOP_TOKENS for tok in tokens):
            continue
        if any(len(tok) < 2 for tok in tokens):
            continue
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        snippet = text[max(0, match.start() - 40): min(len(text), match.end() + 40)]
        out.append({"name": name, "role_in_document": "mentioned", "context": snippet})
        if len(out) >= 15:
            break
    return out


def _extract_dates(text: str) -> list[dict]:
    out: list[dict] = []
    for pattern in [r"\b\d{4}-\d{2}-\d{2}\b", r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b"]:
        for match in re.finditer(pattern, text):
            snippet = text[max(0, match.start() - 40): min(len(text), match.end() + 40)]
            out.append({"date": match.group(0), "context": snippet})
            if len(out) >= 15:
                return out
    return out


def _extract_amounts(text: str) -> list[dict]:
    out: list[dict] = []
    for match in re.finditer(r"\$\s?\d[\d,]*(?:\.\d{2})?", text):
        snippet = text[max(0, match.start() - 40): min(len(text), match.end() + 40)]
        out.append({"amount": match.group(0), "context": snippet})
        if len(out) >= 10:
            break
    return out


def _match_known(name: str, known: list[dict], key: str = "name", min_score: float = 0.65) -> tuple[int | None, float]:
    best_id: int | None = None
    best_score = 0.0
    n = name.lower().strip()
    for row in known:
        candidate = str(row.get(key) or "").lower().strip()
        if not candidate:
            continue
        score = SequenceMatcher(a=n, b=candidate).ratio()
        if score > best_score:
            best_score = score
            if row.get("id") is not None:
                best_id = int(row["id"])
    if best_score < min_score:
        return None, best_score
    return best_id, best_score


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass

    # Best-effort extraction when model wraps JSON in prose/code fences.
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        candidate = raw[start : end + 1]
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _normalize_doc_type(value: str | None) -> str:
    doc_type = str(value or "other").strip().lower()
    return doc_type if doc_type in _DOC_TYPES else "other"


def _coerce_list_of_strings(value: Any, limit: int = 12) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text:
            continue
        out.append(text[:400])
        if len(out) >= limit:
            break
    return out


def _coerce_entities(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"companies": [], "contacts": [], "dates": [], "amounts": [], "action_items": []}
    entities = {
        "companies": value.get("companies") if isinstance(value.get("companies"), list) else [],
        "contacts": value.get("contacts") if isinstance(value.get("contacts"), list) else [],
        "dates": value.get("dates") if isinstance(value.get("dates"), list) else [],
        "amounts": value.get("amounts") if isinstance(value.get("amounts"), list) else [],
        "action_items": value.get("action_items") if isinstance(value.get("action_items"), list) else [],
    }
    return entities


async def _analyze_document_llm(
    *,
    extracted_text: str,
    filename: str,
    known_companies: list[dict],
    known_contacts: list[dict],
) -> DocumentAnalysis | None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    try:
        from openai import AsyncOpenAI
    except Exception:
        return None

    model = os.getenv("DOCUMENT_ANALYSIS_MODEL", "gpt-4o-mini")
    truncated_text = (extracted_text or "")[:50000]

    companies_preview = "\n".join(
        f"- id={row.get('id')} name={row.get('company_name') or ''} domain={row.get('domain') or ''}"
        for row in (known_companies or [])[:60]
    )
    contacts_preview = "\n".join(
        f"- id={row.get('id')} name={row.get('name') or ''} title={row.get('title') or ''} company={row.get('company_name') or ''}"
        for row in (known_contacts or [])[:120]
    )

    prompt = f"""You analyze uploaded business documents and return ONLY a JSON object.

FILENAME: {filename}

DOCUMENT TEXT:
{truncated_text}

KNOWN COMPANIES:
{companies_preview}

KNOWN CONTACTS:
{contacts_preview}

Return JSON with this shape:
{{
  "document_type": "proposal|contract|transcript|meeting_notes|email_thread|linkedin_export|contact_list|invoice|report|other",
  "document_type_confidence": 0.0,
  "summary": "2-4 sentence summary",
  "key_points": ["..."],
  "extracted_entities": {{
    "companies": [{{"name":"", "context":"", "matched_crm_id": null, "match_confidence": 0.0}}],
    "contacts": [{{"name":"", "title":"", "company":"", "role_in_document":"mentioned", "context":"", "matched_crm_id": null, "match_confidence": 0.0}}],
    "dates": [{{"date":"", "context":""}}],
    "amounts": [{{"amount":"", "context":""}}],
    "action_items": ["..."]
  }}
}}
"""

    client = AsyncOpenAI(api_key=api_key)
    try:
        completion = await client.chat.completions.create(
            model=model,
            temperature=0.1,
            messages=[
                {"role": "system", "content": "Return only JSON. No markdown. No prose outside JSON."},
                {"role": "user", "content": prompt},
            ],
        )
    except Exception:
        return None
    content = completion.choices[0].message.content or ""
    parsed = _extract_json_object(content)
    if not parsed:
        return None

    doc_type = _normalize_doc_type(parsed.get("document_type"))
    try:
        confidence = float(parsed.get("document_type_confidence", 0.5))
    except Exception:
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))
    summary = str(parsed.get("summary") or "No summary available.").strip()[:2000]
    key_points = _coerce_list_of_strings(parsed.get("key_points"), limit=10)
    entities = _coerce_entities(parsed.get("extracted_entities"))

    return DocumentAnalysis(
        document_type=doc_type,
        document_type_confidence=round(confidence, 3),
        summary=summary,
        key_points=key_points,
        extracted_entities=entities,
    )


def _analyze_document_fallback(
    extracted_text: str,
    filename: str,
    known_companies: list[dict],
    known_contacts: list[dict],
) -> DocumentAnalysis:
    doc_type, confidence = _classify(filename, extracted_text)
    clean = extracted_text.strip()
    lines = [line.strip() for line in clean.splitlines() if line.strip()]
    summary_seed = " ".join(lines[:4])
    if len(summary_seed) > 420:
        summary_seed = summary_seed[:417] + "..."
    summary = summary_seed or "No summary available."

    key_points = []
    for line in lines[:8]:
        if len(line) > 18:
            key_points.append(line[:160])
        if len(key_points) >= 5:
            break

    companies = _extract_companies(extracted_text)
    for company in companies:
        match_id, match_conf = _match_known(company["name"], known_companies, key="company_name", min_score=0.82)
        company["matched_crm_id"] = match_id
        company["match_confidence"] = round(match_conf, 3)

    contacts = _extract_contacts(extracted_text)
    for contact in contacts:
        match_id, match_conf = _match_known(contact["name"], known_contacts, key="name", min_score=0.9)
        contact["matched_crm_id"] = match_id
        contact["match_confidence"] = round(match_conf, 3)

    entities = {
        "companies": companies,
        "contacts": contacts,
        "dates": _extract_dates(extracted_text),
        "amounts": _extract_amounts(extracted_text),
        "action_items": [line for line in lines if line.lower().startswith(("action", "next step", "todo", "follow up"))][:8],
    }

    return DocumentAnalysis(
        document_type=doc_type if doc_type in _DOC_TYPES else "other",
        document_type_confidence=round(confidence, 3),
        summary=summary,
        key_points=key_points,
        extracted_entities=entities,
    )


async def analyze_document(
    extracted_text: str,
    filename: str,
    known_companies: list[dict],
    known_contacts: list[dict],
) -> DocumentAnalysis:
    llm_result = await _analyze_document_llm(
        extracted_text=extracted_text,
        filename=filename,
        known_companies=known_companies,
        known_contacts=known_contacts,
    )
    if llm_result is not None:
        return llm_result
    return _analyze_document_fallback(extracted_text, filename, known_companies, known_contacts)


def analysis_to_db_payload(analysis: DocumentAnalysis) -> dict[str, str | float]:
    return {
        "document_type": analysis.document_type,
        "document_type_confidence": analysis.document_type_confidence,
        "summary": analysis.summary,
        "key_points": json.dumps(analysis.key_points),
        "extracted_entities": json.dumps(analysis.extracted_entities),
    }
