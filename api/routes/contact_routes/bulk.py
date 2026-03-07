"""Bulk action endpoints for contacts."""

import csv
import io
from datetime import datetime

from fastapi import APIRouter, HTTPException

import config
import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.contact_routes.models import BulkActionRequest
from api.routes.contact_routes.models import (
    BulkCollectPhoneResponse,
    BulkDeleteResponse,
    BulkLinkedInRequestResponse,
    BulkMarkReviewedResponse,
    BulkSalesforceUploadResponse,
    BulkSendEmailResponse,
)
from api.routes.contact_routes.utils import launch_salesforce_upload

router = APIRouter()


@router.post("/bulk-actions/salesforce-upload", response_model=BulkSalesforceUploadResponse, responses=COMMON_ERROR_RESPONSES)
async def bulk_upload_to_salesforce(request: BulkActionRequest):
    """
    Generate a Salesforce-compatible CSV and open browser to Data Importer.
    Launches browser in a separate process so it stays open.
    """
    contact_ids = request.contact_ids
    try:
        batch_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        batch_timestamp = datetime.now().isoformat()

        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(contact_ids))
        cursor.execute(
            f"""
            SELECT id, company_name, domain, name, name_first, name_last, title, email_generated as email, linkedin_url, salesforce_uploaded_at
            FROM linkedin_contacts
            WHERE id IN ({placeholders})
        """,
            contact_ids,
        )
        rows = cursor.fetchall()

        contacts = []
        already_uploaded = []
        for r in rows:
            if r[9]:
                already_uploaded.append({"id": r[0], "name": r[3], "uploaded_at": r[9]})
                continue

            contacts.append(
                {
                    "id": r[0],
                    "company_name": r[1] or "",
                    "domain": r[2],
                    "name": r[3],
                    "name_first": r[4],
                    "name_last": r[5],
                    "title": r[6],
                    "email": r[7],
                    "linkedin_url": r[8],
                }
            )

        conn.close()

        if not contacts:
            if already_uploaded:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "already_uploaded",
                        "message": f"All {len(already_uploaded)} selected contacts have already been uploaded to Salesforce",
                        "details": {"already_uploaded": already_uploaded},
                    },
                )
            raise HTTPException(status_code=400, detail="No contacts selected")

        output = io.StringIO()
        fieldnames = ["Name", "Email", "Title", "Company", "LinkedIn", "Lead_Country", "Country"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for contact in contacts:
            name = contact.get("name", "")
            first = (contact.get("name_first") or "").strip()
            last = (contact.get("name_last") or "").strip()
            display_name = f"{last}, {first}" if last and first else name

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

        export_filename = f"salesforce_import_{batch_id}.csv"
        export_path = config.DATA_DIR / export_filename
        with open(export_path, "w", newline="", encoding="utf-8") as f:
            f.write(output.getvalue())

        print(f"[Salesforce Upload] CSV saved to: {export_path}")

        import json

        batch_file = config.DATA_DIR / f"sf_batch_{batch_id}.json"
        with open(batch_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "contact_ids": [c["id"] for c in contacts],
                    "batch_id": batch_id,
                    "batch_timestamp": batch_timestamp,
                    "csv_file": str(export_path),
                },
                f,
            )

        launch_salesforce_upload()

        return BulkSalesforceUploadResponse(
            success=True,
            csv_path=str(export_path),
            csv_filename=export_filename,
            exported=len(contacts),
            skipped_already_uploaded=len(already_uploaded),
            batch_id=batch_id,
            message=f"CSV created with {len(contacts)} contacts. Salesforce browser opened - upload the CSV!",
            already_uploaded=already_uploaded,
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"[Salesforce Upload] ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-actions/linkedin-request", response_model=BulkLinkedInRequestResponse, responses=COMMON_ERROR_RESPONSES)
async def bulk_linkedin_request(request: BulkActionRequest):
    """Send LinkedIn connection requests to selected contacts."""
    contact_ids = request.contact_ids
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(contact_ids))
        cursor.execute(
            f"""
            SELECT id, name, linkedin_url
            FROM linkedin_contacts
            WHERE id IN ({placeholders}) AND linkedin_url IS NOT NULL AND linkedin_url != ''
        """,
            contact_ids,
        )
        rows = cursor.fetchall()
        conn.close()

        contacts = [{"id": r[0], "name": r[1], "linkedin_url": r[2]} for r in rows]
        return BulkLinkedInRequestResponse(
            success=True,
            processed=len(contacts),
            message="LinkedIn requests queued (implementation pending)",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-actions/send-email", response_model=BulkSendEmailResponse, responses=COMMON_ERROR_RESPONSES)
async def bulk_send_email(request: BulkActionRequest):
    """Send emails via Salesforce to selected contacts."""
    contact_ids = request.contact_ids
    campaign_id = request.campaign_id
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(contact_ids))
        cursor.execute(
            f"""
            SELECT id, company_name, domain, name, title, email_generated as email
            FROM linkedin_contacts
            WHERE id IN ({placeholders}) AND email_generated IS NOT NULL AND email_generated != ''
        """,
            contact_ids,
        )
        rows = cursor.fetchall()
        conn.close()

        contacts = [
            {
                "id": r[0],
                "company_name": r[1] or "",
                "domain": r[2],
                "name": r[3],
                "title": r[4],
                "email": r[5],
            }
            for r in rows
        ]

        if not contacts:
            raise HTTPException(status_code=400, detail="No contacts with emails selected")

        campaign = db.get_email_campaign(campaign_id) if campaign_id else None

        from services.email.generator import generate_email_with_gpt4o
        from services.web_automation.salesforce.bot import SalesforceBot

        bot = SalesforceBot()
        try:
            await bot.start(headless=False)
            if not bot.is_authenticated:
                raise HTTPException(status_code=401, detail="Not authenticated to Salesforce")

            sent_count = 0
            for contact in contacts:
                try:
                    if campaign:
                        subject, body = await generate_email_with_gpt4o(campaign=campaign, contact=contact)
                    else:
                        subject = f"Quick question for {contact['company_name']}"
                        body = (
                            f"Hi {contact['name']},\n\nI help companies like {contact['company_name']} "
                            "streamline their outreach.\n\nWould it make sense to have a brief call this week?\n\nBest,\nYour Name"
                        )

                    send_item = {
                        "id": contact["id"],
                        "contact_name": contact["name"],
                        "contact_email": contact["email"],
                        "contact_title": contact["title"],
                        "company_name": contact["company_name"],
                        "domain": contact["domain"],
                        "planned_subject": subject,
                        "planned_body": body,
                    }

                    result = await bot.process_send_item(send_item, review_mode=False)
                    if result.get("result") == "sent":
                        sent_count += 1
                        conn = db.get_connection()
                        cursor = conn.cursor()
                        cursor.execute(
                            "UPDATE linkedin_contacts SET salesforce_status = 'completed' WHERE id = ?",
                            (contact["id"],),
                        )
                        conn.commit()
                        conn.close()
                except Exception as e:
                    print(f"Error sending email to {contact['email']}: {e}")
                    continue
        finally:
            await bot.stop()

        return BulkSendEmailResponse(success=True, sent=sent_count, total=len(contacts))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-actions/delete", response_model=BulkDeleteResponse, responses=COMMON_ERROR_RESPONSES)
async def bulk_delete_contacts(request: BulkActionRequest):
    """Delete multiple contacts by their IDs."""
    contact_ids = request.contact_ids
    try:
        if not contact_ids:
            raise HTTPException(status_code=400, detail="No contact IDs provided")

        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(contact_ids))
        cursor.execute(f"DELETE FROM linkedin_contacts WHERE id IN ({placeholders})", contact_ids)
        deleted_count = cursor.rowcount
        conn.commit()
        conn.close()

        return BulkDeleteResponse(success=True, deleted=deleted_count, message=f"Deleted {deleted_count} contact(s)")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-actions/collect-phone", response_model=BulkCollectPhoneResponse, responses=COMMON_ERROR_RESPONSES)
async def bulk_collect_phone(request: BulkActionRequest):
    """Discover phone numbers for contacts."""
    contact_ids = request.contact_ids
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(contact_ids))
        cursor.execute(
            f"""
            SELECT id, name, company_name, domain, email_generated, linkedin_url, phone
            FROM linkedin_contacts
            WHERE id IN ({placeholders})
        """,
            contact_ids,
        )
        rows = cursor.fetchall()
        conn.close()

        contacts = [
            {
                "id": r[0],
                "name": r[1],
                "company_name": r[2] or "",
                "domain": r[3],
                "email": r[4],
                "linkedin_url": r[5],
                "phone": r[6],
            }
            for r in rows
        ]

        contacts_with_phones = [c for c in contacts if c.get("phone")]
        contacts_without_phones = [c for c in contacts if not c.get("phone")]

        updated_count = 0
        discovered_count = 0
        enriched_count = 0

        if contacts_without_phones:
            from services.enrichment.phone.discoverer import discover_phone_parallel

            print(f"[BulkPhone] Discovering phones for {len(contacts_without_phones)} contacts without phone numbers...")

            if contacts_without_phones:
                sample_contact = contacts_without_phones[0]
                company_name = sample_contact.get("company_name", "")
                domain = sample_contact.get("domain", "")
                email = sample_contact.get("email", "")

                email_domain = None
                if email and "@" in email:
                    email_domain = email.split("@")[1]

                print(f"[BulkPhone] Diagnostic - Company: {company_name}, Domain: {domain}, Email Domain: {email_domain}")

                conn = db.get_connection()
                cursor = conn.cursor()

                domain_variants = [domain, email_domain] if email_domain else [domain]
                if domain and "." not in domain:
                    domain_variants.extend([domain.replace("-", "") + ".com", domain + ".com"])

                for dom in domain_variants:
                    if not dom:
                        continue
                    cursor.execute("SELECT COUNT(*) FROM pages WHERE domain = ?", (dom,))
                    page_count = cursor.fetchone()[0]
                    cursor.execute(
                        "SELECT COUNT(*) FROM pages WHERE domain = ? AND phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''",
                        (dom,),
                    )
                    phone_page_count = cursor.fetchone()[0]
                    if page_count > 0:
                        print(f"[BulkPhone] Diagnostic - Domain '{dom}': {page_count} total pages, {phone_page_count} with phones")

                if company_name:
                    cursor.execute(
                        "SELECT COUNT(*) FROM pages WHERE url LIKE ? OR domain LIKE ?",
                        (f"%{company_name.lower()}%", f"%{company_name.lower()}%"),
                    )
                    company_page_count = cursor.fetchone()[0]
                    cursor.execute(
                        "SELECT COUNT(*) FROM pages WHERE (url LIKE ? OR domain LIKE ?) AND phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''",
                        (f"%{company_name.lower()}%", f"%{company_name.lower()}%"),
                    )
                    company_phone_count = cursor.fetchone()[0]
                    if company_page_count > 0:
                        print(
                            f"[BulkPhone] Diagnostic - Company '{company_name}': {company_page_count} total pages, {company_phone_count} with phones"
                        )

                conn.close()

            for contact in contacts_without_phones:
                try:
                    search_domain = contact.get("domain", "")
                    if contact.get("email") and "@" in contact.get("email", ""):
                        email_domain = contact.get("email", "").split("@")[1]
                        if "." in email_domain:
                            search_domain = email_domain

                    print(
                        f"[BulkPhone] Searching for phone: {contact.get('name')} at {contact.get('company_name')} "
                        f"(domain: {contact.get('domain')}, email_domain: {search_domain}, email: {contact.get('email')})"
                    )
                    phone_data = await discover_phone_parallel(
                        name=contact.get("name", ""),
                        company=contact.get("company_name", ""),
                        domain=search_domain,
                        email=contact.get("email"),
                        linkedin_url=contact.get("linkedin_url"),
                    )

                    if phone_data:
                        print(f"[BulkPhone] Phone data result for {contact.get('name')}: {phone_data}")
                    else:
                        print(
                            f"[BulkPhone] No phone data returned for {contact.get('name')} - discovery methods returned None"
                        )

                    if phone_data and phone_data.get("phone"):
                        conn = db.get_connection()
                        cursor = conn.cursor()
                        cursor.execute(
                            """
                            UPDATE linkedin_contacts
                            SET phone = ?,
                                phone_source = ?,
                                phone_confidence = ?
                            WHERE id = ?
                        """,
                            (
                                phone_data.get("phone"),
                                phone_data.get("source", "discovered"),
                                int(phone_data.get("confidence", 0.5) * 100),
                                contact["id"],
                            ),
                        )
                        conn.commit()
                        conn.close()
                        updated_count += 1
                        discovered_count += 1
                        print(f"[BulkPhone] Discovered phone for {contact.get('name')}: {phone_data.get('phone')}")
                except Exception as e:
                    print(f"[BulkPhone] Error discovering phone for {contact.get('name')}: {e}")
                    continue

        if contacts_with_phones:
            print(
                f"[BulkPhone] Skipping enrichment for {len(contacts_with_phones)} contacts "
                "with existing phone numbers (phone_database removed)."
            )

        messages = []
        if discovered_count > 0:
            messages.append(f"Discovered {discovered_count} new phone numbers")
        if enriched_count > 0:
            messages.append(f"Enriched {enriched_count} existing phone numbers with PhoneInfoga data")
        if updated_count == 0:
            if contacts_without_phones:
                messages.append(
                    "Phone discovery is disabled. Company website phones are not individual direct lines - finding direct numbers requires paid data providers."
                )
            elif contacts_with_phones:
                messages.append("Existing phones were left unchanged")
            else:
                messages.append("No contacts to process")

        return BulkCollectPhoneResponse(
            success=True,
            processed=updated_count,
            discovered=discovered_count,
            enriched=enriched_count,
            total=len(contacts),
            searched=len(contacts_without_phones),
            message=". ".join(messages) if messages else f"Processed {updated_count} of {len(contacts)} contacts",
        )
    except Exception as e:
        import traceback

        error_msg = str(e)
        print(f"Error in bulk_collect_phone: {error_msg}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/bulk-actions/mark-reviewed", response_model=BulkMarkReviewedResponse, responses=COMMON_ERROR_RESPONSES)
async def bulk_mark_reviewed(request: BulkActionRequest):
    """Mark selected contacts as reviewed."""
    contact_ids = request.contact_ids
    try:
        if not contact_ids:
            raise HTTPException(status_code=400, detail="No contact IDs provided")

        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(contact_ids))
        cursor.execute(
            f"""
            UPDATE linkedin_contacts
            SET salesforce_status = 'reviewed'
            WHERE id IN ({placeholders})
            """,
            contact_ids,
        )
        updated = cursor.rowcount
        conn.commit()
        conn.close()
        return BulkMarkReviewedResponse(
            success=True,
            updated=updated,
            total=len(contact_ids),
            message=f"Marked {updated} of {len(contact_ids)} contacts as reviewed",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
