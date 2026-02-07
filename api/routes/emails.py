"""
Email campaign management API endpoints.
Includes campaign CRUD, review queue, tracking, and config.
"""
import asyncio
import subprocess
import sys
from typing import Optional, List, Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

import config
import database as db

router = APIRouter(prefix="/api/emails", tags=["emails"])


# ============ Request/Response Models ============

class EmailCampaignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    num_emails: int = 3
    days_between_emails: int = 3


class EmailCampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    num_emails: Optional[int] = None
    days_between_emails: Optional[int] = None
    status: Optional[str] = None


class EmailTemplateCreate(BaseModel):
    step_number: int
    subject_template: str
    body_template: str


class EnrollContactsRequest(BaseModel):
    contact_ids: List[int]


class SendEmailsRequest(BaseModel):
    campaign_id: Optional[int] = None
    limit: Optional[int] = None
    review_mode: bool = True  # Default to review mode - user clicks Send manually


# ============ Campaign CRUD Endpoints ============

@router.get("/campaigns")
def get_campaigns(status: Optional[str] = None):
    """Get all email campaigns with stats and templates."""
    campaigns = db.get_email_campaigns(status=status)
    
    # Add stats and templates to each campaign
    for campaign in campaigns:
        campaign['stats'] = db.get_email_campaign_stats(campaign['id'])
        campaign['templates'] = db.get_email_templates(campaign['id'])
    
    return campaigns


@router.post("/campaigns")
def create_campaign(data: EmailCampaignCreate):
    """Create a new email campaign."""
    campaign_id = db.create_email_campaign(
        name=data.name,
        description=data.description,
        num_emails=data.num_emails,
        days_between_emails=data.days_between_emails
    )
    return db.get_email_campaign(campaign_id)


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int):
    """Get a single campaign with templates and stats."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    # db.get_email_campaign already includes templates, but add stats
    campaign['stats'] = db.get_email_campaign_stats(campaign_id)
    return campaign


@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, data: EmailCampaignUpdate):
    """Update a campaign."""
    existing = db.get_email_campaign(campaign_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    db.update_email_campaign(
        campaign_id,
        name=data.name,
        description=data.description,
        num_emails=data.num_emails,
        days_between_emails=data.days_between_emails,
        status=data.status
    )
    
    return db.get_email_campaign(campaign_id)


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int):
    """Delete a campaign."""
    existing = db.get_email_campaign(campaign_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    db.delete_email_campaign(campaign_id)
    return {"deleted": True}


@router.post("/campaigns/{campaign_id}/activate")
def activate_campaign(campaign_id: int):
    """Activate a campaign (start sending emails)."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    # Check if campaign has templates
    templates = db.get_email_templates(campaign_id)
    if len(templates) < campaign['num_emails']:
        raise HTTPException(
            status_code=400, 
            detail=f"Campaign needs {campaign['num_emails']} templates, only has {len(templates)}"
        )
    
    db.update_email_campaign(campaign_id, status='active')
    return {"status": "active"}


@router.post("/campaigns/{campaign_id}/pause")
def pause_campaign(campaign_id: int):
    """Pause a campaign (stop sending emails)."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    db.update_email_campaign(campaign_id, status='paused')
    return {"status": "paused"}


# ============ Template Endpoints ============

@router.get("/campaigns/{campaign_id}/templates")
def get_templates(campaign_id: int):
    """Get all templates for a campaign."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    return db.get_email_templates(campaign_id)


@router.post("/campaigns/{campaign_id}/templates")
def save_template(campaign_id: int, data: EmailTemplateCreate):
    """Save or update a template for a campaign step."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    if data.step_number < 1 or data.step_number > campaign['num_emails']:
        raise HTTPException(
            status_code=400,
            detail=f"Step number must be between 1 and {campaign['num_emails']}"
        )
    
    db.save_email_template(
        campaign_id=campaign_id,
        step_number=data.step_number,
        subject_template=data.subject_template,
        body_template=data.body_template
    )
    
    return db.get_email_templates(campaign_id)


@router.post("/campaigns/{campaign_id}/templates/bulk")
def save_templates_bulk(campaign_id: int, templates: List[EmailTemplateCreate]):
    """Save multiple templates at once."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    for template in templates:
        if template.step_number < 1 or template.step_number > campaign['num_emails']:
            continue
        
        db.save_email_template(
            campaign_id=campaign_id,
            step_number=template.step_number,
            subject_template=template.subject_template,
            body_template=template.body_template
        )
    
    return db.get_email_templates(campaign_id)


# ============ Contact Enrollment Endpoints ============

@router.get("/campaigns/{campaign_id}/contacts")
def get_campaign_contacts(campaign_id: int, status: Optional[str] = None):
    """Get contacts enrolled in a campaign."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    return db.get_campaign_contacts(campaign_id, status=status)


@router.post("/campaigns/{campaign_id}/enroll")
def enroll_contacts(campaign_id: int, data: EnrollContactsRequest):
    """Enroll contacts in a campaign."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    result = db.enroll_contacts_in_campaign(campaign_id, data.contact_ids)
    return result


@router.delete("/campaigns/{campaign_id}/contacts/{campaign_contact_id}")
def remove_contact(campaign_id: int, campaign_contact_id: int):
    """Remove a contact from a campaign."""
    db.remove_contact_from_campaign(campaign_contact_id)
    return {"removed": True}


# ============ Email Sending Endpoints ============

@router.post("/send")
async def send_campaign_emails(data: SendEmailsRequest, background_tasks: BackgroundTasks):
    """
    Start sending campaign emails.
    Launches Salesforce automation in a separate process.
    """
    try:
        # Check campaign info if provided
        campaign_info = ""
        if data.campaign_id:
            campaign = db.get_email_campaign(data.campaign_id)
            if not campaign:
                return {
                    'success': False,
                    'error': f'Campaign {data.campaign_id} not found',
                    'ready_count': 0
                }
            if campaign['status'] != 'active':
                return {
                    'success': False,
                    'error': f'Campaign is not active (status: {campaign["status"]}). Activate it first.',
                    'ready_count': 0
                }
            
            # Check enrolled contacts
            enrolled = db.get_campaign_contacts(data.campaign_id)
            if not enrolled:
                return {
                    'success': False,
                    'error': 'No contacts enrolled in this campaign. Enroll contacts first.',
                    'ready_count': 0
                }
            campaign_info = f"Campaign: {campaign['name']}, {len(enrolled)} contacts enrolled. "
        
        # Check if there are contacts ready to send
        contacts = db.get_contacts_ready_for_email(
            campaign_id=data.campaign_id,
            limit=data.limit or 10
        )
        
        if not contacts:
            # Give more specific feedback
            if data.campaign_id:
                # Check why no contacts are ready
                conn = db.get_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT 
                        cc.id,
                        cc.status,
                        cc.current_step,
                        cc.next_email_at,
                        ec.num_emails,
                        lc.name
                    FROM campaign_contacts cc
                    JOIN linkedin_contacts lc ON cc.contact_id = lc.id
                    JOIN email_campaigns ec ON cc.campaign_id = ec.id
                    WHERE cc.campaign_id = ?
                    LIMIT 5
                """, (data.campaign_id,))
                samples = cursor.fetchall()
                conn.close()
                
                if samples:
                    details = []
                    for s in samples:
                        details.append(f"{s['name']}: status={s['status']}, step={s['current_step']}/{s['num_emails']}, next_at={s['next_email_at']}")
                    return {
                        'success': False,
                        'error': f'No contacts ready. Sample contacts:\n' + '\n'.join(details),
                        'ready_count': 0
                    }
            
            return {
                'success': False,
                'error': 'No contacts ready to receive emails. Check that contacts are enrolled and campaign is active.',
                'ready_count': 0
            }
        
        # Launch the email sender in a separate console window
        script_content = f'''
import asyncio
import sys
sys.path.insert(0, r"{config.BASE_DIR}")

from services.salesforce_email_sender import run_campaign_email_sender

print("="*60)
print("SALESFORCE EMAIL SENDER")
print("="*60)
print("Campaign ID: {data.campaign_id or 'All'}")
print("Contacts to process: {len(contacts)}")
print("Review Mode: {data.review_mode}")
print("="*60)

try:
    result = asyncio.run(run_campaign_email_sender(
        campaign_id={data.campaign_id or 'None'},
        limit={data.limit or len(contacts)},
        headless=False,
        review_mode={data.review_mode}
    ))

    import json
    print("\\n" + "="*60)
    print("RESULTS:", json.dumps(result, indent=2))
    print("="*60)
except Exception as e:
    import traceback
    print("\\n" + "="*60)
    print("ERROR:", str(e))
    print(traceback.format_exc())
    print("="*60)

input("\\nPress ENTER to close...")
'''
        
        # Write temporary script
        script_path = config.DATA_DIR / "run_email_sender.py"
        with open(script_path, 'w') as f:
            f.write(script_content)
        
        # Launch in separate console
        subprocess.Popen(
            [sys.executable, str(script_path)],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
            cwd=str(config.BASE_DIR)
        )
        
        return {
            'success': True,
            'message': f'{campaign_info}Launched sender with {len(contacts)} contacts ready',
            'ready_count': len(contacts)
        }
        
    except Exception as e:
        import traceback
        return {
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }


@router.get("/queue")
def get_email_queue(campaign_id: Optional[int] = None, limit: int = 50):
    """Get contacts waiting to receive their next email."""
    contacts = db.get_contacts_ready_for_email(campaign_id=campaign_id, limit=limit)
    return contacts


# ============ Sent Email History Endpoints ============

@router.get("/sent")
def get_sent_emails(
    campaign_id: Optional[int] = None,
    contact_id: Optional[int] = None,
    limit: int = 100
):
    """Get sent email history."""
    return db.get_sent_emails(
        campaign_id=campaign_id,
        contact_id=contact_id,
        limit=limit
    )


# ============ Stats Endpoints ============

@router.get("/stats")
def get_email_stats():
    """Get overall email campaign statistics."""
    return db.get_email_campaign_stats()


@router.get("/campaigns/{campaign_id}/stats")
def get_campaign_stats(campaign_id: int):
    """Get statistics for a specific campaign."""
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    stats = db.get_email_campaign_stats(campaign_id)
    tracking = db.get_campaign_tracking_stats(campaign_id)
    stats.update(tracking)
    return stats


# ============ Review Queue Endpoints ============

class EmailApproveRequest(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None

class BulkApproveRequest(BaseModel):
    email_ids: List[int]


@router.get("/review-queue")
def get_review_queue():
    """Get all emails pending review."""
    return db.get_review_queue()


@router.post("/review-queue/{email_id}/approve")
def approve_email(email_id: int, data: Optional[EmailApproveRequest] = None):
    """Approve a single email. Body can include edited subject/body."""
    db.approve_email(
        email_id,
        edited_subject=data.subject if data else None,
        edited_body=data.body if data else None
    )
    return {"success": True}


@router.post("/review-queue/{email_id}/reject")
def reject_email(email_id: int):
    """Reject a single email."""
    db.reject_email(email_id)
    return {"success": True}


@router.post("/review-queue/approve-all")
def approve_all(data: BulkApproveRequest):
    """Bulk approve emails."""
    db.approve_all_emails(data.email_ids)
    return {"success": True, "approved": len(data.email_ids)}


@router.post("/prepare-batch")
async def prepare_batch():
    """Manually trigger daily batch preparation."""
    from services.email_preparer import prepare_daily_batch
    result = await prepare_daily_batch()
    return result


# ============ Tracking Endpoints ============

@router.get("/tracking-status")
def get_tracking_status(days: int = 7):
    """Get recent tracking data for dashboard display."""
    return db.get_tracking_stats(days=days)


@router.post("/poll-tracking")
async def poll_tracking():
    """Manually trigger Salesforce tracking poll."""
    from services.salesforce_tracker import poll_salesforce_tracking
    result = await poll_salesforce_tracking()
    return result


# ============ Scheduled Emails Endpoints ============

@router.get("/scheduled")
def get_scheduled():
    """Get approved emails with scheduled send times."""
    return db.get_scheduled_emails(limit=50)


@router.post("/process-scheduled")
async def process_scheduled():
    """Process scheduled emails that are due for sending.
    Launches Salesforce automation for approved+due emails."""
    try:
        emails = db.get_scheduled_emails(limit=10)
        if not emails:
            return {'success': True, 'message': 'No emails due for sending', 'processed': 0}
        
        # Launch the sender in a separate process
        script_content = f'''
import asyncio
import sys
sys.path.insert(0, r"{config.BASE_DIR}")

from services.salesforce_email_sender import process_approved_emails

print("="*60)
print("SALESFORCE SCHEDULED SENDER")
print("="*60)
print("Emails to process: {len(emails)}")
print("="*60)

try:
    result = asyncio.run(process_approved_emails(limit={len(emails)}))
    import json
    print("\\n" + "="*60)
    print("RESULTS:", json.dumps(result, indent=2))
    print("="*60)
except Exception as e:
    import traceback
    print("\\n" + "="*60)
    print("ERROR:", str(e))
    print(traceback.format_exc())
    print("="*60)

input("\\nPress ENTER to close...")
'''
        script_path = config.DATA_DIR / "run_scheduled_sender.py"
        with open(script_path, 'w') as f:
            f.write(script_content)
        
        subprocess.Popen(
            [sys.executable, str(script_path)],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
            cwd=str(config.BASE_DIR)
        )
        
        return {
            'success': True,
            'message': f'Launched sender for {len(emails)} scheduled emails',
            'count': len(emails)
        }
    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e), 'traceback': traceback.format_exc()}


# ============ Config Endpoints ============

@router.get("/config")
def get_email_config():
    """Get all email system config values."""
    return db.get_all_config()


@router.put("/config")
def update_email_config(data: dict):
    """Update config values (daily cap, send window, etc.)."""
    allowed_keys = {
        'daily_send_cap', 'send_window_start', 'send_window_end',
        'min_minutes_between_sends', 'tracking_poll_interval_minutes',
        'tracking_lookback_days'
    }
    updated = []
    for key, value in data.items():
        if key in allowed_keys:
            db.set_config(key, str(value))
            updated.append(key)
    return {"success": True, "updated": updated}


# ============ Generate Preview Endpoint ============

@router.post("/campaigns/{campaign_id}/salesforce-upload")
async def upload_campaign_to_salesforce(campaign_id: int):
    """
    Export campaign contacts to Salesforce-compatible CSV and open browser to Data Importer.
    Uses the same format as the bulk upload from Contacts page.
    """
    import csv
    import io
    
    try:
        # Get campaign
        campaign = db.get_email_campaign(campaign_id)
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        # Get all contacts enrolled in this campaign
        campaign_contacts = db.get_campaign_contacts(campaign_id)
        
        if not campaign_contacts:
            return {'success': False, 'error': 'No contacts enrolled in this campaign'}
        
        # Extract contact IDs to fetch full contact data
        contact_ids = [cc['contact_id'] for cc in campaign_contacts]
        
        # Generate unique batch ID
        batch_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        batch_timestamp = datetime.now().isoformat()
        
        # Get full contact data
        conn = db.get_connection()
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(contact_ids))
        cursor.execute(f"""
            SELECT id, company_name, domain, name, title, email_generated as email, linkedin_url, salesforce_uploaded_at
            FROM linkedin_contacts 
            WHERE id IN ({placeholders})
        """, contact_ids)
        rows = cursor.fetchall()
        conn.close()
        
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
        
        if not contacts:
            if already_uploaded:
                return {
                    'success': False,
                    'error': f'All {len(already_uploaded)} contacts in this campaign have already been uploaded to Salesforce',
                    'already_uploaded': already_uploaded
                }
            return {'success': False, 'error': 'No contacts available for upload'}
        
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
        export_filename = f"salesforce_campaign_{campaign_id}_{batch_id}.csv"
        export_path = config.DATA_DIR / export_filename
        with open(export_path, 'w', newline='', encoding='utf-8') as f:
            f.write(output.getvalue())
        
        print(f"[Campaign Salesforce Upload] CSV saved to: {export_path}")
        
        # Save batch info for later confirmation
        import json
        batch_file = config.DATA_DIR / f"sf_batch_{batch_id}.json"
        with open(batch_file, 'w') as f:
            json.dump({
                'contact_ids': [c['id'] for c in contacts],
                'batch_id': batch_id,
                'batch_timestamp': batch_timestamp,
                'csv_file': str(export_path),
                'campaign_id': campaign_id,
                'campaign_name': campaign['name']
            }, f)
        
        # Launch Salesforce browser in a SEPARATE CONSOLE WINDOW
        script_path = config.BASE_DIR / 'salesforce_upload.py'
        
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
            'campaign_name': campaign['name'],
            'message': f'CSV created with {len(contacts)} contacts from "{campaign["name"]}". Salesforce browser opened - upload the CSV!'
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[Campaign Salesforce Upload] ERROR: {e}")
        return {'success': False, 'error': str(e), 'traceback': traceback.format_exc()}


@router.post("/preview")
async def preview_email(campaign_id: int, contact_id: int, step_number: int = 1):
    """Generate a preview of what the email will look like."""
    from services.email_generator import generate_email_with_gpt4o
    
    # Get campaign and template
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    templates = db.get_email_templates(campaign_id)
    template = next((t for t in templates if t['step_number'] == step_number), None)
    if not template:
        raise HTTPException(status_code=404, detail=f"No template for step {step_number}")
    
    # Get contact
    conn = db.get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, title, company_name, domain, email_generated as email
        FROM linkedin_contacts WHERE id = ?
    """, (contact_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    contact = {
        'name': row[1],
        'title': row[2],
        'company_name': row[3],
        'domain': row[4],
        'email': row[5]
    }
    
    # Generate email
    try:
        campaign_data = {
            'title': campaign['name'],
            'description': campaign.get('description'),
            'subject_template': template['subject_template'],
            'body_template': template['body_template']
        }
        
        subject, body = generate_email_with_gpt4o(campaign_data, contact)
        
        return {
            'subject': subject,
            'body': body,
            'contact': contact,
            'step': step_number
        }
    except Exception as e:
        return {
            'subject': template['subject_template'].replace('{company}', contact.get('company_name', '')),
            'body': template['body_template'].replace('{name}', contact.get('name', '')),
            'contact': contact,
            'step': step_number,
            'error': str(e)
        }

