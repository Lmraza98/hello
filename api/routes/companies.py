"""
Company management endpoints.
"""
import re
import csv
import io
import asyncio
from typing import Optional
from fastapi import APIRouter, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel

import database as db
from api.models import Company
from services.company_collector import collect_companies_from_query

router = APIRouter(prefix="/api/companies", tags=["companies"])


@router.get("")
def get_companies(tier: Optional[str] = None):
    with db.get_db() as conn:
        cursor = conn.cursor()
        try:
            query = "SELECT id, company_name, domain, tier, vertical, target_reason, wedge, status FROM targets WHERE company_name IS NOT NULL"
            params = []
            if tier:
                query += " AND tier = ?"
                params.append(tier)
            query += " ORDER BY tier, company_name"
            cursor.execute(query, params)
            rows = cursor.fetchall()
        except:
            rows = []
    
    return [
        {
            "id": r[0], "company_name": r[1], "domain": r[2], "tier": r[3],
            "vertical": r[4], "target_reason": r[5], "wedge": r[6],
            "status": r[7] if len(r) > 7 else "pending"
        }
        for r in rows
    ]


@router.post("")
def add_company(company: Company):
    domain = company.domain or re.sub(r'[\W_]+', '-', company.company_name.lower()).strip('-')
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO targets (domain, company_name, tier, vertical, target_reason, wedge, source, status) VALUES (?, ?, ?, ?, ?, ?, 'ui', 'pending')",
            (domain, company.company_name, company.tier, company.vertical, company.target_reason, company.wedge)
        )
        company.id = cursor.lastrowid
    return company


@router.put("/{company_id}")
def update_company(company_id: int, company: Company):
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE targets SET company_name=?, tier=?, vertical=?, target_reason=?, wedge=? WHERE id=?",
            (company.company_name, company.tier, company.vertical, company.target_reason, company.wedge, company_id)
        )
    return company


@router.delete("/{company_id}")
def delete_company(company_id: int):
    with db.get_db() as conn:
        conn.cursor().execute("DELETE FROM targets WHERE id = ?", (company_id,))
    return {"deleted": True}


@router.post("/import")
async def import_companies(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode('utf-8')
    reader = csv.DictReader(io.StringIO(text))
    imported = 0
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        for row in reader:
            company_name = row.get('Company', '').strip()
            if not company_name:
                continue
            domain = re.sub(r'[\W_]+', '-', company_name.lower()).strip('-')
            cursor.execute(
                "INSERT OR REPLACE INTO targets (domain, company_name, tier, vertical, target_reason, wedge, source, status) VALUES (?, ?, ?, ?, ?, ?, 'csv', 'pending')",
                (domain, company_name, row.get('Tier', '').strip(), row.get('Vertical', '').strip(),
                 row.get('Why this is a good Zco target', '').strip(), row.get('Zco wedge', '').strip())
            )
            imported += 1
    return {"imported": imported}


@router.post("/reset")
def reset_companies():
    """Reset all companies back to pending status."""
    with db.get_db() as conn:
        conn.cursor().execute("UPDATE targets SET status = 'pending'")
    return {"reset": True}


@router.post("/skip-pending")
def skip_pending_companies():
    """Mark all pending companies as skipped (won't be processed in next run)."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE targets SET status = 'skipped' WHERE status = 'pending'")
        count = cursor.rowcount
    return {"skipped": count}


@router.delete("/pending")
def clear_pending_companies():
    """Delete all pending companies from the queue."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM targets WHERE status = 'pending'")
        count = cursor.rowcount
    return {"deleted": count}


@router.get("/pending-count")
def get_pending_count():
    """Get count of pending companies."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM targets WHERE status = 'pending'")
        count = cursor.fetchone()[0]
    return {"pending": count}


class CompanyCollectionRequest(BaseModel):
    query: str
    max_companies: int = 100
    save_to_db: bool = True


@router.post("/collect")
async def collect_companies(request: CompanyCollectionRequest, background_tasks: BackgroundTasks):
    """
    Automatically collect companies from LinkedIn Sales Navigator using a natural language query.
    
    Example queries:
    - "Construction companies in New England"
    - "Technology companies in California with 50-200 employees"
    - "Healthcare companies in Texas"
    
    This endpoint:
    1. Uses GPT-4 to parse the query into Sales Navigator filters
    2. Navigates to Sales Navigator Account search
    3. Applies the filters
    4. Scrapes company results
    5. Optionally saves to database
    """
    try:
        result = await collect_companies_from_query(
            query=request.query,
            max_companies=request.max_companies,
            headless=False,  # Keep visible for debugging
            save_to_db=request.save_to_db
        )
        return result
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "companies": [],
            "query": request.query
        }

