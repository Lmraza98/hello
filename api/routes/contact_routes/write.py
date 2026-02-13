"""Write/delete endpoints for contacts."""

from datetime import datetime

from fastapi import APIRouter, HTTPException

import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES, require_row_updated
from api.routes.contact_routes.models import (
    ContactClearResponse,
    ContactCreateRequest,
    ContactCreateResponse,
    ContactDeleteResponse,
)

router = APIRouter()


@router.post("", response_model=ContactCreateResponse, responses=COMMON_ERROR_RESPONSES)
async def add_contact(contact: ContactCreateRequest):
    """Add a single contact manually."""
    import re

    name = (contact.name or "").strip()
    company_name = (contact.company_name or "").strip()

    if not name or not company_name:
        raise HTTPException(status_code=400, detail="name and company_name are required")

    domain = contact.domain
    if not domain and company_name:
        domain = re.sub(r"[^\w\s-]", "", company_name.lower())
        domain = re.sub(r"[\s_]+", "-", domain).strip("-")

    salesforce_url = (contact.salesforce_url or "").strip() or None
    salesforce_status = "uploaded" if salesforce_url else None

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO linkedin_contacts
            (company_name, domain, name, title, email_generated, linkedin_url, phone, salesforce_url, salesforce_status, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
            (
                company_name,
                domain,
                name,
                (contact.title or "").strip() or None,
                (contact.email or "").strip() or None,
                (contact.linkedin_url or "").strip() or None,
                (contact.phone or "").strip() or None,
                salesforce_url,
                salesforce_status,
            ),
        )
        new_id = cursor.lastrowid
    db.sync_entity_semantic_index("contact", new_id)

    return {
        "id": new_id,
        "company_name": company_name,
        "domain": domain,
        "name": name,
        "title": contact.title,
        "email": contact.email,
        "linkedin_url": contact.linkedin_url,
        "salesforce_url": salesforce_url,
        "salesforce_status": salesforce_status,
    }


@router.delete("/{contact_id}", response_model=ContactDeleteResponse, responses=COMMON_ERROR_RESPONSES)
def delete_contact(contact_id: int):
    """Delete a single contact by ID."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM linkedin_contacts WHERE id = ?", (contact_id,))
        require_row_updated(cursor.rowcount, "Contact not found")
    db.delete_entity_semantic_index("contact", contact_id)
    return ContactDeleteResponse(deleted=True)


@router.delete("", response_model=ContactClearResponse, responses=COMMON_ERROR_RESPONSES)
def clear_contacts(today_only: bool = False):
    with db.get_db() as conn:
        cursor = conn.cursor()
        ids: list[int] = []
        if today_only:
            cursor.execute(
                "SELECT id FROM linkedin_contacts WHERE DATE(scraped_at) = ?",
                (datetime.now().strftime("%Y-%m-%d"),),
            )
            ids = [row[0] for row in cursor.fetchall()]
        else:
            cursor.execute("SELECT id FROM linkedin_contacts")
            ids = [row[0] for row in cursor.fetchall()]
        if today_only:
            cursor.execute(
                "DELETE FROM linkedin_contacts WHERE DATE(scraped_at) = ?",
                (datetime.now().strftime("%Y-%m-%d"),),
            )
        else:
            cursor.execute("DELETE FROM linkedin_contacts")
        deleted = cursor.rowcount
    for contact_id in ids:
        db.delete_entity_semantic_index("contact", contact_id)
    return ContactClearResponse(deleted=deleted)
