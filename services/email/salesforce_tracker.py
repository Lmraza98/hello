"""
Salesforce Tracking Service — Polls Salesforce for open/reply status.

Runs periodically (6x daily during business hours) to check
activity history for sent emails and update tracking data.
"""
import asyncio
import traceback
from datetime import datetime
from typing import Dict

import config
import database as db


async def poll_salesforce_tracking() -> Dict:
    """
    Main tracking entry point. Called by scheduler or manually.
    
    1. Get emails needing tracking (sent in last N days)
    2. For each email's SF lead URL:
       a. Navigate to the Salesforce activity history
       b. Check if the email was opened (and count)
       c. Check if there was a reply
       d. Update tracking data via update_email_tracking()
    3. Log results
    """
    lookback_days = int(db.get_config('tracking_lookback_days', '14'))
    emails = db.get_emails_needing_tracking(lookback_days=lookback_days)
    
    if not emails:
        print("[SFTracker] No emails needing tracking")
        return {
            'success': True,
            'checked': 0,
            'updated': 0,
            'message': 'No emails to track.'
        }
    
    print(f"[SFTracker] Checking {len(emails)} emails for opens/replies...")
    
    checked = 0
    updated = 0
    errors = []
    
    # For now, this is a placeholder that marks emails as tracked.
    # Full implementation will use Playwright to navigate SF activity history.
    # The infrastructure is ready — just needs the SF web automation specifics.
    
    try:
        from services.email.salesforce_automation import SalesforceSender
        
        sender = SalesforceSender()
        if not await sender.start(headless=True):
            return {
                'success': False,
                'error': 'Could not authenticate to Salesforce',
                'checked': 0,
                'updated': 0
            }
        
        for email in emails:
            try:
                sf_lead_url = email.get('sf_lead_url')
                if not sf_lead_url:
                    # No SF URL — just mark as tracked so we don't keep retrying
                    db.update_email_tracking(email['id'])
                    checked += 1
                    continue
                
                # Navigate to the lead's activity history in Salesforce
                page = sender.pages[0] if sender.pages else None
                if not page:
                    break
                
                # Go to the lead page
                await page.goto(sf_lead_url, wait_until='domcontentloaded', timeout=30000)
                await asyncio.sleep(2)
                
                # Look for activity timeline / email activity
                # This checks for email open indicators in Salesforce Lightning
                opened = False
                open_count = 0
                replied = False
                
                try:
                    # Check for "Email" activities in the activity timeline
                    # Look for opened/engagement indicators
                    activity_items = await page.query_selector_all('[data-aura-class="forceActivityTimeline"] .slds-timeline__item_email')
                    
                    for item in activity_items:
                        item_text = await item.inner_text()
                        item_text_lower = item_text.lower()
                        
                        # Check subject match
                        email_subject = email.get('rendered_subject') or email.get('subject', '')
                        if email_subject.lower() in item_text_lower:
                            # Check for open indicators
                            if 'opened' in item_text_lower or 'viewed' in item_text_lower:
                                opened = True
                                open_count += 1
                            
                            # Check for reply indicators
                            if 'replied' in item_text_lower or 'response' in item_text_lower:
                                replied = True
                
                except Exception as e:
                    # Activity timeline parsing failed — that's OK, we'll try again next poll
                    print(f"[SFTracker] Could not parse activity for {email.get('contact_name', 'Unknown')}: {e}")
                
                # Update tracking data
                db.update_email_tracking(
                    email['id'],
                    opened=opened if opened else None,
                    open_count=open_count if open_count > 0 else None,
                    replied=replied if replied else None
                )
                
                checked += 1
                if opened or replied:
                    updated += 1
                    print(f"[SFTracker] {email.get('contact_name')}: opened={opened}, replies={replied}")
                
            except Exception as e:
                error_msg = f"{email.get('contact_name', 'Unknown')}: {str(e)}"
                errors.append(error_msg)
                print(f"[SFTracker] Error: {error_msg}")
                # Still mark as tracked to avoid hammering the same email
                try:
                    db.update_email_tracking(email['id'])
                except:
                    pass
                checked += 1
        
        await sender.stop()
        
    except ImportError:
        # SalesforceSender not available — just mark all as tracked
        print("[SFTracker] SalesforceSender not available, marking emails as tracked")
        for email in emails:
            db.update_email_tracking(email['id'])
            checked += 1
    except Exception as e:
        print(f"[SFTracker] Fatal error: {e}")
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
            'checked': checked,
            'updated': updated
        }
    
    result = {
        'success': True,
        'checked': checked,
        'updated': updated,
        'message': f'Tracked {checked} emails. {updated} had new activity.'
    }
    
    if errors:
        result['errors'] = errors
    
    return result
