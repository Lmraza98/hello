"""
Outlook Reply Monitor — Polls Microsoft Graph API for incoming replies.

Matches replies to sent campaign emails via:
  1. Outlook conversationId (most reliable, requires outlook IDs stored on send)
  2. In-Reply-To / internetMessageId headers
  3. Subject line + sender email fallback

When a reply is detected:
  - Logs the reply content to email_replies table
  - Marks sent_email as replied
  - Pauses the campaign_contact (status = 'replied')
"""
import asyncio
import traceback
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import aiohttp

import config
import database as db
from services.graph_auth import get_access_token


GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def _graph_get(session: aiohttp.ClientSession, url: str, token: str) -> Optional[Dict]:
    """Make a GET request to the Graph API."""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with session.get(url, headers=headers) as resp:
            if resp.status == 200:
                return await resp.json()
            else:
                body = await resp.text()
                print(f"[OutlookMonitor] Graph API {resp.status}: {body[:200]}")
                return None
    except Exception as e:
        print(f"[OutlookMonitor] Request error: {e}")
        return None


async def _get_user_email(session: aiohttp.ClientSession, token: str) -> Optional[str]:
    """Get the authenticated user's email address."""
    data = await _graph_get(session, f"{GRAPH_BASE}/me", token)
    if data:
        return data.get("mail") or data.get("userPrincipalName")
    return None


async def _fetch_recent_inbox_messages(
    session: aiohttp.ClientSession,
    token: str,
    minutes_back: int = 15,
    top: int = 50,
) -> List[Dict]:
    """Fetch recent inbox messages from the last N minutes."""
    cutoff = (datetime.utcnow() - timedelta(minutes=minutes_back)).strftime("%Y-%m-%dT%H:%M:%SZ")
    
    # Filter for messages received after cutoff, only in Inbox
    # Select fields we need for matching
    params = (
        f"$filter=receivedDateTime ge {cutoff}"
        f"&$top={top}"
        f"&$orderby=receivedDateTime desc"
        f"&$select=id,conversationId,internetMessageId,subject,bodyPreview,"
        f"from,receivedDateTime,internetMessageHeaders"
    )
    url = f"{GRAPH_BASE}/me/mailFolders/inbox/messages?{params}"
    
    data = await _graph_get(session, url, token)
    if not data:
        return []
    return data.get("value", [])


def _extract_in_reply_to(message: Dict) -> Optional[str]:
    """Extract In-Reply-To header from message headers."""
    headers = message.get("internetMessageHeaders", [])
    if not headers:
        return None
    for h in headers:
        if h.get("name", "").lower() == "in-reply-to":
            return h.get("value")
    return None


def _normalize_subject(subject: str) -> str:
    """Strip Re:/Fwd: prefixes for matching."""
    if not subject:
        return ""
    s = subject.strip()
    for prefix in ("Re:", "RE:", "re:", "Fwd:", "FWD:", "fwd:", "Fw:", "FW:", "fw:"):
        while s.startswith(prefix):
            s = s[len(prefix):].strip()
    return s.lower()


def _match_message_to_sent_email(
    message: Dict,
    sent_emails: List[Dict],
    emails_by_conversation: Dict[str, List[Dict]],
    emails_by_internet_msg_id: Dict[str, List[Dict]],
) -> Optional[Dict]:
    """
    Try to match an incoming message to one of our sent emails.
    Returns the matching sent_email dict or None.
    """
    # Strategy 1: Match by conversationId
    conversation_id = message.get("conversationId")
    print(f"      Strategy 1 (conversationId): {conversation_id}")
    if conversation_id and conversation_id in emails_by_conversation:
        matches = emails_by_conversation[conversation_id]
        if matches:
            print(f"      ✓ Matched via conversationId!")
            return matches[0]  # Return the most recent sent email in that conversation

    # Strategy 2: Match by In-Reply-To header → our internetMessageId
    in_reply_to = _extract_in_reply_to(message)
    print(f"      Strategy 2 (In-Reply-To): {in_reply_to}")
    if in_reply_to and in_reply_to in emails_by_internet_msg_id:
        matches = emails_by_internet_msg_id[in_reply_to]
        if matches:
            print(f"      ✓ Matched via In-Reply-To header!")
            return matches[0]

    # Strategy 3: Subject + sender email fallback
    msg_subject = _normalize_subject(message.get("subject", ""))
    from_email = (
        message.get("from", {}).get("emailAddress", {}).get("address", "").lower()
    )
    
    print(f"      Strategy 3 (Subject + Email):")
    print(f"        Incoming normalized subject: '{msg_subject}'")
    print(f"        Incoming from email: '{from_email}'")

    if not msg_subject or not from_email:
        print(f"        ✗ Missing subject or email")
        return None

    # Try to find a match
    for se in sent_emails:
        se_subject = _normalize_subject(
            se.get("rendered_subject") or se.get("subject", "")
        )
        se_contact_email = (se.get("contact_email") or "").lower()

        if se_subject and se_contact_email:
            # Show comparison for emails from matching sender
            if from_email == se_contact_email:
                print(f"        Checking sent email to {se_contact_email}:")
                print(f"          Sent subject: '{se_subject}'")
                print(f"          Match: {msg_subject == se_subject}")
                
            if msg_subject == se_subject and from_email == se_contact_email:
                print(f"        ✓ Matched via subject + email!")
                return se

    print(f"        ✗ No match found via subject + email")
    return None


async def poll_outlook_replies(minutes_back: int = 15) -> Dict:
    """
    Main entry point — called by scheduler or manually.

    1. Authenticate to Graph API (silent token refresh).
    2. Fetch recent inbox messages.
    3. Match against sent campaign emails.
    4. Log replies and pause campaigns.
    """
    print(f"\n{'='*70}")
    print(f"[OutlookMonitor] Starting reply poll (looking back {minutes_back} minutes)")
    print(f"{'='*70}")
    
    token = get_access_token(interactive=False)
    if not token:
        print("[OutlookMonitor] ERROR: Not authenticated to Microsoft Graph")
        return {
            "success": False,
            "error": "Not authenticated to Microsoft Graph. Run manual auth first.",
            "checked": 0,
            "new_replies": 0,
        }
    
    print("[OutlookMonitor] ✓ Authenticated to Microsoft Graph")

    # Get sent emails for matching
    lookback_days = int(db.get_config("tracking_lookback_days", "14"))
    print(f"[OutlookMonitor] Fetching sent emails (lookback: {lookback_days} days)...")
    sent_emails = db.get_sent_emails_for_reply_matching(lookback_days=lookback_days)

    if not sent_emails:
        print("[OutlookMonitor] No unreplied sent emails found in database")
        return {
            "success": True,
            "checked": 0,
            "new_replies": 0,
            "message": "No unreplied sent emails to monitor.",
        }
    
    print(f"[OutlookMonitor] Found {len(sent_emails)} unreplied sent emails:")
    for se in sent_emails[:5]:  # Show first 5
        contact = se.get('contact_name', 'Unknown')
        email = se.get('contact_email', '')
        subject = se.get('rendered_subject') or se.get('subject', '')
        has_outlook = bool(se.get('outlook_conversation_id') or se.get('outlook_internet_message_id'))
        print(f"  - {contact} ({email})")
        print(f"    Subject: {subject[:60]}")
        print(f"    Has Outlook IDs: {has_outlook}")
    if len(sent_emails) > 5:
        print(f"  ... and {len(sent_emails) - 5} more")

    # Build lookup indexes
    print(f"\n[OutlookMonitor] Building lookup indexes...")
    emails_by_conversation: Dict[str, List[Dict]] = {}
    emails_by_internet_msg_id: Dict[str, List[Dict]] = {}
    for se in sent_emails:
        conv_id = se.get("outlook_conversation_id")
        if conv_id:
            emails_by_conversation.setdefault(conv_id, []).append(se)
        inet_id = se.get("outlook_internet_message_id")
        if inet_id:
            emails_by_internet_msg_id.setdefault(inet_id, []).append(se)
    
    print(f"  - Emails with conversation IDs: {len(emails_by_conversation)}")
    print(f"  - Emails with internet message IDs: {len(emails_by_internet_msg_id)}")
    print(f"  - Emails without Outlook IDs (fallback matching): {len(sent_emails) - len(emails_by_conversation)}")

    # Fetch recent inbox messages
    print(f"\n[OutlookMonitor] Fetching inbox messages from last {minutes_back} minutes...")
    async with aiohttp.ClientSession() as session:
        # Get authenticated user's email to filter out their own sent messages
        user_email = await _get_user_email(session, token)
        if user_email:
            print(f"[OutlookMonitor] Authenticated user: {user_email}")
        
        messages = await _fetch_recent_inbox_messages(
            session, token, minutes_back=minutes_back
        )

    if not messages:
        print("[OutlookMonitor] No new inbox messages found")
        return {
            "success": True,
            "checked": 0,
            "new_replies": 0,
            "message": f"No new inbox messages in the last {minutes_back} minutes.",
        }
    
    # Filter out messages sent BY the user (testing scenario)
    original_count = len(messages)
    if user_email:
        messages = [
            msg for msg in messages
            if msg.get("from", {}).get("emailAddress", {}).get("address", "").lower() != user_email.lower()
        ]
        filtered_out = original_count - len(messages)
        if filtered_out > 0:
            print(f"[OutlookMonitor] Filtered out {filtered_out} message(s) sent by you ({user_email})")
    
    if not messages:
        print("[OutlookMonitor] No inbox messages after filtering")
        return {
            "success": True,
            "checked": 0,
            "new_replies": 0,
            "message": f"No relevant inbox messages in the last {minutes_back} minutes.",
        }
    
    print(f"[OutlookMonitor] Found {len(messages)} inbox messages (after filtering):")
    for msg in messages[:5]:  # Show first 5
        from_addr = msg.get("from", {}).get("emailAddress", {}).get("address", "")
        subject = msg.get("subject", "")
        received = msg.get("receivedDateTime", "")
        print(f"  - From: {from_addr}")
        print(f"    Subject: {subject[:60]}")
        print(f"    Received: {received}")
    if len(messages) > 5:
        print(f"  ... and {len(messages) - 5} more")

    # Match and log replies
    print(f"\n[OutlookMonitor] Attempting to match {len(messages)} messages to sent emails...")
    new_replies = 0
    checked = len(messages)
    matched_count = 0

    for i, msg in enumerate(messages):
        from_addr = msg.get("from", {}).get("emailAddress", {}).get("address", "")
        subject = msg.get("subject", "")
        
        print(f"\n  Message {i+1}/{len(messages)}:")
        print(f"    From: {from_addr}")
        print(f"    Subject: {subject[:60]}")
        
        matched_email = _match_message_to_sent_email(
            msg, sent_emails, emails_by_conversation, emails_by_internet_msg_id
        )
        if not matched_email:
            print(f"    ✗ No match found")
            continue
        
        matched_count += 1
        contact = matched_email.get('contact_name', 'Unknown')
        print(f"    ✓ MATCHED to sent email: {contact}")

        # Check if we already logged this reply (by outlook message ID)
        msg_id = msg.get("id")
        existing = db.get_email_replies(contact_id=matched_email["contact_id"], limit=100)
        already_logged = any(r.get("outlook_message_id") == msg_id for r in existing)
        if already_logged:
            print(f"    - Already logged this reply, skipping")
            continue

        # Extract reply details
        from_addr = msg.get("from", {}).get("emailAddress", {}).get("address", "")
        received_at = msg.get("receivedDateTime", datetime.utcnow().isoformat())
        body_preview = (msg.get("bodyPreview") or "")[:500]

        try:
            reply_id = db.log_email_reply(
                sent_email_id=matched_email["id"],
                campaign_contact_id=matched_email["campaign_contact_id"],
                contact_id=matched_email["contact_id"],
                outlook_message_id=msg_id,
                from_address=from_addr,
                subject=msg.get("subject", ""),
                body_preview=body_preview,
                received_at=received_at,
            )
            new_replies += 1
            contact_name = matched_email.get("contact_name", "Unknown")
            company = matched_email.get("company_name", "")
            print(f"[OutlookMonitor] Reply detected: {contact_name} ({company}) — campaign paused")
        except Exception as e:
            print(f"[OutlookMonitor] Error logging reply: {e}")
            traceback.print_exc()

    result = {
        "success": True,
        "checked": checked,
        "matched": matched_count,
        "new_replies": new_replies,
        "message": f"Checked {checked} messages. {matched_count} matched. {new_replies} new replies detected.",
    }

    print(f"\n{'='*70}")
    print(f"[OutlookMonitor] SUMMARY:")
    print(f"  - Inbox messages checked: {checked}")
    print(f"  - Messages matched to sent emails: {matched_count}")
    print(f"  - New replies logged: {new_replies}")
    print(f"{'='*70}\n")

    return result
