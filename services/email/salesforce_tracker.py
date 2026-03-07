"""
Salesforce Tracking Service — Polls Salesforce for open/reply status.

Runs periodically (6x daily during business hours) to check
activity history for sent emails and update tracking data.
"""
import asyncio
import traceback
from datetime import datetime, timedelta
from typing import Dict

import config
import database as db


def _looks_like_non_email_task(text: str, subject: str) -> bool:
    lowered = (text or "").strip().lower()
    subj = (subject or "").strip().lower()
    task_markers = (
        "details for task",
        "follow up",
        "upcoming task",
        "task due",
        "call due",
        "log a call",
    )
    return any(marker in lowered or marker in subj for marker in task_markers)


async def _extract_timeline_email_summary(page) -> Dict:
    """
    Parse current Salesforce record timeline and detect sent-email activity.
    Returns coarse summary suitable for campaign seeding.
    """
    sent_count = 0
    latest_subject = None
    latest_when = None

    # Prefer concrete email-row selectors seen on Lightning timeline.
    items = page.locator(
        "li.row.Email, li.slds-timeline__item_email, .slds-timeline__item_email"
    )
    count = await items.count()
    for idx in range(min(count, 25)):
        item = items.nth(idx)
        try:
            text = (await item.inner_text(timeout=1000) or "").strip()
        except Exception:
            text = ""
        if not text:
            continue
        lowered = text.lower()
        if "you sent an email to" not in lowered and "last opened" not in lowered:
            continue
        try:
            subject_text = await item.locator(".subjectLink, .subjectText").first.inner_text(timeout=1000)
        except Exception:
            subject_text = ""
        candidate_subject = (subject_text or "").strip()
        if _looks_like_non_email_task(text, candidate_subject):
            continue

        sent_count += 1
        if latest_subject is None:
            latest_subject = candidate_subject or None
        if latest_when is None:
            try:
                when_text = await item.locator(".dueDate").first.inner_text(timeout=1000)
            except Exception:
                when_text = ""
            latest_when = (when_text or "").strip() or None

    return {
        "sent_count": int(sent_count),
        "latest_subject": latest_subject,
        "latest_when": latest_when,
    }


async def sync_campaign_salesforce_history(campaign_id: int, limit: int = 500) -> Dict:
    """
    Backfill campaign state from existing Salesforce timeline history.
    Seeds sent status for enrolled contacts that already show sent email activity.
    """
    campaign = db.get_email_campaign(campaign_id)
    if not campaign:
        return {
            "success": False,
            "campaign_id": int(campaign_id),
            "checked": 0,
            "seeded": 0,
            "detected_salesforce_activity": 0,
            "skipped_existing_sent": 0,
            "skipped_no_salesforce_url": 0,
            "error": "Campaign not found",
        }

    bounded_limit = max(1, min(int(limit or 500), 2000))
    contacts = db.get_campaign_contacts(campaign_id, status="active")[:bounded_limit]

    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT contact_id
            FROM sent_emails
            WHERE campaign_id = ?
              AND lower(COALESCE(review_status, '')) = 'sent'
            """,
            (campaign_id,),
        )
        existing_sent_contact_ids = {int(r["contact_id"]) for r in cur.fetchall()}

    skipped_existing_sent = 0
    skipped_no_salesforce_url = 0
    candidates = []
    for row in contacts:
        contact_id = int(row["contact_id"])
        if contact_id in existing_sent_contact_ids:
            skipped_existing_sent += 1
            continue
        if not (row.get("salesforce_url") or "").strip():
            skipped_no_salesforce_url += 1
            continue
        candidates.append(row)

    checked = 0
    detected_salesforce_activity = 0
    seeded = 0

    if not candidates:
        return {
            "success": True,
            "campaign_id": int(campaign_id),
            "checked": 0,
            "seeded": 0,
            "detected_salesforce_activity": 0,
            "skipped_existing_sent": int(skipped_existing_sent),
            "skipped_no_salesforce_url": int(skipped_no_salesforce_url),
            "message": "No eligible campaign contacts required Salesforce history sync.",
        }

    try:
        from services.web_automation.salesforce.auth_manager import (
            _is_bot_alive,
            get_shared_bot,
            trigger_reauth,
        )

        bot = await get_shared_bot()
        if bot is None or not _is_bot_alive(bot):
            return {
                "success": False,
                "campaign_id": int(campaign_id),
                "checked": 0,
                "seeded": 0,
                "detected_salesforce_activity": 0,
                "skipped_existing_sent": int(skipped_existing_sent),
                "skipped_no_salesforce_url": int(skipped_no_salesforce_url),
                "error": "Salesforce browser bot unavailable",
            }
        if not bot.is_authenticated:
            ok = await trigger_reauth()
            if not ok:
                return {
                    "success": False,
                    "campaign_id": int(campaign_id),
                    "checked": 0,
                    "seeded": 0,
                    "detected_salesforce_activity": 0,
                    "skipped_existing_sent": int(skipped_existing_sent),
                    "skipped_no_salesforce_url": int(skipped_no_salesforce_url),
                    "error": "Salesforce authentication required",
                }
            bot = await get_shared_bot()
            if bot is None or not _is_bot_alive(bot) or not bot.is_authenticated:
                return {
                    "success": False,
                    "campaign_id": int(campaign_id),
                    "checked": 0,
                    "seeded": 0,
                    "detected_salesforce_activity": 0,
                    "skipped_existing_sent": int(skipped_existing_sent),
                    "skipped_no_salesforce_url": int(skipped_no_salesforce_url),
                    "error": "Salesforce authentication failed",
                }

        page = bot.page
        for row in candidates:
            checked += 1
            sf_url = (row.get("salesforce_url") or "").strip()
            if not sf_url:
                continue
            try:
                await page.goto(sf_url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=10_000)
                except Exception:
                    pass
                await asyncio.sleep(1.2)
                summary = await _extract_timeline_email_summary(page)
            except Exception as exc:
                print(f"[SFTracker] History sync navigation failed contact_id={row.get('contact_id')}: {exc}")
                continue

            sent_count = int(summary.get("sent_count") or 0)
            if sent_count <= 0:
                continue

            detected_salesforce_activity += 1
            step_seed = max(1, int(row.get("current_step") or 0))
            max_steps = int(row.get("num_emails") or campaign.get("num_emails") or 1)
            step_seed = min(step_seed, max_steps)

            subject = (summary.get("latest_subject") or "").strip() or "Imported Salesforce email activity"
            when_text = (summary.get("latest_when") or "").strip()
            body = (
                "Imported from Salesforce activity timeline.\n"
                f"Detected sent-email events: {sent_count}\n"
                f"Latest timeline label: {when_text or 'unknown'}"
            )

            db.log_sent_email(
                campaign_id=campaign_id,
                campaign_contact_id=int(row["id"]),
                contact_id=int(row["contact_id"]),
                step_number=step_seed,
                subject=subject,
                body=body,
                sf_lead_url=sf_url,
                status="sent",
            )

            days = int(row.get("days_between_emails") or campaign.get("days_between_emails") or 3)
            next_dt = datetime.utcnow() + timedelta(days=days)
            is_complete = step_seed >= max_steps
            db.update_campaign_contact(
                int(row["id"]),
                current_step=step_seed,
                status="completed" if is_complete else "active",
                sf_lead_url=sf_url,
                next_email_at=None if is_complete else next_dt.isoformat(),
            )
            seeded += 1

    except Exception as exc:
        print(f"[SFTracker] History sync fatal error: {exc}")
        traceback.print_exc()
        return {
            "success": False,
            "campaign_id": int(campaign_id),
            "checked": int(checked),
            "seeded": int(seeded),
            "detected_salesforce_activity": int(detected_salesforce_activity),
            "skipped_existing_sent": int(skipped_existing_sent),
            "skipped_no_salesforce_url": int(skipped_no_salesforce_url),
            "error": str(exc),
        }

    return {
        "success": True,
        "campaign_id": int(campaign_id),
        "checked": int(checked),
        "seeded": int(seeded),
        "detected_salesforce_activity": int(detected_salesforce_activity),
        "skipped_existing_sent": int(skipped_existing_sent),
        "skipped_no_salesforce_url": int(skipped_no_salesforce_url),
        "message": (
            f"Checked {checked} contacts, detected existing Salesforce email activity on "
            f"{detected_salesforce_activity}, seeded {seeded} campaign contacts."
        ),
    }


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
