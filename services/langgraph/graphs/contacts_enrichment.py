from __future__ import annotations

from typing import Any, TypedDict

import database
from langgraph.graph import StateGraph, END

from services.email.discovery.pipeline import discover_email_pattern
from services.email.discovery.generation import generate_email


class ContactsEnrichmentInput(TypedDict, total=False):
    contact_ids: list[int]
    contact_filter: str
    dry_run: bool


class ContactsEnrichmentProgress(TypedDict, total=False):
    total: int
    completed: int
    failed: int
    updated: int
    skipped: int


class ContactsEnrichmentResults(TypedDict, total=False):
    enriched_titles: int
    found_emails: int
    skipped: int
    failed: int


class ContactsEnrichmentState(TypedDict, total=False):
    input: ContactsEnrichmentInput
    contacts: list[dict[str, Any]]
    updates: list[dict[str, Any]]
    progress: ContactsEnrichmentProgress
    results: ContactsEnrichmentResults


def _parse_filter(filter_str: str) -> tuple[str, Any] | None:
    if not filter_str:
        return None
    if filter_str.startswith("has_email="):
        val = filter_str.split("=", 1)[1].strip().lower()
        return ("has_email", val == "true" or val == "1" or val == "yes")
    if filter_str.startswith("campaign_id="):
        val = filter_str.split("=", 1)[1].strip()
        if val.isdigit():
            return ("campaign_id", int(val))
    return None


def _fetch_contacts(input_payload: ContactsEnrichmentInput) -> list[dict[str, Any]]:
    conn = database.get_connection()
    cursor = conn.cursor()

    if input_payload.get("contact_ids"):
        placeholders = ",".join("?" for _ in input_payload["contact_ids"])
        cursor.execute(
            f"SELECT * FROM linkedin_contacts WHERE id IN ({placeholders})",
            input_payload["contact_ids"],
        )
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]

    filter_str = input_payload.get("contact_filter") or ""
    parsed = _parse_filter(filter_str)
    if parsed:
        key, value = parsed
        if key == "has_email":
            if value:
                cursor.execute("SELECT * FROM linkedin_contacts WHERE email_generated IS NOT NULL")
            else:
                cursor.execute("SELECT * FROM linkedin_contacts WHERE email_generated IS NULL")
        elif key == "campaign_id":
            cursor.execute(
                """
                SELECT lc.*
                FROM campaign_contacts cc
                JOIN linkedin_contacts lc ON cc.contact_id = lc.id
                WHERE cc.campaign_id = ?
                """,
                (value,),
            )
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]

    cursor.execute("SELECT * FROM linkedin_contacts ORDER BY scraped_at DESC LIMIT 100")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def _resolve_inputs(state: ContactsEnrichmentState) -> ContactsEnrichmentState:
    raw = state.get("input") or {}
    normalized: ContactsEnrichmentInput = {
        "contact_ids": raw.get("contact_ids") or [],
        "contact_filter": raw.get("contact_filter") or "",
        "dry_run": bool(raw.get("dry_run")) if "dry_run" in raw else False,
    }
    return {**state, "input": normalized}


def _load_contacts(state: ContactsEnrichmentState) -> ContactsEnrichmentState:
    input_payload = state.get("input") or {}
    contacts = _fetch_contacts(input_payload)
    progress: ContactsEnrichmentProgress = {
        "total": len(contacts),
        "completed": 0,
        "failed": 0,
        "updated": 0,
        "skipped": 0,
    }
    return {**state, "contacts": contacts, "progress": progress}


def _enrich_contacts(state: ContactsEnrichmentState) -> ContactsEnrichmentState:
    contacts = state.get("contacts") or []
    progress = dict(state.get("progress") or {})
    results: ContactsEnrichmentResults = dict(state.get("results") or {})
    updates: list[dict[str, Any]] = []

    pattern_cache: dict[str, dict[str, Any]] = {}

    for contact in contacts:
        contact_id = contact.get("id")
        updated = False
        try:
            email = contact.get("email_generated")
            if not email:
                company_name = (contact.get("company_name") or "").strip()
                domain = (contact.get("domain") or "").strip()
                key = domain or company_name
                pattern_info = None
                if key in pattern_cache:
                    pattern_info = pattern_cache[key]
                elif company_name or domain:
                    try:
                        pattern_info = discover_email_pattern(company_name or domain, domain)
                        pattern_cache[key] = pattern_info
                    except Exception:
                        pattern_info = None

                if pattern_info and pattern_info.get("pattern"):
                    pattern = pattern_info.get("pattern")
                    resolved_domain = pattern_info.get("domain") or domain
                    generated = generate_email(contact.get("name") or "", pattern, resolved_domain or "")
                    if generated:
                        updates.append(
                            {
                                "id": contact_id,
                                "email_generated": generated,
                                "email_pattern": pattern,
                                "email_confidence": pattern_info.get("confidence"),
                                "domain": resolved_domain or domain,
                            }
                        )
                        updated = True
                        results["found_emails"] = results.get("found_emails", 0) + 1

            if updated:
                progress["updated"] = progress.get("updated", 0) + 1
            else:
                progress["skipped"] = progress.get("skipped", 0) + 1

            progress["completed"] = progress.get("completed", 0) + 1
        except Exception:
            progress["failed"] = progress.get("failed", 0) + 1
            results["failed"] = results.get("failed", 0) + 1

    results.setdefault("enriched_titles", 0)
    results.setdefault("found_emails", results.get("found_emails", 0))
    results.setdefault("skipped", progress.get("skipped", 0))

    return {**state, "updates": updates, "progress": progress, "results": results}


def _persist_updates(state: ContactsEnrichmentState) -> ContactsEnrichmentState:
    input_payload = state.get("input") or {}
    if input_payload.get("dry_run"):
        return state

    updates = state.get("updates") or []
    if not updates:
        return state

    conn = database.get_connection()
    cursor = conn.cursor()
    for row in updates:
        cursor.execute(
            """
            UPDATE linkedin_contacts
            SET email_generated = ?,
                email_pattern = COALESCE(?, email_pattern),
                email_confidence = COALESCE(?, email_confidence),
                domain = COALESCE(NULLIF(?, ''), domain)
            WHERE id = ?
            """,
            (
                row.get("email_generated"),
                row.get("email_pattern"),
                row.get("email_confidence"),
                row.get("domain"),
                row.get("id"),
            ),
        )
    conn.commit()
    conn.close()
    return state


def _summarize(state: ContactsEnrichmentState) -> ContactsEnrichmentState:
    results = dict(state.get("results") or {})
    progress = state.get("progress") or {}
    results.setdefault("failed", progress.get("failed", 0))
    results.setdefault("skipped", progress.get("skipped", 0))
    return {**state, "results": results}


def build_contacts_enrichment_graph():
    graph = StateGraph(ContactsEnrichmentState)
    graph.add_node("resolve_inputs", _resolve_inputs)
    graph.add_node("load_contacts", _load_contacts)
    graph.add_node("enrich_contacts", _enrich_contacts)
    graph.add_node("persist_updates", _persist_updates)
    graph.add_node("summarize", _summarize)

    graph.set_entry_point("resolve_inputs")
    graph.add_edge("resolve_inputs", "load_contacts")
    graph.add_edge("load_contacts", "enrich_contacts")
    graph.add_edge("enrich_contacts", "persist_updates")
    graph.add_edge("persist_updates", "summarize")
    graph.add_edge("summarize", END)

    return graph.compile()
