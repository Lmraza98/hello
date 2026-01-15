"""
Statistics endpoints.
"""
from datetime import datetime
from fastapi import APIRouter

import database as db

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
def get_stats():
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT COUNT(*) FROM targets WHERE company_name IS NOT NULL")
            total_companies = cursor.fetchone()[0]
        except:
            total_companies = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
            total_contacts = cursor.fetchone()[0]
        except:
            total_contacts = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE email_generated IS NOT NULL AND email_generated != ''")
            contacts_with_email = cursor.fetchone()[0]
        except:
            contacts_with_email = 0
        
        try:
            today = datetime.now().strftime('%Y-%m-%d')
            cursor.execute(f"SELECT COUNT(*) FROM linkedin_contacts WHERE DATE(scraped_at) = '{today}'")
            contacts_today = cursor.fetchone()[0]
        except:
            contacts_today = 0
    
    return {
        "total_companies": total_companies,
        "total_contacts": total_contacts,
        "contacts_with_email": contacts_with_email,
        "contacts_today": contacts_today
    }


