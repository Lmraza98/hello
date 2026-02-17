"""
Outreach workflow service — resolve contacts and enroll-and-draft.

Combines contact search (DB + SalesNav), optional contact creation,
campaign enrollment, and email draft generation into two atomic operations.
"""

from typing import Any, Dict, List, Optional

import database as db


# ---------------------------------------------------------------------------
# resolve_contact: search DB + SalesNav for a person, return candidates
# ---------------------------------------------------------------------------

async def resolve_contact(
    name: str,
    company: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Look up a contact by name (and optionally company) across the local
    database and Sales Navigator.

    Returns:
        {
          "found_in_db": [ ... ],
          "found_in_salesnav": [ ... ],
          "best_match": { ... } | None
        }
    """
    found_in_db: List[Dict[str, Any]] = []
    found_in_salesnav: List[Dict[str, Any]] = []

    # --- Local DB search ---
    try:
        with db.get_db() as conn:
            cursor = conn.cursor()
            like_name = f"%{name}%"
            if company:
                like_company = f"%{company}%"
                cursor.execute(
                    """
                    SELECT id, name, title, company_name, domain,
                           email_generated AS email, linkedin_url, phone
                    FROM linkedin_contacts
                    WHERE name LIKE ? COLLATE NOCASE
                      AND company_name LIKE ? COLLATE NOCASE
                    ORDER BY scraped_at DESC
                    LIMIT 10
                    """,
                    (like_name, like_company),
                )
            else:
                cursor.execute(
                    """
                    SELECT id, name, title, company_name, domain,
                           email_generated AS email, linkedin_url, phone
                    FROM linkedin_contacts
                    WHERE name LIKE ? COLLATE NOCASE
                    ORDER BY scraped_at DESC
                    LIMIT 10
                    """,
                    (like_name,),
                )
            found_in_db = [dict(row) for row in cursor.fetchall()]
    except Exception:
        pass

    # --- SalesNav search (browser automation) ---
    try:
        parts = name.strip().split()
        first_name = parts[0] if parts else name
        last_name = parts[-1] if len(parts) > 1 else ""

        from api.routes.salesnav_routes.people import salesnav_person_search
        from api.routes.salesnav_routes.models import SalesNavSearchRequest

        request = SalesNavSearchRequest(
            first_name=first_name,
            last_name=last_name,
            company=company,
            max_results=5,
        )
        result = await salesnav_person_search(request)
        if result.success:
            found_in_salesnav = [p.model_dump() for p in result.profiles]
    except Exception:
        pass

    # --- Pick best match ---
    best_match = None
    if found_in_db:
        best_match = found_in_db[0]
        best_match["source"] = "database"
    elif found_in_salesnav:
        best_match = found_in_salesnav[0]
        best_match["source"] = "salesnav"

    return {
        "found_in_db": found_in_db,
        "found_in_salesnav": found_in_salesnav,
        "best_match": best_match,
    }


# ---------------------------------------------------------------------------
# enroll_and_draft: create contact if needed, enroll, generate email draft
# ---------------------------------------------------------------------------

async def enroll_and_draft(
    campaign_id: int,
    contact_id: Optional[int] = None,
    create_if_missing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Enroll a contact in a campaign and generate an email draft.

    If ``contact_id`` is None and ``create_if_missing`` is provided, a new
    contact is created first.

    Returns:
        {
          "contact_id": int,
          "enrolled": bool,
          "already_enrolled": bool,
          "email_draft": { "id": ..., "subject": ..., "body": ... } | None
        }
    """
    # --- Ensure contact exists ---
    if contact_id is None and create_if_missing:
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO linkedin_contacts
                    (company_name, domain, name, title, email_generated,
                     linkedin_url, phone, scraped_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    create_if_missing.get("company_name", ""),
                    create_if_missing.get("domain"),
                    create_if_missing.get("name", ""),
                    create_if_missing.get("title"),
                    create_if_missing.get("email"),
                    create_if_missing.get("linkedin_url"),
                    create_if_missing.get("phone"),
                ),
            )
            contact_id = cursor.lastrowid

    if contact_id is None:
        return {
            "contact_id": None,
            "enrolled": False,
            "already_enrolled": False,
            "email_draft": None,
            "error": "No contact_id and no create_if_missing data provided",
        }

    # --- Verify campaign exists ---
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        return {
            "contact_id": contact_id,
            "enrolled": False,
            "already_enrolled": False,
            "email_draft": None,
            "error": f"Campaign {campaign_id} not found",
        }

    # --- Enroll ---
    result = db.enroll_contacts_in_campaign(campaign_id, [contact_id])
    enrolled = result.get("enrolled", 0) > 0
    already_enrolled = result.get("skipped", 0) > 0

    # --- Generate email draft ---
    email_draft = None
    try:
        templates = db.get_email_templates(campaign_id)
        if templates:
            template = templates[0]
            with db.get_db() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT name, title, company_name, domain, email_generated AS email
                    FROM linkedin_contacts WHERE id = ?
                    """,
                    (contact_id,),
                )
                row = cursor.fetchone()
                if row:
                    contact_data = dict(row)
                    from services.email.generator import generate_email_with_gpt4o

                    campaign_data = {
                        "title": campaign["name"],
                        "description": campaign.get("description"),
                        "subject_template": template["subject_template"],
                        "body_template": template["body_template"],
                    }
                    subject, body = generate_email_with_gpt4o(campaign_data, contact_data)
                    email_draft = {
                        "subject": subject,
                        "body": body,
                        "contact_name": contact_data.get("name"),
                        "company_name": contact_data.get("company_name"),
                    }
    except Exception as exc:
        email_draft = {"error": str(exc)}

    return {
        "contact_id": contact_id,
        "enrolled": enrolled,
        "already_enrolled": already_enrolled,
        "email_draft": email_draft,
    }
