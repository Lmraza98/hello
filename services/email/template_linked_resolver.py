"""Helpers to resolve linked template-library content for campaign contacts."""

from typing import Any, Dict, Optional

import database as db
from services.email.template_renderer import render_template_bundle


def _contact_vars(contact: Dict[str, Any]) -> Dict[str, Any]:
    contact_name = (contact.get("contact_name") or "").strip()
    parts = [p for p in contact_name.split(" ") if p]
    first_name = parts[0] if parts else ""
    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
    contact_id = contact.get("contact_id") or contact.get("id") or "sample"
    app_url = "http://localhost:8000"
    return {
        "firstName": first_name,
        "lastName": last_name,
        "fullName": contact_name,
        "email": contact.get("email") or "",
        "company": contact.get("company_name") or "",
        "title": contact.get("title") or "",
        "campaignName": contact.get("campaign_name") or "",
        "unsubscribeUrl": f"{app_url}/unsubscribe?contact={contact_id}",
        "viewInBrowserUrl": f"{app_url}/email/view/{contact_id}",
        "trackingPixel": f'<img src="{app_url}/api/emails/tracking/pixel?contact={contact_id}" width="1" height="1" alt="" />',
    }


def render_linked_template_for_contact(contact: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    template_mode = (contact.get("template_mode") or "copied").strip().lower()
    template_id = contact.get("template_id")
    if template_mode != "linked" or not template_id:
        return None
    template = db.get_email_library_template(int(template_id))
    if not template or template.get("status") == "archived":
        return None
    vars_map = _contact_vars(contact)
    return render_template_bundle(template, vars_map)
