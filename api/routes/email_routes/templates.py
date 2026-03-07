"""Standalone template library endpoints (ActiveCampaign-style)."""

from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES
from services.email.template_renderer import render_template_bundle, validate_rendered_output

router = APIRouter()


class TemplateCreateRequest(BaseModel):
    name: str
    subject: str
    preheader: Optional[str] = None
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    reply_to: Optional[str] = None
    html_body: str
    text_body: Optional[str] = None


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    preheader: Optional[str] = None
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    reply_to: Optional[str] = None
    html_body: Optional[str] = None
    text_body: Optional[str] = None
    status: Optional[str] = None


class TemplateRenderRequest(BaseModel):
    contact_id: Optional[int] = None
    campaign_id: Optional[int] = None
    sample_vars: Dict[str, Any] = Field(default_factory=dict)


class TemplateTestSendRequest(BaseModel):
    to_email: str
    contact_id: Optional[int] = None
    campaign_id: Optional[int] = None
    sample_vars: Dict[str, Any] = Field(default_factory=dict)


class TemplateRevertRequest(BaseModel):
    revision_number: int


class BlockCreateRequest(BaseModel):
    name: str
    category: Optional[str] = None
    html: str
    text: Optional[str] = None


class BlockUpdateRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    html: Optional[str] = None
    text: Optional[str] = None
    status: Optional[str] = None


class ValidateRequest(BaseModel):
    subject: str
    html: str
    from_email: Optional[str] = None


def _load_contact_vars(contact_id: Optional[int]) -> Dict[str, Any]:
    if not contact_id:
        return {}
    conn = db.get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT
            lc.id,
            lc.name,
            lc.title,
            lc.company_name,
            lc.email_generated,
            COALESCE(NULLIF(lc.location, ''), '') AS resolved_location,
            COALESCE(NULLIF(ile_latest.lead_industry, ''), t.vertical, '') AS resolved_industry
        FROM linkedin_contacts lc
        LEFT JOIN targets t ON TRIM(LOWER(lc.company_name)) = TRIM(LOWER(t.company_name))
        LEFT JOIN (
            SELECT ile.contact_id, ile.lead_industry
            FROM inbound_lead_events ile
            INNER JOIN (
                SELECT contact_id, MAX(id) AS max_id
                FROM inbound_lead_events
                WHERE contact_id IS NOT NULL
                GROUP BY contact_id
            ) latest ON latest.max_id = ile.id
        ) ile_latest ON ile_latest.contact_id = lc.id
        WHERE lc.id = ?
        """,
        (contact_id,),
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        return {}
    full_name = (row["name"] or "").strip()
    parts = [p for p in full_name.split(" ") if p]
    first_name = parts[0] if parts else ""
    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
    return {
        "contactId": int(row["id"]),
        "fullName": full_name,
        "firstName": first_name,
        "lastName": last_name,
        "title": row["title"] or "",
        "company": row["company_name"] or "",
        "email": row["email_generated"] or "",
        "industry": row["resolved_industry"] or "",
        "location": row["resolved_location"] or "",
    }


def _load_campaign_name(campaign_id: Optional[int]) -> str:
    if not campaign_id:
        return ""
    campaign = db.get_email_campaign(campaign_id)
    return (campaign or {}).get("name") or ""


def _build_vars(
    contact_id: Optional[int],
    campaign_id: Optional[int],
    sample_vars: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    sample_vars = sample_vars or {}
    contact_vars = _load_contact_vars(contact_id)
    app_url = "http://localhost:8000"
    contact_ref = contact_vars.get("contactId") or sample_vars.get("contactId") or "sample"
    campaign_name = sample_vars.get("campaignName") or _load_campaign_name(campaign_id)
    system = {
        "unsubscribeUrl": f"{app_url}/unsubscribe?contact={contact_ref}",
        "viewInBrowserUrl": f"{app_url}/email/view/{contact_ref}",
        "trackingPixel": f'<img src="{app_url}/api/emails/tracking/pixel?contact={contact_ref}" width="1" height="1" alt="" />',
        "campaignName": campaign_name,
    }
    merged = {**contact_vars, **system, **sample_vars}
    if not merged.get("fullName"):
        merged["fullName"] = " ".join(
            [merged.get("firstName", ""), merged.get("lastName", "")]
        ).strip()
    return merged


@router.get("/templates", responses=COMMON_ERROR_RESPONSES)
def list_templates(
    q: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    return db.list_email_library_templates(
        query=q, status=status, limit=limit, offset=offset
    )


@router.post("/templates", responses=COMMON_ERROR_RESPONSES)
def create_template(payload: TemplateCreateRequest):
    template_id = db.create_email_library_template(
        name=payload.name,
        subject=payload.subject,
        preheader=payload.preheader,
        from_name=payload.from_name,
        from_email=payload.from_email,
        reply_to=payload.reply_to,
        html_body=payload.html_body,
        text_body=payload.text_body,
    )
    return db.get_email_library_template(template_id)


@router.get("/templates/{template_id}", responses=COMMON_ERROR_RESPONSES)
def get_template(template_id: int):
    template = db.get_email_library_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.put("/templates/{template_id}", responses=COMMON_ERROR_RESPONSES)
def update_template(template_id: int, payload: TemplateUpdateRequest):
    ok = db.update_email_library_template(
        template_id, payload.model_dump(exclude_none=True)
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found or no changes")
    return db.get_email_library_template(template_id)


@router.post("/templates/{template_id}/duplicate", responses=COMMON_ERROR_RESPONSES)
def duplicate_template(template_id: int):
    new_id = db.duplicate_email_library_template(template_id)
    if not new_id:
        raise HTTPException(status_code=404, detail="Template not found")
    return db.get_email_library_template(new_id)


@router.post("/templates/{template_id}/archive", responses=COMMON_ERROR_RESPONSES)
def archive_template(template_id: int):
    ok = db.update_email_library_template(template_id, {"status": "archived"})
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"success": True}


@router.get("/templates/{template_id}/revisions", responses=COMMON_ERROR_RESPONSES)
def template_revisions(template_id: int, limit: int = 20):
    return db.list_email_template_revisions(template_id, limit=limit)


@router.post("/templates/{template_id}/revert", responses=COMMON_ERROR_RESPONSES)
def revert_template(template_id: int, payload: TemplateRevertRequest):
    ok = db.revert_email_library_template(template_id, payload.revision_number)
    if not ok:
        raise HTTPException(status_code=404, detail="Revision not found")
    return db.get_email_library_template(template_id)


@router.post("/templates/validate", responses=COMMON_ERROR_RESPONSES)
def validate_template(payload: ValidateRequest):
    return validate_rendered_output(payload.subject, payload.html, payload.from_email)


@router.post("/templates/{template_id}/render", responses=COMMON_ERROR_RESPONSES)
def render_template(template_id: int, payload: TemplateRenderRequest):
    template = db.get_email_library_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    vars_map = _build_vars(payload.contact_id, payload.campaign_id, payload.sample_vars)
    rendered = render_template_bundle(template, vars_map)
    return {
        "subject": rendered["subject"],
        "preheader": rendered["preheader"],
        "html": rendered["html"],
        "text": rendered["text"],
        "sanitized_html": rendered["sanitized_html"],
        "warnings": rendered["warnings"],
        "errors": rendered["errors"],
        "vars": vars_map,
    }


@router.post("/templates/{template_id}/test-send", responses=COMMON_ERROR_RESPONSES)
def test_send_template(template_id: int, payload: TemplateTestSendRequest):
    template = db.get_email_library_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if "@" not in payload.to_email:
        raise HTTPException(status_code=400, detail="Invalid to_email")
    vars_map = _build_vars(payload.contact_id, payload.campaign_id, payload.sample_vars)
    rendered = render_template_bundle(template, vars_map)
    return {
        "success": True,
        "mode": "dry_run",
        "message": "Template rendered for test-send. Existing campaign sender pipeline remains unchanged.",
        "to_email": payload.to_email,
        "subject": rendered["subject"],
        "html": rendered["html"],
        "text": rendered["text"],
        "warnings": rendered["warnings"],
        "errors": rendered["errors"],
    }


@router.get("/template-blocks", responses=COMMON_ERROR_RESPONSES)
def list_blocks(status: Optional[str] = None):
    return db.list_email_template_blocks(status=status)


@router.post("/template-blocks", responses=COMMON_ERROR_RESPONSES)
def create_block(payload: BlockCreateRequest):
    block_id = db.create_email_template_block(
        name=payload.name,
        category=payload.category,
        html=payload.html,
        text=payload.text,
    )
    return db.get_email_template_block(block_id)


@router.put("/template-blocks/{block_id}", responses=COMMON_ERROR_RESPONSES)
def update_block(block_id: int, payload: BlockUpdateRequest):
    ok = db.update_email_template_block(block_id, payload.model_dump(exclude_none=True))
    if not ok:
        raise HTTPException(status_code=404, detail="Block not found or no changes")
    return db.get_email_template_block(block_id)


@router.delete("/template-blocks/{block_id}", responses=COMMON_ERROR_RESPONSES)
def delete_block(block_id: int):
    ok = db.delete_email_template_block(block_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Block not found")
    return {"success": True}


@router.get("/templates/{template_id}/export", responses=COMMON_ERROR_RESPONSES)
def export_template(template_id: int):
    template = db.get_email_library_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    revisions = db.list_email_template_revisions(template_id, limit=20)
    blocks = db.list_email_template_blocks(status="active")
    return {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "template": template,
        "revisions": revisions,
        "blocks": blocks,
    }


@router.post("/templates/import", responses=COMMON_ERROR_RESPONSES)
def import_template(payload: Dict[str, Any]):
    template = dict(payload.get("template") or payload)
    if not template.get("name") or not template.get("subject") or not template.get(
        "html_body"
    ):
        raise HTTPException(status_code=400, detail="Import payload missing required fields")
    template_id = db.create_email_library_template(
        name=template.get("name"),
        subject=template.get("subject"),
        preheader=template.get("preheader"),
        from_name=template.get("from_name"),
        from_email=template.get("from_email"),
        reply_to=template.get("reply_to"),
        html_body=template.get("html_body"),
        text_body=template.get("text_body"),
        status=template.get("status") or "active",
    )
    for block in payload.get("blocks") or []:
        try:
            db.create_email_template_block(
                name=block.get("name") or "Imported Block",
                category=block.get("category"),
                html=block.get("html") or "",
                text=block.get("text"),
                status=block.get("status") or "active",
            )
        except Exception:
            continue
    return db.get_email_library_template(template_id)


@router.put("/campaigns/{campaign_id}/template-link", responses=COMMON_ERROR_RESPONSES)
def link_campaign_template(campaign_id: int, payload: Dict[str, Any]):
    template_id = payload.get("template_id")
    template_mode = (payload.get("template_mode") or "linked").strip().lower()
    if template_mode not in {"linked", "copied"}:
        raise HTTPException(status_code=400, detail="template_mode must be linked or copied")
    if template_id is not None:
        template = db.get_email_library_template(int(template_id))
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
    ok = db.set_campaign_template_link(
        campaign_id, template_id=template_id, template_mode=template_mode
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return db.get_email_campaign(campaign_id)
