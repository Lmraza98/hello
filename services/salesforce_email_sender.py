"""
Salesforce Email Sender - Campaign email automation through Salesforce.
PARALLEL processing - opens multiple tabs and processes in batches.
"""
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, List

import config
import database as db
from services.salesforce_sender import SalesforceSender


async def run_campaign_email_sender(
    campaign_id: int = None,
    limit: int = None,
    headless: bool = False,
    review_mode: bool = True,
    template_name: str = "Footer",
    batch_size: int = 20  # Process in batches of 20 tabs at a time
) -> Dict:
    """
    Process pending campaign emails using Salesforce automation.
    Opens multiple tabs and processes in batches for reliability.
    """
    from services.email_generator import generate_email_with_gpt4o
    
    if review_mode and headless:
        print("[SFEmailSender] Review mode requires visible browser")
        headless = False
    
    sender = SalesforceSender()
    
    try:
        # Start browser and authenticate
        print("[SFEmailSender] Starting browser and authenticating...")
        if not await sender.start(headless=headless):
            return {'error': 'Authentication failed', 'processed': 0}
        
        # Get contacts
        limit = limit or 100
        contacts = db.get_contacts_ready_for_email(campaign_id=campaign_id, limit=limit)
        
        if not contacts:
            print("[SFEmailSender] No contacts ready for email")
            input("Press ENTER to close browser...")
            await sender.stop()
            return {'processed': 0, 'ready': 0, 'failed': 0}
        
        num_contacts = len(contacts)
        print(f"\n[SFEmailSender] Found {num_contacts} contacts")
        
        # Generate ALL emails first (this is fast)
        print(f"\n[SFEmailSender] Generating {num_contacts} personalized emails...")
        
        tasks_to_process = []
        for i, contact in enumerate(contacts):
            contact_name = contact.get('contact_name', '')
            company_name = contact.get('company_name', '')
            
            step = contact.get('current_step', 0) + 1
            templates = db.get_email_templates(contact['campaign_id'])
            template = next((t for t in templates if t['step_number'] == step), None)
            
            if not template:
                print(f"  [{i+1}] {contact_name}: No template, skipping")
                continue
            
            try:
                campaign_data = {
                    'title': contact.get('campaign_name', 'Outreach'),
                    'subject_template': template['subject_template'],
                    'body_template': template['body_template']
                }
                contact_data = {
                    'name': contact_name,
                    'title': contact.get('title'),
                    'company_name': company_name,
                    'domain': contact.get('domain')
                }
                subject, body = generate_email_with_gpt4o(campaign_data, contact_data)
                print(f"  [{i+1}] {contact_name}: Generated")
            except Exception as e:
                print(f"  [{i+1}] {contact_name}: Using template (GPT failed)")
                subject = template['subject_template']
                body = template['body_template']
                for old, new in [('{company}', company_name), ('{Company}', company_name),
                                 ('{name}', contact_name), ('{Name}', contact_name),
                                 ('{FirstName}', contact_name.split()[0] if contact_name else '')]:
                    subject = subject.replace(old, new)
                    body = body.replace(old, new)
            
            tasks_to_process.append({
                'contact': contact,
                'subject': subject,
                'body': body,
                'step': step
            })
        
        if not tasks_to_process:
            print("[SFEmailSender] No valid tasks")
            input("Press ENTER to close browser...")
            await sender.stop()
            return {'processed': 0, 'ready': 0, 'failed': 0}
        
        # Open tabs - one per contact
        num_tabs = len(tasks_to_process)
        print(f"\n[SFEmailSender] Opening {num_tabs} browser tabs...")
        
        for i in range(num_tabs - 1):  # We already have 1 tab
            page = await sender.context.new_page()
            sender.pages.append(page)
        
        print(f"[SFEmailSender] {len(sender.pages)} tabs ready")
        
        # Process in BATCHES
        summary = {'processed': 0, 'ready': 0, 'failed': 0, 'details': []}
        ready_tabs = []
        
        num_batches = (num_tabs + batch_size - 1) // batch_size
        
        for batch_num in range(num_batches):
            start_idx = batch_num * batch_size
            end_idx = min(start_idx + batch_size, num_tabs)
            batch_tasks = tasks_to_process[start_idx:end_idx]
            
            print(f"\n{'='*60}")
            print(f"BATCH {batch_num + 1}/{num_batches}: Processing tabs {start_idx + 1} to {end_idx}")
            print(f"{'='*60}")
            
            async def process_one_tab(task_idx, task):
                """Process one contact in its tab."""
                page = sender.pages[task_idx]
                contact = task['contact']
                contact_name = contact.get('contact_name', '')
                contact_email = contact.get('email', '')
                company_name = contact.get('company_name', '')
                
                tab_num = task_idx + 1
                print(f"\n  [Tab {tab_num}] Starting: {contact_name}")
                
                try:
                    # Search for Lead - this navigates to SF and searches
                    print(f"  [Tab {tab_num}] Searching in Salesforce...")
                    lead_url = await sender.find_lead(page, contact_email, contact_name, company_name)
                    
                    if not lead_url:
                        print(f"  [Tab {tab_num}] Lead NOT FOUND")
                        return {
                            'task_idx': task_idx,
                            'task': task,
                            'success': False,
                            'error': 'Lead not found in Salesforce'
                        }
                    
                    print(f"  [Tab {tab_num}] Lead found: {lead_url[:60]}...")
                    
                    # Open email composer
                    print(f"  [Tab {tab_num}] Opening email composer...")
                    if not await sender.click_send_email(page):
                        return {
                            'task_idx': task_idx,
                            'task': task,
                            'success': False,
                            'error': 'Could not open email composer',
                            'lead_url': lead_url
                        }
                    
                    # Select template
                    print(f"  [Tab {tab_num}] Selecting template...")
                    await sender.select_template(page, template_name)
                    
                    # Fill email
                    print(f"  [Tab {tab_num}] Filling email content...")
                    await sender.fill_email_body(page, task['subject'], task['body'])
                    
                    print(f"  [Tab {tab_num}] READY - {contact_name}")
                    return {
                        'task_idx': task_idx,
                        'task': task,
                        'success': True,
                        'ready_to_send': True,
                        'lead_url': lead_url
                    }
                    
                except Exception as e:
                    print(f"  [Tab {tab_num}] ERROR: {e}")
                    import traceback
                    traceback.print_exc()
                    return {
                        'task_idx': task_idx,
                        'task': task,
                        'success': False,
                        'error': str(e)
                    }
            
            # Process this batch in parallel
            batch_results = await asyncio.gather(
                *[process_one_tab(start_idx + i, task) for i, task in enumerate(batch_tasks)],
                return_exceptions=True
            )
            
            # Process batch results
            for result in batch_results:
                if isinstance(result, Exception):
                    print(f"  Exception in batch: {result}")
                    summary['failed'] += 1
                    continue
                
                task = result['task']
                contact = task['contact']
                summary['processed'] += 1
                
                if result.get('success'):
                    summary['ready'] += 1
                    ready_tabs.append({
                        'tab_index': result['task_idx'],
                        'contact': contact,
                        'task': task,
                        'result': result
                    })
                    if result.get('lead_url'):
                        db.update_campaign_contact(contact['id'], sf_lead_url=result['lead_url'])
                else:
                    summary['failed'] += 1
                    db.log_sent_email(
                        campaign_id=contact['campaign_id'],
                        campaign_contact_id=contact['id'],
                        contact_id=contact['contact_id'],
                        step_number=task['step'],
                        subject=task['subject'],
                        body=task['body'],
                        status='failed',
                        error_message=result.get('error')
                    )
            
            # Brief pause between batches
            if batch_num < num_batches - 1:
                print(f"\n  Pausing before next batch...")
                await asyncio.sleep(2)
        
        # Final summary
        print(f"\n{'='*60}")
        print(f"ALL BATCHES COMPLETE")
        print(f"  Ready: {summary['ready']} tabs")
        print(f"  Failed: {summary['failed']}")
        print(f"{'='*60}")
        
        if ready_tabs:
            print(f"\n{len(ready_tabs)} emails ready in browser:")
            for rt in ready_tabs:
                c = rt['contact']
                print(f"  Tab {rt['tab_index']+1}: {c.get('contact_name')} ({c.get('email')})")
            
            print(f"\n" + "="*60)
            print("Switch between tabs and click SEND on each email.")
            print("When done, press ENTER to log all as sent.")
            print("="*60)
            input("\n>>> Press ENTER when finished...")
            
            # Log as sent
            for rt in ready_tabs:
                contact = rt['contact']
                task = rt['task']
                
                db.log_sent_email(
                    campaign_id=contact['campaign_id'],
                    campaign_contact_id=contact['id'],
                    contact_id=contact['contact_id'],
                    step_number=task['step'],
                    subject=task['subject'],
                    body=task['body'],
                    sf_lead_url=rt['result'].get('lead_url'),
                    status='sent'
                )
                
                days = contact.get('days_between_emails', 3)
                next_email_at = (datetime.now() + timedelta(days=days)).isoformat()
                new_status = 'completed' if task['step'] >= contact.get('num_emails', 3) else 'active'
                
                db.update_campaign_contact(
                    contact['id'],
                    current_step=task['step'],
                    status=new_status,
                    next_email_at=next_email_at if new_status == 'active' else None
                )
            
            print(f"[SFEmailSender] Logged {len(ready_tabs)} emails as sent")
        
        await sender.stop()
        return summary
        
    except Exception as e:
        import traceback
        print(f"\n[SFEmailSender] FATAL ERROR: {e}")
        traceback.print_exc()
        try:
            await sender.stop()
        except:
            pass
        return {'error': str(e), 'processed': 0}


async def process_approved_emails(
    limit: int = 10,
    headless: bool = False,
    template_name: str = "Footer",
    batch_size: int = 20
) -> Dict:
    """
    Process approved+scheduled emails through Salesforce.
    This is the new flow: only picks up emails with review_status='approved'
    and scheduled_send_time <= now.
    """
    sender = SalesforceSender()
    
    try:
        print("[SFScheduledSender] Starting browser and authenticating...")
        if not await sender.start(headless=headless):
            return {'error': 'Authentication failed', 'processed': 0}
        
        # Get scheduled emails that are due
        emails = db.get_scheduled_emails(limit=limit)
        
        if not emails:
            print("[SFScheduledSender] No scheduled emails due for sending")
            input("Press ENTER to close browser...")
            await sender.stop()
            return {'processed': 0, 'sent': 0, 'failed': 0}
        
        num_emails = len(emails)
        print(f"\n[SFScheduledSender] Found {num_emails} emails to send")
        
        # Open tabs - one per email
        for i in range(num_emails - 1):
            page = await sender.context.new_page()
            sender.pages.append(page)
        
        print(f"[SFScheduledSender] {len(sender.pages)} tabs ready")
        
        summary = {'processed': 0, 'sent': 0, 'failed': 0, 'details': []}
        ready_tabs = []
        
        num_batches = (num_emails + batch_size - 1) // batch_size
        
        for batch_num in range(num_batches):
            start_idx = batch_num * batch_size
            end_idx = min(start_idx + batch_size, num_emails)
            batch_emails = emails[start_idx:end_idx]
            
            print(f"\n{'='*60}")
            print(f"BATCH {batch_num + 1}/{num_batches}: Processing tabs {start_idx + 1} to {end_idx}")
            print(f"{'='*60}")
            
            async def process_one_tab(task_idx, email):
                """Process one approved email in its tab."""
                page = sender.pages[task_idx]
                contact_name = email.get('contact_name', '')
                contact_email = email.get('contact_email', '')
                company_name = email.get('company_name', '')
                
                # Use rendered content (AI-personalized)
                subject = email.get('rendered_subject') or email.get('subject', '')
                body = email.get('rendered_body') or email.get('body', '')
                
                tab_num = task_idx + 1
                print(f"\n  [Tab {tab_num}] Starting: {contact_name}")
                
                try:
                    print(f"  [Tab {tab_num}] Searching in Salesforce...")
                    lead_url = await sender.find_lead(page, contact_email, contact_name, company_name)
                    
                    if not lead_url:
                        print(f"  [Tab {tab_num}] Lead NOT FOUND")
                        return {
                            'task_idx': task_idx,
                            'email': email,
                            'success': False,
                            'error': 'Lead not found in Salesforce'
                        }
                    
                    print(f"  [Tab {tab_num}] Lead found: {lead_url[:60]}...")
                    
                    print(f"  [Tab {tab_num}] Opening email composer...")
                    if not await sender.click_send_email(page):
                        return {
                            'task_idx': task_idx,
                            'email': email,
                            'success': False,
                            'error': 'Could not open email composer',
                            'lead_url': lead_url
                        }
                    
                    print(f"  [Tab {tab_num}] Selecting template...")
                    await sender.select_template(page, template_name)
                    
                    print(f"  [Tab {tab_num}] Filling email content...")
                    await sender.fill_email_body(page, subject, body)
                    
                    print(f"  [Tab {tab_num}] READY - {contact_name}")
                    return {
                        'task_idx': task_idx,
                        'email': email,
                        'success': True,
                        'ready_to_send': True,
                        'lead_url': lead_url
                    }
                    
                except Exception as e:
                    print(f"  [Tab {tab_num}] ERROR: {e}")
                    import traceback
                    traceback.print_exc()
                    return {
                        'task_idx': task_idx,
                        'email': email,
                        'success': False,
                        'error': str(e)
                    }
            
            batch_results = await asyncio.gather(
                *[process_one_tab(start_idx + i, email) for i, email in enumerate(batch_emails)],
                return_exceptions=True
            )
            
            for result in batch_results:
                if isinstance(result, Exception):
                    print(f"  Exception in batch: {result}")
                    summary['failed'] += 1
                    continue
                
                email = result['email']
                summary['processed'] += 1
                
                if result.get('success'):
                    ready_tabs.append({
                        'tab_index': result['task_idx'],
                        'email': email,
                        'result': result
                    })
                else:
                    summary['failed'] += 1
                    db.mark_email_failed(email['id'], error_message=result.get('error'))
            
            if batch_num < num_batches - 1:
                print(f"\n  Pausing before next batch...")
                await asyncio.sleep(2)
        
        # Final summary
        print(f"\n{'='*60}")
        print(f"ALL BATCHES COMPLETE")
        print(f"  Ready: {len(ready_tabs)} tabs")
        print(f"  Failed: {summary['failed']}")
        print(f"{'='*60}")
        
        if ready_tabs:
            print(f"\n{len(ready_tabs)} emails ready in browser:")
            for rt in ready_tabs:
                e = rt['email']
                print(f"  Tab {rt['tab_index']+1}: {e.get('contact_name')} ({e.get('contact_email')})")
            
            print(f"\n" + "="*60)
            print("Switch between tabs and click SEND on each email.")
            print("When done, press ENTER to log all as sent.")
            print("="*60)
            input("\n>>> Press ENTER when finished...")
            
            # Log as sent and update campaign contacts
            for rt in ready_tabs:
                email = rt['email']
                
                db.mark_email_sent(email['id'], sf_lead_url=rt['result'].get('lead_url'))
                
                # Update campaign contact progress
                days = email.get('days_between_emails', 3)
                from datetime import timedelta
                next_email_at = (datetime.now() + timedelta(days=days)).isoformat()
                step = email.get('step_number', 1)
                num_emails_in_campaign = email.get('num_emails', 3)
                new_status = 'completed' if step >= num_emails_in_campaign else 'active'
                
                campaign_contact_id = email.get('campaign_contact_id')
                if campaign_contact_id:
                    db.update_campaign_contact(
                        campaign_contact_id,
                        current_step=step,
                        status=new_status,
                        sf_lead_url=rt['result'].get('lead_url'),
                        next_email_at=next_email_at if new_status == 'active' else None
                    )
                
                summary['sent'] += 1
            
            print(f"[SFScheduledSender] Logged {len(ready_tabs)} emails as sent")
        
        await sender.stop()
        return summary
        
    except Exception as e:
        import traceback
        print(f"\n[SFScheduledSender] FATAL ERROR: {e}")
        traceback.print_exc()
        try:
            await sender.stop()
        except:
            pass
        return {'error': str(e), 'processed': 0}


if __name__ == "__main__":
    import sys
    
    mode = sys.argv[1] if len(sys.argv) > 1 else 'legacy'
    
    if mode == 'scheduled':
        # New flow: process approved+scheduled emails
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        result = asyncio.run(process_approved_emails(limit=limit, headless=False))
    else:
        # Legacy flow: process all ready contacts
        campaign_id = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
        result = asyncio.run(run_campaign_email_sender(
            campaign_id=campaign_id,
            limit=limit,
            headless=False,
            review_mode=True
        ))
    
    import json
    print(f"\nResults: {json.dumps(result, indent=2)}")
