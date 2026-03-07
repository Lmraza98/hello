"""
Salesforce Email Sender - Campaign email automation through Salesforce.
PARALLEL processing - opens multiple tabs and processes in batches.
"""
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, List

import config
import database as db
from services.email.salesforce_automation import SalesforceSender
from services.email.template_linked_resolver import render_linked_template_for_contact


async def _enrich_campaign_missing_email_urls(sender: SalesforceSender, campaign_id: int, limit: int = 500) -> Dict:
    """
    Backfill missing sf_email_url for already-sent rows from lead timeline.
    Runs once before campaign processing so follow-up steps can open EmailMessage directly.
    """
    rows = db.get_campaign_contacts_missing_sf_email_urls(campaign_id=campaign_id, limit=limit)
    if not rows:
        return {"checked": 0, "updated_rows": 0}

    page = sender.pages[0] if sender.pages else None
    if page is None:
        return {"checked": 0, "updated_rows": 0}

    checked = 0
    updated_rows = 0
    for row in rows:
        lead_url = (row.get("sf_lead_url") or "").strip()
        if not lead_url:
            continue
        checked += 1
        try:
            await page.goto(lead_url, wait_until="domcontentloaded", timeout=30_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass
            await asyncio.sleep(0.8)
            urls = await sender.get_timeline_email_urls(page, limit=30)
            if not urls:
                continue
            updated_rows += db.backfill_missing_sf_email_urls(
                campaign_contact_id=int(row["campaign_contact_id"]),
                email_urls=urls,
            )
        except Exception as e:
            print(f"[SFEmailSender] URL enrich failed campaign_contact_id={row.get('campaign_contact_id')}: {e}")

    return {"checked": int(checked), "updated_rows": int(updated_rows)}


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
    from services.email.generator import generate_email_with_gpt4o
    
    if review_mode and headless:
        print("[SFEmailSender] Review mode requires visible browser")
        headless = False
    
    sender = SalesforceSender()
    
    try:
        # Start browser and authenticate
        print("[SFEmailSender] Starting browser and authenticating...")
        if not await sender.start(headless=headless):
            return {'error': 'Authentication failed', 'processed': 0}

        if campaign_id:
            enrich = await _enrich_campaign_missing_email_urls(sender, campaign_id=campaign_id, limit=1000)
            print(
                "[SFEmailSender] Backfilled missing Salesforce EmailMessage URLs: "
                f"checked={enrich.get('checked', 0)} updated_rows={enrich.get('updated_rows', 0)}"
            )
        
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
            linked_render = render_linked_template_for_contact(contact)
            if linked_render:
                subject = linked_render.get('subject', '')
                body = linked_render.get('html', '')
                if linked_render.get("errors"):
                    print(f"  [{i+1}] {contact_name}: Linked template render error, skipping")
                    continue
                print(f"  [{i+1}] {contact_name}: Linked template rendered")
                tasks_to_process.append({
                    'contact': contact,
                    'subject': subject,
                    'body': body,
                    'step': step
                })
                continue
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
                first_name = contact_name.split()[0] if contact_name else ''
                last_name = " ".join(contact_name.split()[1:]) if contact_name and len(contact_name.split()) > 1 else ''
                for old, new in [('{company}', company_name), ('{Company}', company_name),
                                 ('{name}', contact_name), ('{Name}', contact_name),
                                 ('{FirstName}', first_name), ('{firstName}', first_name), ('{first_name}', first_name),
                                 ('{LastName}', last_name), ('{lastName}', last_name), ('{last_name}', last_name)]:
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
                    step = int(task.get('step') or 1)
                    lead_url = (contact.get('sf_lead_url') or "").strip() or None
                    previous_email_url = None
                    used_reply_flow = False

                    if step > 1:
                        previous_email_url = db.get_latest_sent_email_message_url(
                            campaign_contact_id=int(contact.get('id') or 0),
                            step_lt=step,
                        )
                        if not previous_email_url and lead_url:
                            try:
                                await page.goto(lead_url, wait_until="domcontentloaded", timeout=30_000)
                                try:
                                    await page.wait_for_load_state("networkidle", timeout=10_000)
                                except Exception:
                                    pass
                                recovered_urls = await sender.get_timeline_email_urls(page, limit=20)
                                if recovered_urls:
                                    db.backfill_missing_sf_email_urls(
                                        campaign_contact_id=int(contact.get('id') or 0),
                                        email_urls=recovered_urls,
                                    )
                                    previous_email_url = db.get_latest_sent_email_message_url(
                                        campaign_contact_id=int(contact.get('id') or 0),
                                        step_lt=step,
                                    )
                            except Exception:
                                pass
                        if previous_email_url:
                            print(f"  [Tab {tab_num}] Opening prior email and clicking Reply...")
                            used_reply_flow = await sender.open_email_message_reply(page, previous_email_url)
                            if not used_reply_flow:
                                return {
                                    'task_idx': task_idx,
                                    'task': task,
                                    'success': False,
                                    'error': 'Reply flow failed using prior EmailMessage URL',
                                    'lead_url': lead_url,
                                }

                    if not used_reply_flow:
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
                    
                    # First action in composer: maximize.
                    await sender.maximize_composer(page)
                    if used_reply_flow:
                        body_focused = await sender.focus_editor_body(page)
                        if not body_focused:
                            return {
                                'task_idx': task_idx,
                                'task': task,
                                'success': False,
                                'error': 'Failed to focus reply body iframe after maximize',
                                'lead_url': lead_url,
                            }

                    preserved_original_html = ""
                    preserved_subject = ""
                    if used_reply_flow:
                        preserved_subject = await sender.capture_current_subject(page)
                        preserved_original_html = await sender.capture_current_body_html(page)
                        cleared = await sender.clear_current_body(page)
                        if not cleared:
                            return {
                                'task_idx': task_idx,
                                'task': task,
                                'success': False,
                                'error': 'Failed to clear existing reply body before template insertion',
                                'lead_url': lead_url,
                            }
                    
                    # Select template
                    print(f"  [Tab {tab_num}] Selecting template...")
                    await sender.select_template(page, template_name)
                    
                    # Fill email
                    print(f"  [Tab {tab_num}] Filling email content...")
                    subject_to_fill = task['subject'] if not used_reply_flow else preserved_subject
                    if used_reply_flow:
                        filled_ok = await sender.fill_email_body_with_preserved_original(
                            page,
                            subject_to_fill,
                            task['body'],
                            preserved_original_html,
                        )
                    else:
                        filled_ok = await sender.fill_email_body(page, subject_to_fill, task['body'])
                    if not filled_ok:
                        return {
                            'task_idx': task_idx,
                            'task': task,
                            'success': False,
                            'error': 'Failed to fill email body after opening composer',
                            'lead_url': lead_url,
                        }
                    
                    if review_mode:
                        print(f"  [Tab {tab_num}] Preparing for manual approval...")
                        ready = await sender.send_email(page, skip_click=True)
                        if ready:
                            sf_email_url = await sender.get_latest_timeline_email_url(
                                page,
                                expected_subject=task.get('subject') or '',
                            )
                            if not sf_email_url and previous_email_url:
                                sf_email_url = previous_email_url
                            print(f"  [Tab {tab_num}] READY - {contact_name} (click Send manually)")
                            return {
                                'task_idx': task_idx,
                                'task': task,
                                'success': True,
                                'ready': True,
                                'lead_url': lead_url,
                                'sf_email_url': sf_email_url,
                                'used_reply_flow': used_reply_flow,
                            }
                        print(f"  [Tab {tab_num}] PREP FAILED - {contact_name}")
                        return {
                            'task_idx': task_idx,
                            'task': task,
                            'success': False,
                            'error': 'Email composer did not reach ready state',
                            'lead_url': lead_url,
                            'used_reply_flow': used_reply_flow,
                        }

                    # Send the email automatically
                    print(f"  [Tab {tab_num}] Sending email...")
                    send_success = await sender.send_email(page)

                    if send_success:
                        sf_email_url = await sender.get_latest_timeline_email_url(
                            page,
                            expected_subject=task.get('subject') or '',
                        )
                        if not sf_email_url and previous_email_url:
                            sf_email_url = previous_email_url
                        print(f"  [Tab {tab_num}] SENT - {contact_name}")
                        return {
                            'task_idx': task_idx,
                            'task': task,
                            'success': True,
                            'sent': True,
                            'lead_url': lead_url,
                            'sf_email_url': sf_email_url,
                            'used_reply_flow': used_reply_flow,
                        }
                    else:
                        print(f"  [Tab {tab_num}] SEND FAILED - {contact_name}")
                        return {
                            'task_idx': task_idx,
                            'task': task,
                            'success': False,
                            'error': 'Failed to click Send button',
                            'lead_url': lead_url,
                            'used_reply_flow': used_reply_flow,
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
                
                if result.get('success') and result.get('sent'):
                    # Email was sent successfully - log immediately
                    summary['ready'] += 1

                    db.log_sent_email(
                        campaign_id=contact['campaign_id'],
                        campaign_contact_id=contact['id'],
                        contact_id=contact['contact_id'],
                        step_number=task['step'],
                        subject=task['subject'],
                        body=task['body'],
                        sf_lead_url=result.get('lead_url'),
                        sf_email_url=result.get('sf_email_url'),
                        status='sent'
                    )

                    days = contact.get('days_between_emails', 3)
                    next_email_at = (datetime.now() + timedelta(days=days)).isoformat()
                    new_status = 'completed' if task['step'] >= contact.get('num_emails', 3) else 'active'

                    db.update_campaign_contact(
                        contact['id'],
                        current_step=task['step'],
                        status=new_status,
                        sf_lead_url=result.get('lead_url'),
                        next_email_at=next_email_at if new_status == 'active' else None
                    )

                    print(f"  [DB] Logged sent email for {contact.get('contact_name')}")
                elif result.get('success') and result.get('ready'):
                    summary['ready'] += 1
                    if contact.get('id') and result.get('lead_url'):
                        db.update_campaign_contact(
                            contact['id'],
                            sf_lead_url=result.get('lead_url'),
                        )
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
        if review_mode:
            print(f"  Ready for manual review: {summary['ready']}")
        else:
            print(f"  Sent: {summary['ready']} emails")
        print(f"  Failed: {summary['failed']}")
        print(f"{'='*60}")

        if review_mode:
            print("\n[SFEmailSender] Manual-review session ready.")
            print("[SFEmailSender] Each tab has a composer open. Click Send manually.")
            input("\nPress ENTER to close browser after review...")
        else:
            print("\n[SFEmailSender] All emails have been sent and logged!")
            input("\nPress ENTER to close browser...")
        
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
    review_mode: bool = False,
    template_name: str = "Footer",
    batch_size: int = 20
) -> Dict:
    """
    Process approved+scheduled emails through Salesforce.
    This is the new flow: only picks up emails with review_status='approved'
    and scheduled_send_time <= now.
    """
    sender = SalesforceSender()
    if review_mode and headless:
        print("[SFScheduledSender] Review mode requires visible browser")
        headless = False
    
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
                step_number = int(email.get('step_number') or 1)
                
                # Use rendered content (AI-personalized)
                subject = email.get('rendered_subject') or email.get('subject', '')
                body = email.get('rendered_body') or email.get('body', '')
                
                tab_num = task_idx + 1
                print(f"\n  [Tab {tab_num}] Starting: {contact_name}")
                
                try:
                    lead_url = (email.get('sf_lead_url') or "").strip() or None
                    previous_email_url = None
                    used_reply_flow = False

                    if step_number > 1 and email.get('campaign_contact_id'):
                        previous_email_url = db.get_latest_sent_email_message_url(
                            campaign_contact_id=int(email.get('campaign_contact_id') or 0),
                            step_lt=step_number,
                        )
                        if not previous_email_url and lead_url:
                            try:
                                await page.goto(lead_url, wait_until="domcontentloaded", timeout=30_000)
                                try:
                                    await page.wait_for_load_state("networkidle", timeout=10_000)
                                except Exception:
                                    pass
                                recovered_urls = await sender.get_timeline_email_urls(page, limit=20)
                                if recovered_urls:
                                    db.backfill_missing_sf_email_urls(
                                        campaign_contact_id=int(email.get('campaign_contact_id') or 0),
                                        email_urls=recovered_urls,
                                    )
                                    previous_email_url = db.get_latest_sent_email_message_url(
                                        campaign_contact_id=int(email.get('campaign_contact_id') or 0),
                                        step_lt=step_number,
                                    )
                            except Exception:
                                pass
                        if previous_email_url:
                            print(f"  [Tab {tab_num}] Opening prior email and clicking Reply...")
                            used_reply_flow = await sender.open_email_message_reply(page, previous_email_url)
                            if not used_reply_flow:
                                return {
                                    'task_idx': task_idx,
                                    'email': email,
                                    'success': False,
                                    'error': 'Reply flow failed using prior EmailMessage URL',
                                    'lead_url': lead_url,
                                }

                    if not used_reply_flow:
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
                    
                    # First action in composer: maximize.
                    await sender.maximize_composer(page)
                    if used_reply_flow:
                        body_focused = await sender.focus_editor_body(page)
                        if not body_focused:
                            return {
                                'task_idx': task_idx,
                                'email': email,
                                'success': False,
                                'error': 'Failed to focus reply body iframe after maximize',
                                'lead_url': lead_url,
                            }

                    preserved_original_html = ""
                    preserved_subject = ""
                    if used_reply_flow:
                        preserved_subject = await sender.capture_current_subject(page)
                        preserved_original_html = await sender.capture_current_body_html(page)
                        cleared = await sender.clear_current_body(page)
                        if not cleared:
                            return {
                                'task_idx': task_idx,
                                'email': email,
                                'success': False,
                                'error': 'Failed to clear existing reply body before template insertion',
                                'lead_url': lead_url,
                            }
                    
                    print(f"  [Tab {tab_num}] Selecting template...")
                    await sender.select_template(page, template_name)
                    
                    print(f"  [Tab {tab_num}] Filling email content...")
                    subject_to_fill = subject if not used_reply_flow else preserved_subject
                    if used_reply_flow:
                        filled_ok = await sender.fill_email_body_with_preserved_original(
                            page,
                            subject_to_fill,
                            body,
                            preserved_original_html,
                        )
                    else:
                        filled_ok = await sender.fill_email_body(page, subject_to_fill, body)
                    if not filled_ok:
                        return {
                            'task_idx': task_idx,
                            'email': email,
                            'success': False,
                            'error': 'Failed to fill email body after opening composer',
                            'lead_url': lead_url,
                        }
                    
                    if review_mode:
                        print(f"  [Tab {tab_num}] Preparing for manual approval...")
                        ready = await sender.send_email(page, skip_click=True)
                        if ready:
                            print(f"  [Tab {tab_num}] READY - {contact_name} (click Send manually)")
                            sf_email_url = await sender.get_latest_timeline_email_url(
                                page,
                                expected_subject=subject,
                            )
                            if not sf_email_url and previous_email_url:
                                sf_email_url = previous_email_url
                            return {
                                'task_idx': task_idx,
                                'email': email,
                                'success': True,
                                'ready': True,
                                'lead_url': lead_url,
                                'sf_email_url': sf_email_url,
                                'used_reply_flow': used_reply_flow,
                            }
                        print(f"  [Tab {tab_num}] PREP FAILED - {contact_name}")
                        return {
                            'task_idx': task_idx,
                            'email': email,
                            'success': False,
                            'error': 'Email composer did not reach ready state',
                            'lead_url': lead_url
                        }
                    # Send the email automatically
                    print(f"  [Tab {tab_num}] Sending email...")
                    send_success = await sender.send_email(page, skip_click=False)
                    if send_success:
                        sf_email_url = await sender.get_latest_timeline_email_url(
                            page,
                            expected_subject=subject,
                        )
                        if not sf_email_url and previous_email_url:
                            sf_email_url = previous_email_url
                        print(f"  [Tab {tab_num}] SENT - {contact_name}")
                        return {
                            'task_idx': task_idx,
                            'email': email,
                            'success': True,
                            'sent': True,
                            'lead_url': lead_url,
                            'sf_email_url': sf_email_url,
                            'used_reply_flow': used_reply_flow,
                        }
                    print(f"  [Tab {tab_num}] SEND FAILED - {contact_name}")
                    return {
                        'task_idx': task_idx,
                        'email': email,
                        'success': False,
                        'error': 'Failed to click Send button',
                        'lead_url': lead_url,
                        'used_reply_flow': used_reply_flow,
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
                
                if result.get('success') and result.get('sent'):
                    # Email was sent successfully - log immediately
                    summary['sent'] += 1
                    
                    db.mark_email_sent(
                        email['id'],
                        sf_lead_url=result.get('lead_url'),
                        sf_email_url=result.get('sf_email_url'),
                    )
                    
                    # Update campaign contact progress
                    days = email.get('days_between_emails', 3)
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
                            sf_lead_url=result.get('lead_url'),
                            next_email_at=next_email_at if new_status == 'active' else None
                        )
                    
                    print(f"  [DB] Logged sent email for {email.get('contact_name')}")
                elif result.get('success') and result.get('ready'):
                    # Manual-review mode: keep record approved/scheduled until user sends in Salesforce.
                    campaign_contact_id = email.get('campaign_contact_id')
                    if campaign_contact_id and result.get('lead_url'):
                        db.update_campaign_contact(
                            campaign_contact_id,
                            sf_lead_url=result.get('lead_url')
                        )
                    summary['sent'] += 1
                else:
                    summary['failed'] += 1
                    db.mark_email_failed(email['id'], error_message=result.get('error'))
            
            if batch_num < num_batches - 1:
                print(f"\n  Pausing before next batch...")
                await asyncio.sleep(2)
        
        # Final summary
        print(f"\n{'='*60}")
        print(f"ALL BATCHES COMPLETE")
        if review_mode:
            print(f"  Ready for manual review: {summary['sent']}")
        else:
            print(f"  Sent: {summary['sent']} emails")
        print(f"  Failed: {summary['failed']}")
        print(f"{'='*60}")

        if review_mode:
            print("\n[SFScheduledSender] Manual-review session ready.")
            print("[SFScheduledSender] Each tab has an email composer open. Click Send or close tab to deny/skip.")
            input("\nPress ENTER to close browser after review...")
        else:
            print("\n[SFScheduledSender] All emails have been sent and logged!")
            input("\nPress ENTER to close browser...")

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
