"""Campaign, template, enrollment, upload, and preview endpoints."""

import csv
import io
import json
import subprocess
import sys
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

import config
import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES, require_campaign
from api.routes.email_routes.models import (
    CampaignContactRecord,
    CampaignContactRemovedResponse,
    CampaignDeleteResponse,
    CampaignSalesforceUploadResponse,
    CampaignStatusResponse,
    EmailCampaignCreate,
    EmailCampaignRecord,
    EmailCampaignStatsResponse,
    EmailCampaignUpdate,
    EmailPreviewResponse,
    EmailTemplateCreate,
    EmailTemplateRecord,
    EnrollContactsRequest,
    EnrollContactsResponse,
)

router = APIRouter()


@router.get("/campaigns", response_model=list[EmailCampaignRecord], responses=COMMON_ERROR_RESPONSES)
def get_campaigns(status: Optional[str] = None):
    """Get all email campaigns with stats and templates."""
    campaigns = db.get_email_campaigns(status=status)
    for campaign in campaigns:
        campaign["stats"] = db.get_email_campaign_stats(campaign["id"])
        campaign["templates"] = db.get_email_templates(campaign["id"])
    return campaigns


@router.post("/campaigns", response_model=EmailCampaignRecord, responses=COMMON_ERROR_RESPONSES)
def create_campaign(data: EmailCampaignCreate):
    """Create a new email campaign."""
    campaign_id = db.create_email_campaign(
        name=data.name,
        description=data.description,
        num_emails=data.num_emails,
        days_between_emails=data.days_between_emails,
    )
    db.sync_entity_semantic_index("campaign", campaign_id)
    return db.get_email_campaign(campaign_id)


@router.get("/campaigns/{campaign_id}", response_model=EmailCampaignRecord, responses=COMMON_ERROR_RESPONSES)
def get_campaign(campaign_id: int):
    """Get a single campaign with templates and stats."""
    campaign = require_campaign(campaign_id)
    campaign["stats"] = db.get_email_campaign_stats(campaign_id)
    return campaign


@router.put("/campaigns/{campaign_id}", response_model=EmailCampaignRecord, responses=COMMON_ERROR_RESPONSES)
def update_campaign(campaign_id: int, data: EmailCampaignUpdate):
    """Update a campaign."""
    require_campaign(campaign_id)
    db.update_email_campaign(
        campaign_id,
        name=data.name,
        description=data.description,
        num_emails=data.num_emails,
        days_between_emails=data.days_between_emails,
        status=data.status,
    )
    db.sync_entity_semantic_index("campaign", campaign_id)
    return db.get_email_campaign(campaign_id)


@router.delete(
    "/campaigns/{campaign_id}",
    response_model=CampaignDeleteResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def delete_campaign(campaign_id: int):
    """Delete a campaign."""
    require_campaign(campaign_id)
    db.delete_email_campaign(campaign_id)
    db.delete_entity_semantic_index("campaign", campaign_id)
    return {"deleted": True}


@router.post(
    "/campaigns/{campaign_id}/activate",
    response_model=CampaignStatusResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def activate_campaign(campaign_id: int):
    """Activate a campaign (start sending emails)."""
    campaign = require_campaign(campaign_id)
    templates = db.get_email_templates(campaign_id)
    if len(templates) < campaign["num_emails"]:
        raise HTTPException(
            status_code=400,
            detail=f"Campaign needs {campaign['num_emails']} templates, only has {len(templates)}",
        )
    db.update_email_campaign(campaign_id, status="active")
    db.sync_entity_semantic_index("campaign", campaign_id)
    return {"status": "active"}


@router.post(
    "/campaigns/{campaign_id}/pause",
    response_model=CampaignStatusResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def pause_campaign(campaign_id: int):
    """Pause a campaign (stop sending emails)."""
    require_campaign(campaign_id)
    db.update_email_campaign(campaign_id, status="paused")
    db.sync_entity_semantic_index("campaign", campaign_id)
    return {"status": "paused"}


@router.get(
    "/campaigns/{campaign_id}/templates",
    response_model=list[EmailTemplateRecord],
    responses=COMMON_ERROR_RESPONSES,
)
def get_templates(campaign_id: int):
    """Get all templates for a campaign."""
    require_campaign(campaign_id)
    return db.get_email_templates(campaign_id)


@router.post(
    "/campaigns/{campaign_id}/templates",
    response_model=list[EmailTemplateRecord],
    responses=COMMON_ERROR_RESPONSES,
)
def save_template(campaign_id: int, data: EmailTemplateCreate):
    """Save or update a template for a campaign step."""
    campaign = require_campaign(campaign_id)
    if data.step_number < 1 or data.step_number > campaign["num_emails"]:
        raise HTTPException(
            status_code=400,
            detail=f"Step number must be between 1 and {campaign['num_emails']}",
        )
    db.save_email_template(
        campaign_id=campaign_id,
        step_number=data.step_number,
        subject_template=data.subject_template,
        body_template=data.body_template,
    )
    db.sync_entity_semantic_index("campaign", campaign_id)
    return db.get_email_templates(campaign_id)


@router.post(
    "/campaigns/{campaign_id}/templates/bulk",
    response_model=list[EmailTemplateRecord],
    responses=COMMON_ERROR_RESPONSES,
)
def save_templates_bulk(campaign_id: int, templates: list[EmailTemplateCreate]):
    """Save multiple templates at once."""
    campaign = require_campaign(campaign_id)
    for template in templates:
        if template.step_number < 1 or template.step_number > campaign["num_emails"]:
            continue
        db.save_email_template(
            campaign_id=campaign_id,
            step_number=template.step_number,
            subject_template=template.subject_template,
            body_template=template.body_template,
        )
    db.sync_entity_semantic_index("campaign", campaign_id)
    return db.get_email_templates(campaign_id)


@router.get(
    "/campaigns/{campaign_id}/contacts",
    response_model=list[CampaignContactRecord],
    responses=COMMON_ERROR_RESPONSES,
)
def get_campaign_contacts(campaign_id: int, status: Optional[str] = None):
    """Get contacts enrolled in a campaign."""
    require_campaign(campaign_id)
    return db.get_campaign_contacts(campaign_id, status=status)


@router.post(
    "/campaigns/{campaign_id}/enroll",
    response_model=EnrollContactsResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def enroll_contacts(campaign_id: int, data: EnrollContactsRequest):
    """Enroll contacts in a campaign."""
    require_campaign(campaign_id)
    return db.enroll_contacts_in_campaign(campaign_id, data.contact_ids)


@router.delete(
    "/campaigns/{campaign_id}/contacts/{campaign_contact_id}",
    response_model=CampaignContactRemovedResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def remove_contact(campaign_id: int, campaign_contact_id: int):
    """Remove a contact from a campaign."""
    require_campaign(campaign_id)
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM campaign_contacts WHERE id = ? AND campaign_id = ?",
            (campaign_contact_id, campaign_id),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Campaign contact not found")
    db.remove_contact_from_campaign(campaign_contact_id)
    return {"removed": True}


@router.get(
    "/campaigns/{campaign_id}/stats",
    response_model=EmailCampaignStatsResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def get_campaign_stats(campaign_id: int):
    """Get statistics for a specific campaign."""
    require_campaign(campaign_id)
    stats = db.get_email_campaign_stats(campaign_id)
    tracking = db.get_campaign_tracking_stats(campaign_id)
    stats.update(tracking)
    return stats


@router.post(
    "/campaigns/{campaign_id}/salesforce-upload",
    response_model=CampaignSalesforceUploadResponse,
    responses=COMMON_ERROR_RESPONSES,
)
async def upload_campaign_to_salesforce(campaign_id: int):
    """
    Export campaign contacts to Salesforce-compatible CSV and open browser to Data Importer.
    Uses the same format as the bulk upload from Contacts page.
    """
    try:
        campaign = require_campaign(campaign_id)
        campaign_contacts = db.get_campaign_contacts(campaign_id)
        if not campaign_contacts:
            return {"success": False, "error": "No contacts enrolled in this campaign"}

        contact_ids = [cc["contact_id"] for cc in campaign_contacts]
        batch_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        batch_timestamp = datetime.now().isoformat()

        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(contact_ids))
        cursor.execute(
            f"""
            SELECT id, company_name, domain, name, title, email_generated as email, linkedin_url, salesforce_uploaded_at
            FROM linkedin_contacts
            WHERE id IN ({placeholders})
        """,
            contact_ids,
        )
        rows = cursor.fetchall()
        conn.close()

        from services.identity.name_normalizer import normalize_name

        contacts = []
        already_uploaded = []
        for r in rows:
            if r[7]:
                already_uploaded.append({"id": r[0], "name": r[3], "uploaded_at": r[7]})
                continue
            contacts.append(
                {
                    "id": r[0],
                    "company_name": r[1] or "",
                    "domain": r[2],
                    "name": r[3],
                    "title": r[4],
                    "email": r[5],
                    "linkedin_url": r[6],
                }
            )

        if not contacts:
            if already_uploaded:
                return {
                    "success": False,
                    "error": f"All {len(already_uploaded)} contacts in this campaign have already been uploaded to Salesforce",
                    "already_uploaded": already_uploaded,
                }
            return {"success": False, "error": "No contacts available for upload"}

        output = io.StringIO()
        fieldnames = ["Name", "Email", "Title", "Company", "LinkedIn", "Lead_Country", "Country"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for contact in contacts:
            normalized = normalize_name(contact.get("name", ""))
            display_name = (
                f"{normalized.last}, {normalized.first}"
                if normalized.last and normalized.first
                else contact.get("name", "")
            )
            writer.writerow(
                {
                    "Name": display_name,
                    "Email": contact.get("email", ""),
                    "Title": contact.get("title", ""),
                    "Company": contact.get("company_name", ""),
                    "LinkedIn": contact.get("linkedin_url", ""),
                    "Lead_Country": "United States",
                    "Country": "United States",
                }
            )

        export_filename = f"salesforce_campaign_{campaign_id}_{batch_id}.csv"
        export_path = config.DATA_DIR / export_filename
        with open(export_path, "w", newline="", encoding="utf-8") as f:
            f.write(output.getvalue())

        batch_file = config.DATA_DIR / f"sf_batch_{batch_id}.json"
        with open(batch_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "contact_ids": [c["id"] for c in contacts],
                    "batch_id": batch_id,
                    "batch_timestamp": batch_timestamp,
                    "csv_file": str(export_path),
                    "campaign_id": campaign_id,
                    "campaign_name": campaign["name"],
                },
                f,
            )

        script_path = config.BASE_DIR / "services" / "salesforce" / "upload.py"
        subprocess.Popen(
            [sys.executable, str(script_path)],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )

        return {
            "success": True,
            "csv_path": str(export_path),
            "csv_filename": export_filename,
            "exported": len(contacts),
            "skipped_already_uploaded": len(already_uploaded),
            "batch_id": batch_id,
            "campaign_name": campaign["name"],
            "message": f'CSV created with {len(contacts)} contacts from "{campaign["name"]}". Salesforce browser opened - upload the CSV!',
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"[Campaign Salesforce Upload] ERROR: {e}")
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


@router.post("/preview", response_model=EmailPreviewResponse, responses=COMMON_ERROR_RESPONSES)
async def preview_email(campaign_id: int, contact_id: int, step_number: int = 1):
    """Generate a preview of what the email will look like."""
    from services.email.generator import generate_email_with_gpt4o

    campaign = require_campaign(campaign_id)
    templates = db.get_email_templates(campaign_id)
    template = next((t for t in templates if t["step_number"] == step_number), None)
    if not template:
        raise HTTPException(status_code=404, detail=f"No template for step {step_number}")

    conn = db.get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, name, title, company_name, domain, email_generated as email
        FROM linkedin_contacts WHERE id = ?
    """,
        (contact_id,),
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")

    contact = {
        "name": row[1],
        "title": row[2],
        "company_name": row[3],
        "domain": row[4],
        "email": row[5],
    }

    try:
        campaign_data = {
            "title": campaign["name"],
            "description": campaign.get("description"),
            "subject_template": template["subject_template"],
            "body_template": template["body_template"],
        }
        subject, body = generate_email_with_gpt4o(campaign_data, contact)
        return {"subject": subject, "body": body, "contact": contact, "step": step_number}
    except Exception as e:
        return {
            "subject": template["subject_template"].replace("{company}", contact.get("company_name", "")),
            "body": template["body_template"].replace("{name}", contact.get("name", "")),
            "contact": contact,
            "step": step_number,
            "error": str(e),
        }
