"""Phone discovery helpers.

This module provides a minimal, DB-backed phone discovery implementation used by
CLI and API workflows.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, List, Optional

import database as db


_PHONE_PATTERN = re.compile(r"(?:\+?\d[\d\-\s().]{7,}\d)")


def _extract_phone_candidates(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        values = [str(item).strip() for item in raw if str(item).strip()]
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                values = [str(item).strip() for item in parsed if str(item).strip()]
            else:
                values = [text]
        except Exception:
            values = [text]
    else:
        values = [str(raw).strip()]

    candidates: List[str] = []
    for value in values:
        for match in _PHONE_PATTERN.findall(value):
            normalized = re.sub(r"\s+", " ", match).strip()
            if normalized and normalized not in candidates:
                candidates.append(normalized)
    return candidates


async def discover_phone_parallel(
    *,
    name: str,
    company: str,
    domain: str | None = None,
    email: str | None = None,
    linkedin_url: str | None = None,
) -> Optional[Dict[str, Any]]:
    """Best-effort discovery from already-crawled page artifacts.

    Returns a payload compatible with existing callers:
    {"phone": str, "source": str, "confidence": float}
    """
    del name, company, email, linkedin_url

    with db.get_db() as conn:
        cursor = conn.cursor()
        if domain:
            cursor.execute(
                """
                SELECT phones_found
                FROM pages
                WHERE domain = ?
                  AND phones_found IS NOT NULL
                  AND phones_found != ''
                ORDER BY fetched_at DESC, id DESC
                LIMIT 30
                """,
                (domain,),
            )
        else:
            cursor.execute(
                """
                SELECT phones_found
                FROM pages
                WHERE phones_found IS NOT NULL
                  AND phones_found != ''
                ORDER BY fetched_at DESC, id DESC
                LIMIT 30
                """
            )
        rows = cursor.fetchall()

    for row in rows:
        phones = _extract_phone_candidates(row["phones_found"])
        if phones:
            return {"phone": phones[0], "source": "pages", "confidence": 0.5}
    return None


async def process_linkedin_contacts_for_phones(*, today_only: bool = False, max_workers: int = 5) -> Dict[str, int]:
    """Attempt phone discovery for LinkedIn contacts without a phone value."""
    del max_workers

    with db.get_db() as conn:
        cursor = conn.cursor()
        base_query = """
            SELECT id, name, company_name, domain, email_generated, linkedin_url
            FROM linkedin_contacts
            WHERE phone IS NULL OR phone = ''
        """
        params: List[Any] = []
        if today_only:
            base_query += " AND DATE(scraped_at) = DATE('now')"
        cursor.execute(base_query, params)
        contacts = [dict(row) for row in cursor.fetchall()]

    updated = 0
    found = 0

    for contact in contacts:
        result = await discover_phone_parallel(
            name=contact.get("name", ""),
            company=contact.get("company_name", ""),
            domain=contact.get("domain"),
            email=contact.get("email_generated"),
            linkedin_url=contact.get("linkedin_url"),
        )
        if not result or not result.get("phone"):
            continue

        found += 1
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE linkedin_contacts
                SET phone = ?,
                    phone_source = ?,
                    phone_confidence = ?
                WHERE id = ?
                """,
                (
                    result["phone"],
                    str(result.get("source") or "discovered"),
                    int(float(result.get("confidence") or 0.5) * 100),
                    int(contact["id"]),
                ),
            )
            updated += int(cursor.rowcount)

        await asyncio.sleep(0)

    return {"total": len(contacts), "found": found, "updated": updated}

