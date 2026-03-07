"""
Reconcile manually-sent Salesforce emails back into local campaign tracking.

Use after a headed review session where emails were sent directly in Salesforce tabs.
"""

import argparse
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
import sys
from typing import Dict, List

# Ensure repository root import path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import database as db
from services.email.salesforce_automation import SalesforceSender


def _render_template_text(template_text: str, contact: Dict) -> str:
    contact_name = (contact.get("contact_name") or "").strip()
    company_name = (contact.get("company_name") or "").strip()
    parts = [p for p in contact_name.split() if p]
    first_name = parts[0] if parts else ""
    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
    out = template_text or ""
    for old, new in [
        ("{company}", company_name),
        ("{Company}", company_name),
        ("{name}", contact_name),
        ("{Name}", contact_name),
        ("{FirstName}", first_name),
        ("{firstName}", first_name),
        ("{first_name}", first_name),
        ("{LastName}", last_name),
        ("{lastName}", last_name),
        ("{last_name}", last_name),
        ("{title}", contact.get("title") or ""),
    ]:
        out = out.replace(old, new)
    return out


async def reconcile_campaign(campaign_id: int, limit: int = 500, headless: bool = True) -> Dict:
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        return {"success": False, "error": f"Campaign {campaign_id} not found"}

    contacts = db.get_campaign_contacts(campaign_id)[: max(1, int(limit))]
    if not contacts:
        return {"success": True, "checked": 0, "logged": 0, "updated_contacts": 0}

    sender = SalesforceSender()
    checked = 0
    logged = 0
    updated_contacts = 0
    skipped_no_url = 0
    skipped_no_new = 0

    try:
        if not await sender.start(headless=headless):
            return {"success": False, "error": "Salesforce authentication failed"}

        page = sender.pages[0]
        templates = db.get_email_templates(campaign_id)
        template_by_step = {int(t["step_number"]): t for t in templates}

        for contact in contacts:
            lead_url = (contact.get("sf_lead_url") or "").strip() or (contact.get("salesforce_url") or "").strip()
            if not lead_url:
                skipped_no_url += 1
                continue

            checked += 1
            campaign_contact_id = int(contact["id"])
            contact_id = int(contact["contact_id"])
            current_step = int(contact.get("current_step") or 0)

            with db.get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT COALESCE(MAX(COALESCE(step_number, 0)), 0) AS max_step
                    FROM sent_emails
                    WHERE campaign_contact_id = ?
                      AND lower(COALESCE(review_status, status, '')) = 'sent'
                    """,
                    (campaign_contact_id,),
                )
                max_step = int((cur.fetchone()["max_step"]) or 0)
                cur.execute(
                    """
                    SELECT COALESCE(NULLIF(sf_email_url, ''), '') AS sf_email_url
                    FROM sent_emails
                    WHERE campaign_contact_id = ?
                      AND lower(COALESCE(review_status, status, '')) = 'sent'
                    """,
                    (campaign_contact_id,),
                )
                existing_urls = {str(r["sf_email_url"]).strip() for r in cur.fetchall() if str(r["sf_email_url"]).strip()}

            try:
                await page.goto(lead_url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=10_000)
                except Exception:
                    pass
                await asyncio.sleep(0.8)
                timeline_urls = await sender.get_timeline_email_urls(page, limit=40)
            except Exception:
                continue

            new_urls = [u for u in timeline_urls if u not in existing_urls]
            if not new_urls:
                skipped_no_new += 1
                continue

            step_cursor = max(max_step, current_step)
            max_emails = int(campaign.get("num_emails") or 1)
            contact_logged = 0

            # Timeline is newest-first; assign older discovered URLs first to ascending steps.
            for sf_email_url in reversed(new_urls):
                if step_cursor >= max_emails:
                    break
                step_cursor += 1
                tmpl = template_by_step.get(step_cursor)
                raw_subject = (tmpl or {}).get("subject_template") or f"Campaign step {step_cursor}"
                raw_body = (tmpl or {}).get("body_template") or "Imported from Salesforce manual send."
                subject = _render_template_text(raw_subject, contact)
                body = _render_template_text(raw_body, contact)
                db.log_sent_email(
                    campaign_id=campaign_id,
                    campaign_contact_id=campaign_contact_id,
                    contact_id=contact_id,
                    step_number=step_cursor,
                    subject=subject,
                    body=body,
                    sf_lead_url=lead_url,
                    sf_email_url=sf_email_url,
                    status="sent",
                )
                logged += 1
                contact_logged += 1

            if contact_logged > 0:
                days_between = int(campaign.get("days_between_emails") or 3)
                new_status = "completed" if step_cursor >= max_emails else "active"
                next_email_at = None
                if new_status == "active":
                    next_email_at = (datetime.now() + timedelta(days=days_between)).isoformat()
                db.update_campaign_contact(
                    campaign_contact_id,
                    current_step=step_cursor,
                    status=new_status,
                    sf_lead_url=lead_url,
                    next_email_at=next_email_at,
                )
                updated_contacts += 1

    finally:
        try:
            await sender.stop()
        except Exception:
            pass

    return {
        "success": True,
        "campaign_id": int(campaign_id),
        "checked": int(checked),
        "logged": int(logged),
        "updated_contacts": int(updated_contacts),
        "skipped_no_url": int(skipped_no_url),
        "skipped_no_new": int(skipped_no_new),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile manual Salesforce sends into sent_emails")
    parser.add_argument("--campaign-id", type=int, required=True)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--no-headless", action="store_true")
    args = parser.parse_args()

    result = asyncio.run(
        reconcile_campaign(
            campaign_id=args.campaign_id,
            limit=args.limit,
            headless=not args.no_headless,
        )
    )
    print(result)


if __name__ == "__main__":
    main()
