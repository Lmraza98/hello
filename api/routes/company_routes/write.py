"""Write/delete endpoints for companies."""

from datetime import datetime
import re
from typing import Optional

from fastapi import APIRouter, HTTPException

import database as db
from api.models import Company
from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.company_routes.models import (
    CompanyActionResponse,
    CompanyBulkDeleteResponse,
    CompanyDeleteResponse,
    CompanyPendingDeleteResponse,
    CompanyResetResponse,
    CompanySkippedResponse,
)

router = APIRouter()


@router.post("", response_model=Company, responses=COMMON_ERROR_RESPONSES)
def add_company(company: Company):
    domain = company.domain or re.sub(r"[\W_]+", "-", company.company_name.lower()).strip("-")
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO targets (domain, company_name, tier, vertical, target_reason, wedge, source, status)
            VALUES (?, ?, ?, ?, ?, ?, 'ui', 'pending')
            """,
            (
                domain,
                company.company_name,
                company.tier,
                company.vertical,
                company.target_reason,
                company.wedge,
            ),
        )
        company.id = cursor.lastrowid
    db.sync_entity_semantic_index("company", company.id)
    return company


@router.post("/{company_id}/mark-vetted", response_model=CompanyActionResponse, responses=COMMON_ERROR_RESPONSES)
def mark_company_vetted(company_id: int, icp_score: Optional[int] = None):
    """Mark a company as vetted with timestamp and optional ICP score."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        if icp_score is not None:
            cursor.execute(
                "UPDATE targets SET vetted_at = ?, icp_fit_score = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), icp_score, company_id),
            )
        else:
            cursor.execute(
                "UPDATE targets SET vetted_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), company_id),
            )
    db.sync_entity_semantic_index("company", company_id)
    return CompanyActionResponse(success=True)


@router.put("/{company_id}", response_model=Company, responses=COMMON_ERROR_RESPONSES)
def update_company(company_id: int, company: Company):
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE targets
            SET company_name = ?, tier = ?, vertical = ?, target_reason = ?, wedge = ?
            WHERE id = ?
            """,
            (
                company.company_name,
                company.tier,
                company.vertical,
                company.target_reason,
                company.wedge,
                company_id,
            ),
        )
    db.sync_entity_semantic_index("company", company_id)
    return company


@router.delete("/{company_id}", response_model=CompanyDeleteResponse, responses=COMMON_ERROR_RESPONSES)
def delete_company(company_id: int):
    with db.get_db() as conn:
        conn.cursor().execute("DELETE FROM targets WHERE id = ?", (company_id,))
    db.delete_entity_semantic_index("company", company_id)
    return CompanyDeleteResponse(deleted=True)


@router.post("/bulk-delete", response_model=CompanyBulkDeleteResponse, responses=COMMON_ERROR_RESPONSES)
def bulk_delete_companies(company_ids: list[int]):
    """Delete multiple companies by their IDs."""
    if not company_ids:
        raise HTTPException(status_code=400, detail="No company IDs provided")

    try:
        with db.get_db() as conn:
            cursor = conn.cursor()
            placeholders = ",".join(["?"] * len(company_ids))
            cursor.execute(f"DELETE FROM targets WHERE id IN ({placeholders})", company_ids)
            deleted_count = cursor.rowcount
        for company_id in company_ids:
            db.delete_entity_semantic_index("company", company_id)

        return CompanyBulkDeleteResponse(
            success=True,
            deleted=deleted_count,
            message=f'Deleted {deleted_count} compan{"y" if deleted_count == 1 else "ies"}',
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/reset", response_model=CompanyResetResponse, responses=COMMON_ERROR_RESPONSES)
def reset_companies():
    """Reset all companies back to pending status."""
    with db.get_db() as conn:
        conn.cursor().execute("UPDATE targets SET status = 'pending'")
    return CompanyResetResponse(reset=True)


@router.post("/skip-pending", response_model=CompanySkippedResponse, responses=COMMON_ERROR_RESPONSES)
def skip_pending_companies():
    """Mark all pending companies as skipped (won't be processed in next run)."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE targets SET status = 'skipped' WHERE status = 'pending'")
        count = cursor.rowcount
    return CompanySkippedResponse(skipped=count)


@router.delete("/pending", response_model=CompanyPendingDeleteResponse, responses=COMMON_ERROR_RESPONSES)
def clear_pending_companies():
    """Delete all pending companies from the queue."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM targets WHERE status = 'pending'")
        pending_ids = [row[0] for row in cursor.fetchall()]
        cursor.execute("DELETE FROM targets WHERE status = 'pending'")
        count = cursor.rowcount
    for company_id in pending_ids:
        db.delete_entity_semantic_index("company", company_id)
    return CompanyPendingDeleteResponse(deleted=count)
