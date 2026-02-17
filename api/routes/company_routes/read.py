"""Read endpoints for companies."""

import logging
from typing import Optional

from fastapi import APIRouter

import database as db
from api.models import Company
from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.company_routes.models import CompanyBiProfileResponse, CompanyLookupResponse, CompanyPendingCountResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=list[Company], responses=COMMON_ERROR_RESPONSES)
def get_companies(
    tier: Optional[str] = None,
    q: Optional[str] = None,
    company_name: Optional[str] = None,
    vertical: Optional[str] = None,
):
    with db.get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(targets)")
            cols = {row[1] for row in cursor.fetchall()}
            has_vertical = "vertical" in cols
            has_target_reason = "target_reason" in cols
            has_wedge = "wedge" in cols

            query = (
                "SELECT id, company_name, domain, tier, vertical, target_reason, wedge, status "
                "FROM targets WHERE company_name IS NOT NULL"
            )
            params = []
            if tier:
                query += " AND tier = ?"
                params.append(tier)
            if company_name:
                query += " AND LOWER(company_name) LIKE LOWER(?)"
                params.append(f"%{company_name}%")
            if vertical and has_vertical:
                query += " AND LOWER(vertical) LIKE LOWER(?)"
                params.append(f"%{vertical}%")
            if q:
                like = f"%{q}%"
                q_clauses = ["LOWER(company_name) LIKE LOWER(?)", "LOWER(domain) LIKE LOWER(?)"]
                q_params = [like, like]
                if has_vertical:
                    q_clauses.append("LOWER(vertical) LIKE LOWER(?)")
                    q_params.append(like)
                if has_target_reason:
                    q_clauses.append("LOWER(target_reason) LIKE LOWER(?)")
                    q_params.append(like)
                if has_wedge:
                    q_clauses.append("LOWER(wedge) LIKE LOWER(?)")
                    q_params.append(like)
                query += f" AND ({' OR '.join(q_clauses)})"
                params.extend(q_params)
            query += " ORDER BY tier, company_name"
            cursor.execute(query, params)
            rows = cursor.fetchall()
        except Exception as exc:
            logger.exception("Failed to query companies (tier=%s, q=%s, company_name=%s, vertical=%s)", tier, q, company_name, vertical)
            raise HTTPException(status_code=500, detail=f"Failed to query companies: {exc}") from exc

    return [
        {
            "id": row[0],
            "company_name": row[1],
            "domain": row[2],
            "tier": row[3],
            "vertical": row[4],
            "target_reason": row[5],
            "wedge": row[6],
            "status": row[7] if len(row) > 7 else "pending",
        }
        for row in rows
    ]


@router.post("/lookup-existing", response_model=CompanyLookupResponse, responses=COMMON_ERROR_RESPONSES)
def lookup_existing_companies(company_names: list[str]):
    """
    Look up which company names already exist in the database.
    Returns existing info + contact counts for each match.
    """
    if not company_names:
        return {}

    results = {}
    with db.get_db() as conn:
        cursor = conn.cursor()
        for name in company_names:
            cursor.execute(
                """
                SELECT
                    t.id,
                    t.company_name,
                    t.status,
                    t.vetted_at,
                    t.icp_fit_score,
                    (
                        SELECT COUNT(*)
                        FROM linkedin_contacts lc
                        WHERE LOWER(lc.company_name) = LOWER(t.company_name)
                    ) AS contact_count
                FROM targets t
                WHERE LOWER(t.company_name) = LOWER(?)
                LIMIT 1
                """,
                (name,),
            )
            row = cursor.fetchone()
            if row:
                results[name.lower()] = {
                    "id": row[0],
                    "company_name": row[1],
                    "status": row[2],
                    "vetted_at": row[3],
                    "icp_fit_score": row[4],
                    "contact_count": row[5],
                }
    return results


@router.get("/pending-count", response_model=CompanyPendingCountResponse, responses=COMMON_ERROR_RESPONSES)
def get_pending_count():
    """Get count of pending companies."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM targets WHERE status = 'pending'")
        count = cursor.fetchone()[0]
    return {"pending": count}


@router.get("/{company_id}/bi-profile", response_model=CompanyBiProfileResponse, responses=COMMON_ERROR_RESPONSES)
def get_company_bi_profile(company_id: int):
    # Return an empty profile instead of 404 so the UI can render gracefully
    # even when a row was deleted or the id is stale.
    return db.get_company_bi_profile(company_id)
