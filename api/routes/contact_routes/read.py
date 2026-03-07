"""Read and export endpoints for contacts."""

import csv
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import config
import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES, not_found
from api.routes.contact_routes.models import ContactRecord

router = APIRouter()


def _compute_engagement_status(
    salesforce_status: Optional[str],
    salesforce_url: Optional[str],
    snapshot: dict,
) -> str:
    reply_count = int(snapshot.get("reply_count") or 0)
    latest_sent_status = str(snapshot.get("latest_sent_status") or "").strip().lower()
    has_completed = bool(snapshot.get("has_completed"))
    has_upcoming = bool(snapshot.get("has_upcoming"))
    has_active = bool(snapshot.get("has_active"))
    enroll_count = int(snapshot.get("enroll_count") or 0)
    sent_count = int(snapshot.get("sent_count") or 0)

    if reply_count > 0:
        return "replied"
    if latest_sent_status.startswith("failed"):
        return "failed"
    if has_completed:
        return "completed"
    if has_upcoming:
        return "scheduled"
    if has_active and sent_count > 0:
        return "in_sequence"
    if enroll_count > 0:
        return "enrolled"
    if (salesforce_url or "").strip():
        return "synced"

    sf = (salesforce_status or "").strip().lower()
    if sf in {"uploaded", "completed"}:
        return "synced"
    if sf in {"pending", "queued", "checking"}:
        return "needs_sync"
    return "needs_sync"


def _load_engagement_snapshots(cursor, contact_ids: list[int]) -> dict[int, dict]:
    if not contact_ids:
        return {}

    placeholders = ",".join(["?"] * len(contact_ids))
    snapshots: dict[int, dict] = {int(cid): {} for cid in contact_ids}

    cursor.execute(
        f"""
        SELECT
            contact_id,
            COUNT(*) AS enroll_count,
            MAX(CASE WHEN lower(COALESCE(status, '')) = 'active' THEN 1 ELSE 0 END) AS has_active,
            MAX(CASE WHEN lower(COALESCE(status, '')) = 'completed' THEN 1 ELSE 0 END) AS has_completed,
            MAX(
                CASE
                    WHEN lower(COALESCE(status, '')) = 'active'
                     AND COALESCE(NULLIF(next_email_at, ''), '') <> ''
                    THEN 1 ELSE 0
                END
            ) AS has_upcoming
        FROM campaign_contacts
        WHERE contact_id IN ({placeholders})
        GROUP BY contact_id
        """,
        contact_ids,
    )
    for row in cursor.fetchall():
        cid = int(row["contact_id"])
        snapshots.setdefault(cid, {}).update(
            {
                "enroll_count": int(row["enroll_count"] or 0),
                "has_active": int(row["has_active"] or 0) == 1,
                "has_completed": int(row["has_completed"] or 0) == 1,
                "has_upcoming": int(row["has_upcoming"] or 0) == 1,
            }
        )

    cursor.execute(
        f"""
        SELECT
            contact_id,
            SUM(CASE WHEN lower(COALESCE(review_status, '')) = 'sent' THEN 1 ELSE 0 END) AS sent_count,
            (
                SELECT lower(COALESCE(se2.review_status, se2.status, ''))
                FROM sent_emails se2
                WHERE se2.contact_id = se.contact_id
                ORDER BY datetime(COALESCE(se2.sent_at, se2.scheduled_send_time)) DESC, se2.id DESC
                LIMIT 1
            ) AS latest_sent_status
        FROM sent_emails se
        WHERE contact_id IN ({placeholders})
        GROUP BY contact_id
        """,
        contact_ids,
    )
    for row in cursor.fetchall():
        cid = int(row["contact_id"])
        snapshots.setdefault(cid, {}).update(
            {
                "sent_count": int(row["sent_count"] or 0),
                "latest_sent_status": row["latest_sent_status"] or "",
            }
        )

    cursor.execute(
        f"""
        SELECT
            se.contact_id AS contact_id,
            COUNT(*) AS reply_count
        FROM email_replies er
        JOIN sent_emails se ON se.id = er.sent_email_id
        WHERE se.contact_id IN ({placeholders})
        GROUP BY se.contact_id
        """,
        contact_ids,
    )
    for row in cursor.fetchall():
        cid = int(row["contact_id"])
        snapshots.setdefault(cid, {}).update({"reply_count": int(row["reply_count"] or 0)})

    return snapshots


@router.get("", response_model=list[ContactRecord], responses=COMMON_ERROR_RESPONSES)
def get_contacts(
    query: Optional[str] = None,
    company: Optional[str] = None,
    name: Optional[str] = None,
    has_email: Optional[bool] = None,
    today_only: bool = False,
    vertical: Optional[str] = None,
):
    try:
        conn = db.get_connection()
        cursor = conn.cursor()

        cursor.execute("PRAGMA table_info(linkedin_contacts)")
        columns = [row[1] for row in cursor.fetchall()]
        has_phone = "phone" in columns
        has_location = "location" in columns
        has_salesforce = "salesforce_status" in columns
        has_salesforce_sync = "salesforce_sync_status" in columns
        has_salesforce_url = "salesforce_url" in columns
        has_salesforce_uploaded_at = "salesforce_uploaded_at" in columns
        has_salesforce_upload_batch = "salesforce_upload_batch" in columns
        has_lead_source = "lead_source" in columns
        has_ingest_batch_id = "ingest_batch_id" in columns

        select_fields = [
            "lc.id",
            "lc.company_name",
            "lc.domain",
            "lc.name",
            "lc.title",
            "lc.email_generated",
            "lc.linkedin_url",
            "t.vertical",
        ]
        if has_location:
            select_fields.append("lc.location")

        has_email_pattern = "email_pattern" in columns
        has_email_confidence = "email_confidence" in columns
        has_email_verified = "email_verified" in columns
        if has_email_pattern:
            select_fields.append("lc.email_pattern")
        if has_email_confidence:
            select_fields.append("lc.email_confidence")
        if has_email_verified:
            select_fields.append("lc.email_verified")
        if has_phone:
            select_fields.extend(["lc.phone", "lc.phone_source", "lc.phone_confidence"])
        if has_salesforce:
            select_fields.append("lc.salesforce_status")
        if has_salesforce_sync:
            select_fields.append("lc.salesforce_sync_status")
        if has_salesforce_url:
            select_fields.append("lc.salesforce_url")
        if has_salesforce_uploaded_at:
            select_fields.append("lc.salesforce_uploaded_at")
        if has_salesforce_upload_batch:
            select_fields.append("lc.salesforce_upload_batch")
        if has_lead_source:
            select_fields.append("lc.lead_source")
        if has_ingest_batch_id:
            select_fields.append("lc.ingest_batch_id")
        select_fields.append("lc.scraped_at")

        sql_query = f"""SELECT {', '.join(select_fields)}
                    FROM linkedin_contacts lc
                    LEFT JOIN targets t ON TRIM(LOWER(lc.company_name)) = TRIM(LOWER(t.company_name))
                    WHERE 1=1"""
        params = []

        if company:
            sql_query += " AND lc.company_name LIKE ?"
            params.append(f"%{company}%")
        if name:
            sql_query += " AND lc.name LIKE ?"
            params.append(f"%{name}%")
        if has_email is True:
            sql_query += " AND lc.email_generated IS NOT NULL AND lc.email_generated != ''"
        elif has_email is False:
            sql_query += " AND (lc.email_generated IS NULL OR lc.email_generated = '')"
        if today_only:
            sql_query += " AND DATE(lc.scraped_at) = ?"
            params.append(datetime.now().strftime("%Y-%m-%d"))
        if vertical:
            sql_query += " AND TRIM(t.vertical) LIKE ? COLLATE NOCASE"
            params.append(f"%{vertical.strip()}%")

        # Free-text query: search across company_name, name, title,
        # vertical, and domain.  This is the primary way to find contacts
        # by industry/category (e.g. "banks" matches "TD Bank" in
        # company_name, "Banking" in title, "Banking Services" in vertical).
        if query:
            q = query.strip()
            if q:
                like = f"%{q}%"
                sql_query += (
                    " AND ("
                    "lc.company_name LIKE ? COLLATE NOCASE OR "
                    "lc.name LIKE ? COLLATE NOCASE OR "
                    "lc.title LIKE ? COLLATE NOCASE OR "
                    "lc.domain LIKE ? COLLATE NOCASE OR "
                    "COALESCE(t.vertical, '') LIKE ? COLLATE NOCASE"
                    ")"
                )
                params.extend([like, like, like, like, like])

        sql_query += " ORDER BY lc.scraped_at DESC"
        cursor.execute(sql_query, params)
        rows = cursor.fetchall()

        contact_ids = [int(r[0]) for r in rows if r and r[0] is not None]
        snapshots = _load_engagement_snapshots(cursor, contact_ids)

        result = []
        for r in rows:
            contact = {
                "id": r[0],
                "company_name": r[1] or "",
                "domain": r[2],
                "name": r[3],
                "title": r[4],
                "email": r[5],
                "linkedin_url": r[6],
                "vertical": r[7],
            }

            idx = 8
            if has_location:
                contact["location"] = r[idx] if len(r) > idx else None
                idx += 1
            else:
                contact["location"] = None
            if has_email_pattern:
                contact["email_pattern"] = r[idx] if len(r) > idx else None
                idx += 1
            else:
                contact["email_pattern"] = None
            if has_email_confidence:
                contact["email_confidence"] = r[idx] if len(r) > idx else None
                idx += 1
            else:
                contact["email_confidence"] = None
            if has_email_verified:
                contact["email_verified"] = bool(r[idx]) if len(r) > idx and r[idx] is not None else False
                idx += 1
            else:
                contact["email_verified"] = False

            if has_phone:
                contact["phone"] = r[idx] if len(r) > idx else None
                contact["phone_source"] = r[idx + 1] if len(r) > idx + 1 else None
                contact["phone_confidence"] = r[idx + 2] if len(r) > idx + 2 else None
                idx += 3
            else:
                contact["phone"] = None
                contact["phone_source"] = None
                contact["phone_confidence"] = None

            if has_salesforce:
                contact["salesforce_status"] = r[idx] if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["salesforce_status"] = None

            if has_salesforce_sync:
                contact["salesforce_sync_status"] = r[idx] if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["salesforce_sync_status"] = None

            if has_salesforce_url:
                contact["salesforce_url"] = r[idx] if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["salesforce_url"] = None

            if has_salesforce_uploaded_at:
                contact["salesforce_uploaded_at"] = str(r[idx]) if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["salesforce_uploaded_at"] = None

            if has_salesforce_upload_batch:
                contact["salesforce_upload_batch"] = r[idx] if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["salesforce_upload_batch"] = None

            if has_lead_source:
                contact["lead_source"] = r[idx] if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["lead_source"] = None

            if has_ingest_batch_id:
                contact["ingest_batch_id"] = r[idx] if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["ingest_batch_id"] = None

            contact["scraped_at"] = str(r[idx]) if len(r) > idx and r[idx] else None
            contact["engagement_status"] = _compute_engagement_status(
                contact.get("salesforce_status"),
                contact.get("salesforce_url"),
                snapshots.get(int(contact["id"]), {}),
            )
            result.append(contact)

        conn.close()
        return result
    except Exception as e:
        import traceback

        error_msg = f"Error fetching contacts: {e}\n{traceback.format_exc()}"
        print(error_msg)
        raise HTTPException(status_code=500, detail="Error fetching contacts")


@router.get("/export", response_class=FileResponse, responses=COMMON_ERROR_RESPONSES)
def export_contacts(today_only: bool = False, with_email_only: bool = False):
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(linkedin_contacts)")
        columns = [row[1] for row in cursor.fetchall()]
        has_phone = "phone" in columns

        if has_phone:
            query = (
                "SELECT id, company_name, domain, name, title, email_generated, linkedin_url, "
                "phone, phone_source, phone_confidence, scraped_at FROM linkedin_contacts WHERE 1=1"
            )
        else:
            query = (
                "SELECT id, company_name, domain, name, title, email_generated, linkedin_url, "
                "scraped_at FROM linkedin_contacts WHERE 1=1"
            )
        params = []

        if with_email_only:
            query += " AND email_generated IS NOT NULL AND email_generated != ''"
        if today_only:
            query += " AND DATE(scraped_at) = ?"
            params.append(datetime.now().strftime("%Y-%m-%d"))

        query += " ORDER BY scraped_at DESC"
        try:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        except Exception as e:
            print(f"Error exporting contacts: {e}")
            rows = []

    if has_phone:
        contacts = [
            {
                "id": r[0],
                "company_name": r[1] or "",
                "domain": r[2],
                "name": r[3],
                "title": r[4],
                "email": r[5],
                "linkedin_url": r[6],
                "phone": r[7],
                "phone_source": r[8],
                "phone_confidence": r[9],
                "scraped_at": str(r[10]) if r[10] else None,
            }
            for r in rows
        ]
    else:
        contacts = [
            {
                "id": r[0],
                "company_name": r[1] or "",
                "domain": r[2],
                "name": r[3],
                "title": r[4],
                "email": r[5],
                "linkedin_url": r[6],
                "phone": None,
                "phone_source": None,
                "phone_confidence": None,
                "scraped_at": str(r[7]) if len(r) > 7 and r[7] else None,
            }
            for r in rows
        ]

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["Company", "Name", "Title", "Email", "Phone", "Phone Source", "Phone Confidence", "LinkedIn URL"],
    )
    writer.writeheader()
    for c in contacts:
        writer.writerow(
            {
                "Company": c["company_name"],
                "Name": c["name"],
                "Title": c["title"],
                "Email": c["email"],
                "Phone": c.get("phone", ""),
                "Phone Source": c.get("phone_source", ""),
                "Phone Confidence": c.get("phone_confidence", ""),
                "LinkedIn URL": c["linkedin_url"],
            }
        )

    export_path = config.DATA_DIR / "contacts" / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    with open(export_path, "w", newline="", encoding="utf-8") as f:
        f.write(output.getvalue())
    return FileResponse(export_path, media_type="text/csv", filename=export_path.name)


@router.get("/salesforce-csv/{filename}", response_class=FileResponse, responses=COMMON_ERROR_RESPONSES)
def download_salesforce_csv(filename: str):
    """Download a generated Salesforce import CSV file."""
    file_path = config.DATA_DIR / filename
    if not file_path.exists():
        not_found("File not found")
    return FileResponse(file_path, media_type="text/csv", filename=filename)


@router.get("/{contact_id}", response_model=ContactRecord, responses=COMMON_ERROR_RESPONSES)
def get_contact(contact_id: int):
    """Get a single contact by id (for chat polling)."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM linkedin_contacts WHERE id = ?", (contact_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")
        r = dict(row)
        return {
            "id": r.get("id"),
            "company_name": r.get("company_name") or "",
            "domain": r.get("domain"),
            "location": r.get("location"),
            "name": r.get("name"),
            "title": r.get("title"),
            "email": r.get("email_generated"),
            "email_pattern": r.get("email_pattern"),
            "email_confidence": r.get("email_confidence"),
            "email_verified": bool(r.get("email_verified")) if r.get("email_verified") is not None else False,
            "phone": r.get("phone"),
            "phone_source": r.get("phone_source"),
            "phone_confidence": r.get("phone_confidence"),
            "linkedin_url": r.get("linkedin_url"),
            "salesforce_url": r.get("salesforce_url"),
            "salesforce_status": r.get("salesforce_status"),
            "salesforce_sync_status": r.get("salesforce_sync_status"),
            "salesforce_uploaded_at": str(r.get("salesforce_uploaded_at")) if r.get("salesforce_uploaded_at") else None,
            "salesforce_upload_batch": r.get("salesforce_upload_batch"),
            "engagement_status": _compute_engagement_status(
                r.get("salesforce_status"),
                r.get("salesforce_url"),
                _load_engagement_snapshots(cursor, [contact_id]).get(contact_id, {}),
            ),
            "lead_source": r.get("lead_source"),
            "ingest_batch_id": r.get("ingest_batch_id"),
            "scraped_at": str(r.get("scraped_at")) if r.get("scraped_at") else None,
            "vertical": None,
        }
