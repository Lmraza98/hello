"""
Contact management endpoints.
"""
import csv
import io
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

import database as db
import config

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


class BulkActionRequest(BaseModel):
    contact_ids: List[int]
    campaign_id: Optional[int] = None


class SalesforceUrlRequest(BaseModel):
    salesforce_url: str


@router.get("")
def get_contacts(company: Optional[str] = None, has_email: Optional[bool] = None, today_only: bool = False):
    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        
        # Check if phone and salesforce columns exist
        cursor.execute("PRAGMA table_info(linkedin_contacts)")
        columns = [row[1] for row in cursor.fetchall()]
        has_phone = 'phone' in columns
        has_salesforce = 'salesforce_status' in columns
        has_salesforce_url = 'salesforce_url' in columns
        has_phone_links = 'phone_links' in columns
        has_salesforce_uploaded_at = 'salesforce_uploaded_at' in columns
        has_salesforce_upload_batch = 'salesforce_upload_batch' in columns
        
        # Build query based on available columns
        select_fields = ["lc.id", "lc.company_name", "lc.domain", "lc.name", "lc.title", "lc.email_generated", "lc.linkedin_url", "t.vertical"]
        # Check for email-related columns
        has_email_pattern = 'email_pattern' in columns
        has_email_confidence = 'email_confidence' in columns
        has_email_verified = 'email_verified' in columns
        if has_email_pattern:
            select_fields.append("lc.email_pattern")
        if has_email_confidence:
            select_fields.append("lc.email_confidence")
        if has_email_verified:
            select_fields.append("lc.email_verified")
        if has_phone:
            select_fields.extend(["lc.phone", "lc.phone_source", "lc.phone_confidence"])
            if has_phone_links:
                select_fields.append("lc.phone_links")
        if has_salesforce:
            select_fields.append("lc.salesforce_status")
        if has_salesforce_url:
            select_fields.append("lc.salesforce_url")
        if has_salesforce_uploaded_at:
            select_fields.append("lc.salesforce_uploaded_at")
        if has_salesforce_upload_batch:
            select_fields.append("lc.salesforce_upload_batch")
        select_fields.append("lc.scraped_at")
        
        query = f"""SELECT {', '.join(select_fields)} 
                    FROM linkedin_contacts lc
                    LEFT JOIN targets t ON lc.company_name = t.company_name
                    WHERE 1=1"""
        params = []
        
        if company:
            query += " AND lc.company_name LIKE ?"
            params.append(f"%{company}%")
        if has_email is True:
            query += " AND lc.email_generated IS NOT NULL AND lc.email_generated != ''"
        elif has_email is False:
            query += " AND (lc.email_generated IS NULL OR lc.email_generated = '')"
        if today_only:
            query += f" AND DATE(lc.scraped_at) = '{datetime.now().strftime('%Y-%m-%d')}'"
        
        query += " ORDER BY lc.scraped_at DESC"
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        
        # Parse results based on available columns
        result = []
        for r in rows:
            contact = {
                "id": r[0],
                "company_name": r[1] or '',
                "domain": r[2],
                "name": r[3],
                "title": r[4],
                "email": r[5],
                "linkedin_url": r[6],
                "vertical": r[7],
            }
            
            idx = 8
            # Email-related fields
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
            # Phone-related fields
            if has_phone:
                contact["phone"] = r[idx] if len(r) > idx else None
                contact["phone_source"] = r[idx + 1] if len(r) > idx + 1 else None
                contact["phone_confidence"] = r[idx + 2] if len(r) > idx + 2 else None
                idx += 3
                if has_phone_links:
                    import json
                    phone_links_str = r[idx] if len(r) > idx and r[idx] else None
                    contact["phone_links"] = json.loads(phone_links_str) if phone_links_str else None
                    idx += 1
                else:
                    contact["phone_links"] = None
            else:
                contact["phone"] = None
                contact["phone_source"] = None
                contact["phone_confidence"] = None
                contact["phone_links"] = None
            
            if has_salesforce:
                contact["salesforce_status"] = r[idx] if len(r) > idx and r[idx] else None
                idx += 1
            else:
                contact["salesforce_status"] = None
            
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
            
            contact["scraped_at"] = str(r[idx]) if len(r) > idx and r[idx] else None
            result.append(contact)
        
        return result
    except Exception as e:
        import traceback
        error_msg = f"Error fetching contacts: {e}\n{traceback.format_exc()}"
        print(error_msg)
        return []


@router.get("/export")
def export_contacts(today_only: bool = False, with_email_only: bool = False):
    # Get contacts using the same logic as get_contacts endpoint
    with db.get_db() as conn:
        cursor = conn.cursor()
        # Check if phone columns exist
        cursor.execute("PRAGMA table_info(linkedin_contacts)")
        columns = [row[1] for row in cursor.fetchall()]
        has_phone = 'phone' in columns
        
        if has_phone:
            query = "SELECT id, company_name, domain, name, title, email_generated, linkedin_url, phone, phone_source, phone_confidence, scraped_at FROM linkedin_contacts WHERE 1=1"
        else:
            query = "SELECT id, company_name, domain, name, title, email_generated, linkedin_url, scraped_at FROM linkedin_contacts WHERE 1=1"
        params = []
        
        if with_email_only:
            query += " AND email_generated IS NOT NULL AND email_generated != ''"
        if today_only:
            query += f" AND DATE(scraped_at) = '{datetime.now().strftime('%Y-%m-%d')}'"
        
        query += " ORDER BY scraped_at DESC"
        
        try:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        except Exception as e:
            print(f"Error exporting contacts: {e}")
            rows = []
    
    if has_phone:
        contacts = [
            {"id": r[0], "company_name": r[1] or '', "domain": r[2], "name": r[3],
             "title": r[4], "email": r[5], "linkedin_url": r[6], 
             "phone": r[7], "phone_source": r[8], "phone_confidence": r[9],
             "scraped_at": str(r[10]) if r[10] else None}
            for r in rows
        ]
    else:
        contacts = [
            {"id": r[0], "company_name": r[1] or '', "domain": r[2], "name": r[3],
             "title": r[4], "email": r[5], "linkedin_url": r[6], 
             "phone": None, "phone_source": None, "phone_confidence": None,
             "scraped_at": str(r[7]) if len(r) > 7 and r[7] else None}
            for r in rows
        ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=['Company', 'Name', 'Title', 'Email', 'Phone', 'Phone Source', 'Phone Confidence', 'LinkedIn URL'])
    writer.writeheader()
    for c in contacts:
        writer.writerow({
            'Company': c['company_name'], 
            'Name': c['name'], 
            'Title': c['title'], 
            'Email': c['email'],
            'Phone': c.get('phone', ''),
            'Phone Source': c.get('phone_source', ''),
            'Phone Confidence': c.get('phone_confidence', ''),
            'LinkedIn URL': c['linkedin_url']
        })
    
    export_path = config.DATA_DIR / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    with open(export_path, 'w', newline='', encoding='utf-8') as f:
        f.write(output.getvalue())
    return FileResponse(export_path, media_type='text/csv', filename=export_path.name)


@router.get("/salesforce-csv/{filename}")
def download_salesforce_csv(filename: str):
    """Download a generated Salesforce import CSV file."""
    file_path = config.DATA_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, media_type='text/csv', filename=filename)


@router.post("/salesforce-auth")
async def salesforce_auth_session():
    """
    Open a browser window to authenticate with Salesforce.
    Waits for the browser to be closed manually before saving session.
    """
    import asyncio
    from playwright.async_api import async_playwright
    
    try:
        print("[Salesforce Auth] Starting browser...")
        playwright = await async_playwright().start()
        
        browser = await playwright.chromium.launch(
            headless=False,
            slow_mo=50
        )
        
        # Load existing session if available
        storage_path = config.DATA_DIR / "salesforce_auth.json"
        if storage_path.exists():
            print("[Salesforce Auth] Loading existing session...")
            context = await browser.new_context(
                storage_state=str(storage_path),
                viewport={'width': 1920, 'height': 1080}
            )
        else:
            print("[Salesforce Auth] Creating new session...")
            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080}
            )
        
        page = await context.new_page()
        
        print("[Salesforce Auth] Navigating to Salesforce...")
        # Navigate to Salesforce login page first
        await page.goto('https://zcocorp.lightning.force.com/', wait_until='domcontentloaded', timeout=120000)
        
        print("=" * 60)
        print("[Salesforce Auth] BROWSER IS NOW OPEN")
        print("[Salesforce Auth] Please log in to Salesforce.")
        print("[Salesforce Auth] When done, CLOSE THE BROWSER WINDOW to save session.")
        print("=" * 60)
        
        # Wait for the browser to be closed by the user
        # We do this by waiting for the page to be closed or checking if browser is connected
        try:
            while browser.is_connected():
                await asyncio.sleep(1)
        except Exception as e:
            print(f"[Salesforce Auth] Browser closed or disconnected: {e}")
        
        # Save session state before cleanup
        print("[Salesforce Auth] Saving session...")
        try:
            await context.storage_state(path=str(storage_path))
            print(f"[Salesforce Auth] Session saved to {storage_path}")
        except Exception as e:
            print(f"[Salesforce Auth] Could not save session: {e}")
        
        try:
            await context.close()
        except:
            pass
        try:
            await browser.close()
        except:
            pass
        try:
            await playwright.stop()
        except:
            pass
        
        return {
            'success': True,
            'message': 'Session saved. You can now use bulk upload.'
        }
        
    except Exception as e:
        import traceback
        print(f"[Salesforce Auth] ERROR: {e}")
        print(traceback.format_exc())
        return {
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }


@router.post("")
async def add_contact(contact: dict):
    """Add a single contact manually."""
    import re
    
    name = contact.get('name', '').strip()
    company_name = contact.get('company_name', '').strip()
    
    if not name or not company_name:
        raise HTTPException(status_code=400, detail="name and company_name are required")
    
    # Generate a domain slug from company name if not provided
    domain = contact.get('domain')
    if not domain and company_name:
        domain = re.sub(r'[^\w\s-]', '', company_name.lower())
        domain = re.sub(r'[\s_]+', '-', domain).strip('-')
    
    salesforce_url = contact.get('salesforce_url', '').strip() or None
    # If salesforce_url is provided, the lead is already in Salesforce
    salesforce_status = 'uploaded' if salesforce_url else None
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO linkedin_contacts 
            (company_name, domain, name, title, email_generated, linkedin_url, phone, salesforce_url, salesforce_status, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            company_name,
            domain,
            name,
            contact.get('title', '').strip() or None,
            contact.get('email', '').strip() or None,
            contact.get('linkedin_url', '').strip() or None,
            contact.get('phone', '').strip() or None,
            salesforce_url,
            salesforce_status,
        ))
        new_id = cursor.lastrowid
    
    return {
        "id": new_id,
        "company_name": company_name,
        "domain": domain,
        "name": name,
        "title": contact.get('title'),
        "email": contact.get('email'),
        "linkedin_url": contact.get('linkedin_url'),
        "salesforce_url": salesforce_url,
        "salesforce_status": salesforce_status,
    }


@router.get("/{contact_id}")
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
            "name": r.get("name"),
            "title": r.get("title"),
            "email": r.get("email_generated"),
            "email_pattern": r.get("email_pattern"),
            "email_confidence": r.get("email_confidence"),
            "email_verified": bool(r.get("email_verified")) if r.get("email_verified") is not None else False,
            "phone": r.get("phone"),
            "phone_source": r.get("phone_source"),
            "phone_confidence": r.get("phone_confidence"),
            "phone_links": None,
            "linkedin_url": r.get("linkedin_url"),
            "salesforce_url": r.get("salesforce_url"),
            "salesforce_status": r.get("salesforce_status"),
            "salesforce_uploaded_at": str(r.get("salesforce_uploaded_at")) if r.get("salesforce_uploaded_at") else None,
            "salesforce_upload_batch": r.get("salesforce_upload_batch"),
            "scraped_at": str(r.get("scraped_at")) if r.get("scraped_at") else None,
            "vertical": None,
        }


@router.post("/{contact_id}/salesforce-url")
def save_salesforce_url(contact_id: int, body: SalesforceUrlRequest):
    url = (body.salesforce_url or "").strip()
    if "lightning.force.com" not in url or "/lightning/r/Lead/" not in url:
        raise HTTPException(status_code=400, detail="Invalid Salesforce Lead URL")

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE linkedin_contacts SET salesforce_url = ?, salesforce_status = 'uploaded' WHERE id = ?",
            (url, contact_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Contact not found")

    return {"success": True, "salesforce_url": url}


@router.post("/{contact_id}/salesforce-skip")
def skip_salesforce(contact_id: int):
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE linkedin_contacts SET salesforce_status = 'skipped' WHERE id = ?",
            (contact_id,),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Contact not found")
    return {"success": True}


@router.post("/{contact_id}/salesforce-search")
def search_salesforce(contact_id: int):
    # Mark queued immediately.
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE linkedin_contacts SET salesforce_status = 'queued' WHERE id = ?",
            (contact_id,),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Contact not found")

        cursor.execute("SELECT name FROM linkedin_contacts WHERE id = ?", (contact_id,))
        row = cursor.fetchone()
        name = (row[0] if isinstance(row, (list, tuple)) else row["name"]) if row else None

    # Best-effort enqueue.
    enqueue_salesforce_lookup(contact_id, name or "")
    return {"success": True, "queued": True, "busy": is_browser_busy()}


@router.delete("/{contact_id}")
def delete_contact(contact_id: int):
    """Delete a single contact by ID."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM linkedin_contacts WHERE id = ?", (contact_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Contact not found")
        return {"deleted": True}


@router.delete("")
def clear_contacts(today_only: bool = False):
    with db.get_db() as conn:
        cursor = conn.cursor()
        if today_only:
            cursor.execute(f"DELETE FROM linkedin_contacts WHERE DATE(scraped_at) = '{datetime.now().strftime('%Y-%m-%d')}'")
        else:
            cursor.execute("DELETE FROM linkedin_contacts")
        return {"deleted": cursor.rowcount}


@router.post("/bulk-actions/salesforce-upload")
async def bulk_upload_to_salesforce(request: BulkActionRequest):
    """
    Generate a Salesforce-compatible CSV and open browser to Data Importer.
    Launches browser in a separate process so it stays open.
    """
    import subprocess
    import sys
    import json
    
    contact_ids = request.contact_ids
    try:
        # Generate unique batch ID
        batch_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        batch_timestamp = datetime.now().isoformat()
        
        # Get contacts
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(contact_ids))
        cursor.execute(f"""
            SELECT id, company_name, domain, name, title, email_generated as email, linkedin_url, salesforce_uploaded_at
            FROM linkedin_contacts 
            WHERE id IN ({placeholders})
        """, contact_ids)
        rows = cursor.fetchall()
        
        # Parse name into first/last
        from services.name_normalizer import normalize_name
        
        contacts = []
        already_uploaded = []
        for r in rows:
            # Check if already uploaded
            if r[7]:  # salesforce_uploaded_at
                already_uploaded.append({'id': r[0], 'name': r[3], 'uploaded_at': r[7]})
                continue
                
            contacts.append({
                'id': r[0], 
                'company_name': r[1] or '', 
                'domain': r[2], 
                'name': r[3],
                'title': r[4], 
                'email': r[5], 
                'linkedin_url': r[6]
            })
        
        conn.close()
        
        if not contacts:
            if already_uploaded:
                return {
                    'success': False,
                    'error': f'All {len(already_uploaded)} selected contacts have already been uploaded to Salesforce',
                    'already_uploaded': already_uploaded
                }
            return {'success': False, 'error': 'No contacts selected'}
        
        # Create Salesforce CSV format
        output = io.StringIO()
        fieldnames = ['Name', 'Email', 'Title', 'Company', 'LinkedIn', 'Lead_Country', 'Country']
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        
        for contact in contacts:
            name = contact.get('name', '')
            normalized = normalize_name(name)
            
            # Format: "Last, First" for Salesforce or just use full name
            display_name = f"{normalized.last}, {normalized.first}" if normalized.last and normalized.first else name
            
            writer.writerow({
                'Name': display_name,
                'Email': contact.get('email', ''),
                'Title': contact.get('title', ''),
                'Company': contact.get('company_name', ''),
                'LinkedIn': contact.get('linkedin_url', ''),
                'Lead_Country': 'United States',
                'Country': 'United States'
            })
        
        # Save CSV file
        export_filename = f"salesforce_import_{batch_id}.csv"
        export_path = config.DATA_DIR / export_filename
        with open(export_path, 'w', newline='', encoding='utf-8') as f:
            f.write(output.getvalue())
        
        print(f"[Salesforce Upload] CSV saved to: {export_path}")
        
        # Save batch info for later confirmation (don't mark as uploaded yet)
        import json
        batch_file = config.DATA_DIR / f"sf_batch_{batch_id}.json"
        with open(batch_file, 'w') as f:
            json.dump({
                'contact_ids': [c['id'] for c in contacts],
                'batch_id': batch_id,
                'batch_timestamp': batch_timestamp,
                'csv_file': str(export_path)
            }, f)
        
        conn.close()
        
        # Launch Salesforce browser in a SEPARATE CONSOLE WINDOW
        import subprocess
        import sys
        script_path = config.BASE_DIR / 'salesforce_upload.py'
        
        # CREATE_NEW_CONSOLE makes it open in its own window that stays open
        subprocess.Popen(
            [sys.executable, str(script_path)],
            creationflags=subprocess.CREATE_NEW_CONSOLE
        )
        
        return {
            'success': True,
            'csv_path': str(export_path),
            'csv_filename': export_filename,
            'exported': len(contacts),
            'skipped_already_uploaded': len(already_uploaded),
            'batch_id': batch_id,
            'message': f'CSV created with {len(contacts)} contacts. Salesforce browser opened - upload the CSV!'
        }
        
    except Exception as e:
        import traceback
        print(f"[Salesforce Upload] ERROR: {e}")
        return {'success': False, 'error': str(e), 'traceback': traceback.format_exc()}


@router.post("/bulk-actions/linkedin-request")
async def bulk_linkedin_request(request: BulkActionRequest):
    """Send LinkedIn connection requests to selected contacts."""
    contact_ids = request.contact_ids
    try:
        # Get contacts with LinkedIn URLs
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(contact_ids))
        cursor.execute(f"""
            SELECT id, name, linkedin_url
            FROM linkedin_contacts 
            WHERE id IN ({placeholders}) AND linkedin_url IS NOT NULL AND linkedin_url != ''
        """, contact_ids)
        rows = cursor.fetchall()
        conn.close()
        
        contacts = [{'id': r[0], 'name': r[1], 'linkedin_url': r[2]} for r in rows]
        
        # TODO: Implement LinkedIn connection request automation
        # For now, just return success
        return {
            'success': True,
            'processed': len(contacts),
            'message': 'LinkedIn requests queued (implementation pending)'
        }
    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e), 'traceback': traceback.format_exc()}


@router.post("/bulk-actions/send-email")
async def bulk_send_email(request: BulkActionRequest):
    """Send emails via Salesforce to selected contacts."""
    contact_ids = request.contact_ids
    campaign_id = request.campaign_id
    try:
        # Get contacts with emails
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(contact_ids))
        cursor.execute(f"""
            SELECT id, company_name, domain, name, title, email_generated as email
            FROM linkedin_contacts 
            WHERE id IN ({placeholders}) AND email_generated IS NOT NULL AND email_generated != ''
        """, contact_ids)
        rows = cursor.fetchall()
        conn.close()
        
        contacts = [
            {
                'id': r[0], 'company_name': r[1] or '', 'domain': r[2], 'name': r[3],
                'title': r[4], 'email': r[5]
            }
            for r in rows
        ]
        
        if not contacts:
            return {'success': False, 'error': 'No contacts with emails selected'}
        
        # Get campaign if provided
        campaign = None
        if campaign_id:
            campaign = db.get_email_campaign(campaign_id)
        
        # Generate emails and send via Salesforce
        from services.email_generator import generate_email_with_gpt4o
        from services.salesforce_bot import SalesforceBot
        
        bot = SalesforceBot()
        try:
            await bot.start(headless=False)
            if not bot.is_authenticated:
                return {'success': False, 'error': 'Not authenticated to Salesforce'}
            
            sent_count = 0
            for contact in contacts:
                try:
                    # Generate email
                    if campaign:
                        subject, body = await generate_email_with_gpt4o(campaign=campaign, contact=contact)
                    else:
                        # Use default template
                        subject = f"Quick question for {contact['company_name']}"
                        body = f"Hi {contact['name']},\n\nI help companies like {contact['company_name']} streamline their outreach.\n\nWould it make sense to have a brief call this week?\n\nBest,\nYour Name"
                    
                    # Prepare send item
                    send_item = {
                        'id': contact['id'],
                        'contact_name': contact['name'],
                        'contact_email': contact['email'],
                        'contact_title': contact['title'],
                        'company_name': contact['company_name'],
                        'domain': contact['domain'],
                        'planned_subject': subject,
                        'planned_body': body
                    }
                    
                    # Send via Salesforce
                    result = await bot.process_send_item(send_item, review_mode=False)
                    if result.get('result') == 'sent':
                        sent_count += 1
                        # Update salesforce_status
                        conn = db.get_connection()
                        cursor = conn.cursor()
                        cursor.execute("UPDATE linkedin_contacts SET salesforce_status = 'completed' WHERE id = ?", (contact['id'],))
                        conn.commit()
                        conn.close()
                except Exception as e:
                    print(f"Error sending email to {contact['email']}: {e}")
                    continue
        finally:
            await bot.stop()
        
        return {
            'success': True,
            'sent': sent_count,
            'total': len(contacts)
        }
    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e), 'traceback': traceback.format_exc()}


@router.post("/bulk-actions/delete")
async def bulk_delete_contacts(request: BulkActionRequest):
    """Delete multiple contacts by their IDs."""
    contact_ids = request.contact_ids
    try:
        if not contact_ids:
            return {'success': False, 'error': 'No contact IDs provided'}
        
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(contact_ids))
        cursor.execute(f"DELETE FROM linkedin_contacts WHERE id IN ({placeholders})", contact_ids)
        deleted_count = cursor.rowcount
        conn.commit()
        conn.close()
        
        return {
            'success': True,
            'deleted': deleted_count,
            'message': f'Deleted {deleted_count} contact(s)'
        }
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"Error in bulk_delete_contacts: {error_msg}\n{traceback.format_exc()}")
        return {'success': False, 'error': error_msg}


@router.post("/bulk-actions/collect-phone")
async def bulk_collect_phone(request: BulkActionRequest):
    """Discover phone numbers for contacts (or enrich existing ones with PhoneInfoga)."""
    contact_ids = request.contact_ids
    try:
        # Get contacts with all needed fields
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(contact_ids))
        cursor.execute(f"""
            SELECT id, name, company_name, domain, email_generated, linkedin_url, phone
            FROM linkedin_contacts 
            WHERE id IN ({placeholders})
        """, contact_ids)
        rows = cursor.fetchall()
        conn.close()
        
        contacts = [
            {
                'id': r[0],
                'name': r[1],
                'company_name': r[2] or '',
                'domain': r[3],
                'email': r[4],
                'linkedin_url': r[5],
                'phone': r[6]
            }
            for r in rows
        ]
        
        # Split contacts: those with phones (enrich) vs those without (discover)
        contacts_with_phones = [c for c in contacts if c.get('phone')]
        contacts_without_phones = [c for c in contacts if not c.get('phone')]
        
        updated_count = 0
        discovered_count = 0
        enriched_count = 0
        
        # 1. Discover phones for contacts without them
        if contacts_without_phones:
            from services.phone_discoverer import discover_phone_parallel
            
            print(f"[BulkPhone] Discovering phones for {len(contacts_without_phones)} contacts without phone numbers...")
            
            # Diagnostic: Check what pages exist for this company
            if contacts_without_phones:
                sample_contact = contacts_without_phones[0]
                company_name = sample_contact.get('company_name', '')
                domain = sample_contact.get('domain', '')
                email = sample_contact.get('email', '')
                
                # Extract email domain
                email_domain = None
                if email and '@' in email:
                    email_domain = email.split('@')[1]
                
                print(f"[BulkPhone] Diagnostic - Company: {company_name}, Domain: {domain}, Email Domain: {email_domain}")
                
                # Check what pages exist
                conn = db.get_connection()
                cursor = conn.cursor()
                
                # Check by domain variants
                domain_variants = [domain, email_domain] if email_domain else [domain]
                if domain and '.' not in domain:
                    domain_variants.extend([domain.replace('-', '') + '.com', domain + '.com'])
                
                for dom in domain_variants:
                    if not dom:
                        continue
                    cursor.execute("SELECT COUNT(*) FROM pages WHERE domain = ?", (dom,))
                    page_count = cursor.fetchone()[0]
                    cursor.execute("SELECT COUNT(*) FROM pages WHERE domain = ? AND phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''", (dom,))
                    phone_page_count = cursor.fetchone()[0]
                    if page_count > 0:
                        print(f"[BulkPhone] Diagnostic - Domain '{dom}': {page_count} total pages, {phone_page_count} with phones")
                
                # Check by company name
                if company_name:
                    cursor.execute("SELECT COUNT(*) FROM pages WHERE url LIKE ? OR domain LIKE ?", (f'%{company_name.lower()}%', f'%{company_name.lower()}%'))
                    company_page_count = cursor.fetchone()[0]
                    cursor.execute("SELECT COUNT(*) FROM pages WHERE (url LIKE ? OR domain LIKE ?) AND phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''", (f'%{company_name.lower()}%', f'%{company_name.lower()}%'))
                    company_phone_count = cursor.fetchone()[0]
                    if company_page_count > 0:
                        print(f"[BulkPhone] Diagnostic - Company '{company_name}': {company_page_count} total pages, {company_phone_count} with phones")
                
                conn.close()
            
            for contact in contacts_without_phones:
                try:
                    # Extract actual domain from email if available (more reliable)
                    search_domain = contact.get('domain', '')
                    if contact.get('email') and '@' in contact.get('email', ''):
                        email_domain = contact.get('email', '').split('@')[1]
                        if '.' in email_domain:
                            search_domain = email_domain
                    
                    print(f"[BulkPhone] Searching for phone: {contact.get('name')} at {contact.get('company_name')} (domain: {contact.get('domain')}, email_domain: {search_domain}, email: {contact.get('email')})")
                    phone_data = await discover_phone_parallel(
                        name=contact.get('name', ''),
                        company=contact.get('company_name', ''),
                        domain=search_domain,  # Use email domain if available
                        email=contact.get('email'),
                        linkedin_url=contact.get('linkedin_url')
                    )
                    
                    if phone_data:
                        print(f"[BulkPhone] Phone data result for {contact.get('name')}: {phone_data}")
                    else:
                        print(f"[BulkPhone] No phone data returned for {contact.get('name')} - discovery methods returned None")
                    
                    if phone_data and phone_data.get('phone'):
                        # Update contact with discovered phone
                        conn = db.get_connection()
                        cursor = conn.cursor()
                        
                        # Check if phone_links column exists
                        cursor.execute("PRAGMA table_info(linkedin_contacts)")
                        columns = [row[1] for row in cursor.fetchall()]
                        has_phone_links = 'phone_links' in columns
                        
                        if not has_phone_links:
                            try:
                                cursor.execute("ALTER TABLE linkedin_contacts ADD COLUMN phone_links TEXT")
                                conn.commit()
                            except:
                                pass
                        
                        # Store Google dork URLs as JSON if available
                        phone_links_json = None
                        if phone_data.get('google_dork_urls'):
                            import json
                            phone_links_json = json.dumps(phone_data['google_dork_urls'])
                        
                        if phone_links_json:
                            cursor.execute("""
                                UPDATE linkedin_contacts 
                                SET phone = ?,
                                    phone_source = ?,
                                    phone_confidence = ?,
                                    phone_links = ?
                                WHERE id = ?
                            """, (
                                phone_data.get('phone'),
                                phone_data.get('source', 'discovered'),
                                int(phone_data.get('confidence', 0.5) * 100),
                                phone_links_json,
                                contact['id']
                            ))
                        else:
                            cursor.execute("""
                                UPDATE linkedin_contacts 
                                SET phone = ?,
                                    phone_source = ?,
                                    phone_confidence = ?
                                WHERE id = ?
                            """, (
                                phone_data.get('phone'),
                                phone_data.get('source', 'discovered'),
                                int(phone_data.get('confidence', 0.5) * 100),
                                contact['id']
                            ))
                        conn.commit()
                        conn.close()
                        updated_count += 1
                        discovered_count += 1
                        print(f"[BulkPhone] Discovered phone for {contact.get('name')}: {phone_data.get('phone')}")
                except Exception as e:
                    print(f"[BulkPhone] Error discovering phone for {contact.get('name')}: {e}")
                    continue
        
        # 2. Enrich existing phones with PhoneInfoga
        if contacts_with_phones:
            from services.phone_database.validator import enrich_phone_via_phoneinfoga
            
            print(f"[BulkPhone] Enriching {len(contacts_with_phones)} contacts with existing phone numbers...")
            
            for contact in contacts_with_phones:
                phone = contact.get('phone')
                if not phone:
                    continue
                
                try:
                    # Enrich phone with PhoneInfoga
                    result = await enrich_phone_via_phoneinfoga(phone)
                    
                    if result:
                        # Update phone confidence and store links if available
                        conn = db.get_connection()
                        cursor = conn.cursor()
                        
                        # Check if phone_links column exists, if not add it
                        cursor.execute("PRAGMA table_info(linkedin_contacts)")
                        columns = [row[1] for row in cursor.fetchall()]
                        has_phone_links = 'phone_links' in columns
                        
                        if not has_phone_links:
                            try:
                                cursor.execute("ALTER TABLE linkedin_contacts ADD COLUMN phone_links TEXT")
                                conn.commit()
                            except:
                                pass  # Column might already exist
                        
                        # Store Google dork URLs as JSON if available
                        phone_links_json = None
                        if result.get('google_dork_urls'):
                            import json
                            phone_links_json = json.dumps(result['google_dork_urls'])
                        
                        if phone_links_json:
                            cursor.execute("""
                                UPDATE linkedin_contacts 
                                SET phone_confidence = ?,
                                    phone_source = ?,
                                    phone_links = ?
                                WHERE id = ?
                            """, (
                                int(result.get('confidence', 0.5) * 100),
                                result.get('source', 'phoneinfoga'),
                                phone_links_json,
                                contact['id']
                            ))
                        else:
                            cursor.execute("""
                                UPDATE linkedin_contacts 
                                SET phone_confidence = ?,
                                    phone_source = ?
                                WHERE id = ?
                            """, (
                                int(result.get('confidence', 0.5) * 100),
                                result.get('source', 'phoneinfoga'),
                                contact['id']
                            ))
                        conn.commit()
                        conn.close()
                        updated_count += 1
                        enriched_count += 1
                except Exception as e:
                    print(f"[BulkPhone] Error enriching phone for {contact['name']}: {e}")
                    continue
        
        # Build response message
        messages = []
        if discovered_count > 0:
            messages.append(f"Discovered {discovered_count} new phone numbers")
        if enriched_count > 0:
            messages.append(f"Enriched {enriched_count} existing phone numbers with PhoneInfoga data")
        if updated_count == 0:
            if contacts_without_phones:
                messages.append(f"Phone discovery is disabled. Company website phones are not individual direct lines - finding direct numbers requires paid data providers.")
            elif contacts_with_phones:
                messages.append("Existing phones enriched with PhoneInfoga")
            else:
                messages.append("No contacts to process")
        
        return {
            'success': True,
            'processed': updated_count,
            'discovered': discovered_count,
            'enriched': enriched_count,
            'total': len(contacts),
            'searched': len(contacts_without_phones),
            'message': '. '.join(messages) if messages else f'Processed {updated_count} of {len(contacts)} contacts'
        }
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"Error in bulk_collect_phone: {error_msg}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_msg)

