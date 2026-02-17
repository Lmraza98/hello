"""Read endpoints for stats."""

from datetime import datetime

from fastapi import APIRouter

import database as db
from api.models import Stats

router = APIRouter()


@router.get("", response_model=Stats)
def get_stats():
    with db.get_db() as conn:
        cursor = conn.cursor()

        try:
            cursor.execute("SELECT COUNT(*) FROM targets WHERE company_name IS NOT NULL")
            total_companies = cursor.fetchone()[0]
        except Exception:
            total_companies = 0

        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
            total_contacts = cursor.fetchone()[0]
        except Exception:
            total_contacts = 0

        try:
            cursor.execute(
                "SELECT COUNT(*) FROM linkedin_contacts WHERE email_generated IS NOT NULL AND email_generated != ''"
            )
            contacts_with_email = cursor.fetchone()[0]
        except Exception:
            contacts_with_email = 0

        try:
            today = datetime.now().strftime("%Y-%m-%d")
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE DATE(scraped_at) = ?", (today,))
            contacts_today = cursor.fetchone()[0]
        except Exception:
            contacts_today = 0

    return {
        "total_companies": total_companies,
        "total_contacts": total_contacts,
        "contacts_with_email": contacts_with_email,
        "contacts_today": contacts_today,
    }

