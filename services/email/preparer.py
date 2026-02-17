"""
Email Preparer Service — Daily batch preparation for email campaigns.

Queries contacts ready for their next email, personalizes using AI,
and creates draft entries for human review before sending.
"""
import traceback
from datetime import datetime
from typing import Dict

import config
import database as db
from services.email.generator import generate_email_with_gpt4o


async def prepare_daily_batch() -> Dict:
    """
    Main entry point. Called by scheduler or manually via API.
    
    1. Check daily cap: get_todays_draft_count() vs config daily_send_cap
    2. Query contacts ready for email: get_contacts_ready_for_email()
    3. For each (up to remaining cap):
       a. Get the template for their current_step + 1
       b. Personalize subject + body using AI
       c. Create a sent_emails row with review_status='ready_for_review',
          rendered_subject and rendered_body populated
    4. Return count of drafts created
    """
    daily_cap = int(db.get_config('daily_send_cap', '20'))
    already_created = db.get_todays_draft_count()
    remaining = max(0, daily_cap - already_created)
    
    if remaining == 0:
        return {
            'success': True,
            'drafts_created': 0,
            'message': f'Daily cap reached ({daily_cap}). {already_created} already created today.',
            'daily_cap': daily_cap,
            'already_created': already_created
        }
    
    # Get contacts ready for email
    contacts = db.get_contacts_ready_for_email(limit=remaining)
    
    if not contacts:
        return {
            'success': True,
            'drafts_created': 0,
            'message': 'No contacts ready for email.',
            'daily_cap': daily_cap,
            'already_created': already_created
        }
    
    drafts_created = 0
    errors = []
    
    for contact in contacts:
        try:
            step = contact.get('current_step', 0) + 1
            templates = db.get_email_templates(contact['campaign_id'])
            template = next((t for t in templates if t['step_number'] == step), None)
            
            if not template:
                errors.append(f"{contact.get('contact_name', 'Unknown')}: No template for step {step}")
                continue
            
            contact_name = contact.get('contact_name', '')
            company_name = contact.get('company_name', '')
            
            # Build campaign and contact data for the generator
            campaign_data = {
                'title': contact.get('campaign_name', 'Outreach'),
                'description': '',
                'subject_template': template['subject_template'],
                'body_template': template['body_template']
            }
            contact_data = {
                'name': contact_name,
                'title': contact.get('title'),
                'company_name': company_name,
                'domain': contact.get('domain')
            }
            
            # Generate personalized email
            try:
                subject, body = generate_email_with_gpt4o(campaign_data, contact_data)
            except Exception as e:
                print(f"[EmailPreparer] AI generation failed for {contact_name}: {e}")
                # Fallback to basic template replacement
                subject = template['subject_template']
                body = template['body_template']
                for old, new in [
                    ('{company}', company_name), ('{Company}', company_name),
                    ('{name}', contact_name), ('{Name}', contact_name),
                    ('{FirstName}', contact_name.split()[0] if contact_name else ''),
                    ('{title}', contact.get('title', '')),
                ]:
                    subject = subject.replace(old, new)
                    body = body.replace(old, new)
            
            # Create the draft entry in sent_emails
            email_id = db.log_sent_email(
                campaign_id=contact['campaign_id'],
                campaign_contact_id=contact['id'],
                contact_id=contact['contact_id'],
                step_number=step,
                subject=template['subject_template'],  # Raw template
                body=template['body_template'],          # Raw template
                sf_lead_url=contact.get('sf_lead_url'),
                status='draft',
            )
            
            # Update with rendered content and review status
            if email_id and email_id > 0:
                with db.get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE sent_emails 
                        SET rendered_subject = ?,
                            rendered_body = ?,
                            review_status = 'ready_for_review'
                        WHERE id = ?
                    """, (subject, body, email_id))
                
                drafts_created += 1
                print(f"[EmailPreparer] Draft created for {contact_name} ({company_name}) — step {step}")
        
        except Exception as e:
            error_msg = f"{contact.get('contact_name', 'Unknown')}: {str(e)}"
            errors.append(error_msg)
            print(f"[EmailPreparer] Error: {error_msg}")
            traceback.print_exc()
    
    result = {
        'success': True,
        'drafts_created': drafts_created,
        'contacts_checked': len(contacts),
        'daily_cap': daily_cap,
        'already_created': already_created,
        'remaining_cap': daily_cap - already_created - drafts_created,
        'message': f'Created {drafts_created} draft emails for review.'
    }
    
    if errors:
        result['errors'] = errors
    
    return result
