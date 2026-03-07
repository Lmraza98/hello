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
import re
from html import unescape
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import aiohttp

import config
import database as db
from services.email.graph_auth import get_access_token
from services.web_automation.salesforce.lookup_queue import enqueue_salesforce_create


GRAPH_BASE = "https://graph.microsoft.com/v1.0"
INBOUND_LEAD_SENDER = "clientservices@theshowproducers.com"
INBOUND_AUTO_ENROLL_CAMPAIGN = "Small Business Expo"
# "queued" is intentionally excluded here: inbound upsert marks DB state as queued
# before enqueue, so skipping queued would prevent actual queue insertion.
SYNC_TERMINAL_OR_ACTIVE = {"creating", "success"}
_DETAILS_URL_RE = re.compile(r"https?://[^\s\"'<>]+preview-lead=\d+[^\s\"'<>]*", re.IGNORECASE)


def _persist_poll_status(
    *,
    success: bool,
    checked: int = 0,
    new_replies: int = 0,
    new_leads: int = 0,
    message: str | None = None,
    error: str | None = None,
) -> None:
    now_iso = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    db.set_config("outlook_last_poll_at", now_iso)
    db.set_config("outlook_last_poll_success", "1" if success else "0")
    db.set_config("outlook_last_poll_checked", str(int(checked or 0)))
    db.set_config("outlook_last_poll_new_replies", str(int(new_replies or 0)))
    db.set_config("outlook_last_poll_new_leads", str(int(new_leads or 0)))
    db.set_config("outlook_last_poll_message", (message or "").strip())
    db.set_config("outlook_last_poll_error", (error or "").strip())


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
        f"from,receivedDateTime,internetMessageHeaders,body"
    )
    url = f"{GRAPH_BASE}/me/mailFolders/inbox/messages?{params}"
    
    data = await _graph_get(session, url, token)
    if not data:
        return []
    return data.get("value", [])


def _strip_html_to_text(value: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\\1>", " ", value or "")
    text = re.sub(r"(?is)<br\\s*/?>", "\n", text)
    text = re.sub(r"(?is)</p\\s*>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = text.replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _extract_text_body(message: Dict) -> str:
    body = message.get("body") or {}
    body_content = body.get("content") if isinstance(body, dict) else None
    if isinstance(body_content, str) and body_content.strip():
        return _strip_html_to_text(body_content)
    preview = message.get("bodyPreview") or ""
    return str(preview).strip()


def _find_campaign_id_by_name(name: str) -> Optional[int]:
    target = (name or "").strip().lower()
    if not target:
        return None
    campaigns = db.get_email_campaigns()
    for campaign in campaigns:
        campaign_name = (campaign.get("name") or "").strip().lower()
        if campaign_name == target:
            return int(campaign.get("id"))
    for campaign in campaigns:
        campaign_name = (campaign.get("name") or "").strip().lower()
        if target in campaign_name:
            return int(campaign.get("id"))
    return None


def _auto_enroll_inbound_contact(contact_id: int) -> None:
    campaign_id = _find_campaign_id_by_name(INBOUND_AUTO_ENROLL_CAMPAIGN)
    if not campaign_id:
        print(f"[OutlookMonitor] Auto-enroll skipped: campaign '{INBOUND_AUTO_ENROLL_CAMPAIGN}' not found")
        return
    result = db.enroll_contacts_in_campaign(campaign_id, [int(contact_id)])
    enrolled = int(result.get("enrolled", 0) or 0)
    skipped = int(result.get("skipped", 0) or 0)
    if enrolled > 0:
        print(f"[OutlookMonitor] Auto-enrolled contact_id={contact_id} in campaign_id={campaign_id}")
    elif skipped > 0:
        print(f"[OutlookMonitor] contact_id={contact_id} already enrolled in campaign_id={campaign_id}")


def _extract_html_body(message: Dict) -> str:
    body = message.get("body") or {}
    body_content = body.get("content") if isinstance(body, dict) else None
    return str(body_content or "")


def _extract_preview_lead_url(message: Dict) -> Optional[str]:
    html = _extract_html_body(message)
    if not html:
        return None
    html = unescape(html)
    match = _DETAILS_URL_RE.search(html)
    if not match:
        return None
    url = (match.group(0) or "").strip()
    # Remove trailing punctuation often present in plain-text/HTML fragments.
    return url.rstrip(").,;\"'")


def _extract_input_value(html: str, name: str) -> Optional[str]:
    tag_match = re.search(
        rf"(?is)<input\b[^>]*\bname=['\"]{re.escape(name)}['\"][^>]*>",
        html,
    )
    if not tag_match:
        return None
    tag = tag_match.group(0)
    value_match = re.search(r"(?is)\bvalue=['\"](.*?)['\"]", tag)
    if not value_match:
        return None
    value = unescape((value_match.group(1) or "").strip())
    return value or None


def _extract_textarea_value(html: str, name: str) -> Optional[str]:
    match = re.search(
        rf"(?is)<textarea\b[^>]*\bname=['\"]{re.escape(name)}['\"][^>]*>(.*?)</textarea>",
        html,
    )
    if not match:
        return None
    value = unescape((match.group(1) or "").strip())
    return value or None


def _extract_select_value(html: str, name: str) -> Optional[str]:
    select_match = re.search(
        rf"(?is)<select\b[^>]*\bname=['\"]{re.escape(name)}['\"][^>]*>(.*?)</select>",
        html,
    )
    if not select_match:
        return None
    options = select_match.group(1) or ""
    selected = re.search(r"(?is)<option\b[^>]*selected[^>]*>(.*?)</option>", options)
    if selected:
        value_attr = re.search(r"(?is)\bvalue=['\"](.*?)['\"]", selected.group(0))
        if value_attr:
            value = unescape((value_attr.group(1) or "").strip())
            if value:
                return value
        value = unescape((selected.group(1) or "").strip())
        return value or None
    return None


def _parse_preview_lead_form(html: str) -> Dict[str, Optional[str]]:
    industry = _extract_select_value(html, "industry") or _extract_input_value(html, "industry")
    job_title = _extract_select_value(html, "job_title") or _extract_input_value(html, "job_title")
    city = _extract_input_value(html, "city")
    state = _extract_input_value(html, "state")
    postcode = _extract_input_value(html, "postcode")
    location_parts = [p for p in [city, state, postcode] if p]
    location = ", ".join(location_parts[:2]) if location_parts else None
    if postcode:
        location = (location + f" {postcode}").strip() if location else postcode

    return {
        "first_name": _extract_input_value(html, "first_name"),
        "last_name": _extract_input_value(html, "last_name"),
        "company": _extract_input_value(html, "company"),
        "title": job_title or _extract_input_value(html, "job_title"),
        "industry": industry,
        "email": _extract_input_value(html, "email"),
        "phone": _extract_input_value(html, "phone"),
        "address_1": _extract_input_value(html, "address_1"),
        "address_2": _extract_input_value(html, "address_2"),
        "city": city,
        "state": state,
        "postcode": postcode,
        "location": location,
        "notes": _extract_textarea_value(html, "notes"),
        "services_requested": _extract_input_value(html, "services_requested"),
        "received_at": _extract_input_value(html, "received_at"),
    }


async def _fetch_preview_lead_details(
    session: aiohttp.ClientSession,
    details_url: str,
) -> Dict[str, Optional[str]]:
    try:
        async with session.get(details_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                print(f"[OutlookMonitor] Lead details fetch failed ({resp.status}): {details_url[:180]}")
                return {}
            html = await resp.text()
    except Exception as exc:
        print(f"[OutlookMonitor] Lead details fetch error: {exc}")
        return {}
    if not html:
        return {}
    return _parse_preview_lead_form(html)


def _extract_lead_field(text: str, label: str) -> Optional[str]:
    pattern = rf"(?im)^\s*{re.escape(label)}\s*:\s*(.+?)\s*$"
    match = re.search(pattern, text)
    if match:
        value = (match.group(1) or "").strip()
        return value or None

    # Fallback for single-line notifications where fields are inline.
    all_labels = ("Name", "Company", "Email", "Phone", "Title", "Industry", "Location")
    next_labels = [re.escape(x) for x in all_labels if x.lower() != label.lower()]
    lookahead = "|".join(next_labels)
    inline_pattern = (
        rf"(?is)\b{re.escape(label)}\s*:\s*(.+?)"
        rf"(?=\s+\b(?:{lookahead})\s*:|\s+VIEW\s+MORE\s+DETAILS|$)"
    )
    inline_match = re.search(inline_pattern, text)
    if not inline_match:
        return None
    value = (inline_match.group(1) or "").strip()
    return value or None


def _parse_inbound_lead_notification(message: Dict) -> Optional[Dict]:
    text = _extract_text_body(message)
    if not text:
        return None

    # Gate on expected notification marker to avoid parsing arbitrary inbox mail.
    normalized = text.lower().replace("’", "'")
    if "youve received a new lead" not in normalized and "you've received a new lead" not in normalized:
        return None

    lead_name = _extract_lead_field(text, "Name")
    lead_company = _extract_lead_field(text, "Company")
    lead_email = _extract_lead_field(text, "Email")
    lead_phone = _extract_lead_field(text, "Phone")
    lead_title = _extract_lead_field(text, "Title")
    lead_industry = _extract_lead_field(text, "Industry")
    lead_location = _extract_lead_field(text, "Location")
    if not lead_name and not lead_email:
        return None

    return {
        "name": lead_name,
        "company": lead_company,
        "email": lead_email,
        "phone": lead_phone,
        "title": lead_title,
        "industry": lead_industry,
        "location": lead_location,
        "text_preview": text[:1200],
        "details_url": _extract_preview_lead_url(message),
    }


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
            print(f"      OK Matched via conversationId!")
            return matches[0]  # Return the most recent sent email in that conversation

    # Strategy 2: Match by In-Reply-To header → our internetMessageId
    in_reply_to = _extract_in_reply_to(message)
    print(f"      Strategy 2 (In-Reply-To): {in_reply_to}")
    if in_reply_to and in_reply_to in emails_by_internet_msg_id:
        matches = emails_by_internet_msg_id[in_reply_to]
        if matches:
            print(f"      OK Matched via In-Reply-To header!")
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
        print(f"        X Missing subject or email")
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
                print(f"        OK Matched via subject + email!")
                return se

    print(f"        X No match found via subject + email")
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
    ingest_batch_id = f"outlook-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    
    token = get_access_token(interactive=False)
    if not token:
        print("[OutlookMonitor] ERROR: Not authenticated to Microsoft Graph")
        result = {
            "success": False,
            "error": "Not authenticated to Microsoft Graph. Run manual auth first.",
            "checked": 0,
            "new_replies": 0,
        }
        _persist_poll_status(
            success=False,
            checked=0,
            new_replies=0,
            new_leads=0,
            message=result.get("error"),
            error=result.get("error"),
        )
        return result
    
    print("[OutlookMonitor] OK Authenticated to Microsoft Graph")

    # Get sent emails for matching
    lookback_days = int(db.get_config("tracking_lookback_days", "14"))
    print(f"[OutlookMonitor] Fetching sent emails (lookback: {lookback_days} days)...")
    sent_emails = db.get_sent_emails_for_reply_matching(lookback_days=lookback_days)

    if not sent_emails:
        print("[OutlookMonitor] No unreplied sent emails found in database (reply matching will be skipped).")
    else:
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
        result = {
            "success": True,
            "checked": 0,
            "new_replies": 0,
            "new_leads": 0,
            "message": f"No new inbox messages in the last {minutes_back} minutes.",
        }
        _persist_poll_status(
            success=True,
            checked=0,
            new_replies=0,
            new_leads=0,
            message=result.get("message"),
            error=None,
        )
        return result
    
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
        result = {
            "success": True,
            "checked": 0,
            "new_replies": 0,
            "new_leads": 0,
            "message": f"No relevant inbox messages in the last {minutes_back} minutes.",
        }
        _persist_poll_status(
            success=True,
            checked=0,
            new_replies=0,
            new_leads=0,
            message=result.get("message"),
            error=None,
        )
        return result
    
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
    new_leads = 0
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
            print(f"    X No match found")
            continue
        
        matched_count += 1
        contact = matched_email.get('contact_name', 'Unknown')
        print(f"    OK MATCHED to sent email: {contact}")

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

    # Parse and ingest third-party inbound lead notifications.
    print(f"\n[OutlookMonitor] Scanning inbox for inbound lead notifications from {INBOUND_LEAD_SENDER}...")
    lead_candidates = 0
    lead_parsed = 0
    lead_created_contacts = 0
    lead_updated_contacts = 0
    async with aiohttp.ClientSession() as details_session:
        for msg in messages:
            from_addr = (
                msg.get("from", {})
                .get("emailAddress", {})
                .get("address", "")
                .strip()
                .lower()
            )
            if from_addr != INBOUND_LEAD_SENDER:
                continue
            lead_candidates += 1
            parsed = _parse_inbound_lead_notification(msg)
            msg_id = (msg.get("id") or "").strip() or None
            subject = msg.get("subject", "")
            received_at = msg.get("receivedDateTime", datetime.utcnow().isoformat())
            text_preview = _extract_text_body(msg)[:1200]
            if not parsed:
                db.insert_inbound_lead_event(
                    outlook_message_id=msg_id,
                    source_sender=from_addr,
                    subject=subject,
                    body_preview=text_preview,
                    lead_name=None,
                    lead_company=None,
                    lead_email=None,
                    lead_phone=None,
                    lead_title=None,
                    lead_industry=None,
                    lead_location=None,
                    contact_id=None,
                    received_at=received_at,
                    status="parse_failed",
                    error="lead_notification_format_not_matched",
                )
                continue

            details_url = (parsed.get("details_url") or "").strip()
            if details_url:
                details = await _fetch_preview_lead_details(details_session, details_url)
                if details:
                    merged_name = " ".join(
                        [p for p in [details.get("first_name"), details.get("last_name")] if p]
                    ).strip()
                    parsed["name"] = merged_name or parsed.get("name")
                    parsed["company"] = details.get("company") or parsed.get("company")
                    parsed["email"] = details.get("email") or parsed.get("email")
                    parsed["phone"] = details.get("phone") or parsed.get("phone")
                    parsed["title"] = details.get("title") or parsed.get("title")
                    parsed["industry"] = details.get("industry") or parsed.get("industry")
                    parsed["location"] = details.get("location") or parsed.get("location")
                    # Preserve details URL in preview payload for diagnostics.
                    text_preview = (text_preview + f"\nDetails URL: {details_url}")[:1200]

            lead_parsed += 1
            contact_id = None
            created_new_contact = False
            try:
                contact_id, created_new_contact = db.upsert_inbound_lead_contact(
                    lead_name=parsed.get("name") or "Unknown Lead",
                    lead_company=parsed.get("company"),
                    lead_email=parsed.get("email"),
                    lead_phone=parsed.get("phone"),
                    lead_title=parsed.get("title"),
                    lead_location=parsed.get("location"),
                    lead_source="website_form",
                    ingest_batch_id=ingest_batch_id,
                )
                event_id, inserted_new = db.insert_inbound_lead_event(
                    outlook_message_id=msg_id,
                    source_sender=from_addr,
                    subject=subject,
                    body_preview=text_preview,
                    lead_name=parsed.get("name"),
                    lead_company=parsed.get("company"),
                    lead_email=parsed.get("email"),
                    lead_phone=parsed.get("phone"),
                    lead_title=parsed.get("title"),
                    lead_industry=parsed.get("industry"),
                    lead_location=parsed.get("location"),
                    contact_id=contact_id,
                    received_at=received_at,
                    status="created" if created_new_contact else "updated_existing_contact",
                    error=None,
                )
                if inserted_new:
                    new_leads += 1
                    if created_new_contact:
                        lead_created_contacts += 1
                    else:
                        lead_updated_contacts += 1

                    if contact_id:
                        try:
                            _auto_enroll_inbound_contact(contact_id)
                        except Exception as enroll_exc:
                            print(f"[OutlookMonitor] Auto-enroll failed for contact_id={contact_id}: {enroll_exc}")

                    if config.LEADFORGE_SALESFORCE_ENABLED and contact_id:
                        try:
                            with db.get_db() as conn:
                                cursor = conn.cursor()
                                cursor.execute(
                                    "SELECT salesforce_sync_status, name FROM linkedin_contacts WHERE id = ?",
                                    (contact_id,),
                                )
                                row = cursor.fetchone()
                                sync_status = ((row["salesforce_sync_status"] if row else "") or "").strip().lower()
                                contact_name = ((row["name"] if row else "") or parsed.get("name") or "Unknown Lead").strip()
                            if sync_status not in SYNC_TERMINAL_OR_ACTIVE:
                                enqueue_salesforce_create(contact_id, contact_name or "Unknown Lead")
                                print(
                                    f"[OutlookMonitor] Salesforce create queued for contact_id={contact_id} "
                                    f"(sync_status={sync_status or 'none'})"
                                )
                        except Exception as enqueue_exc:
                            print(f"[OutlookMonitor] Failed to queue Salesforce create: {enqueue_exc}")
                    print(
                        f"[OutlookMonitor] Inbound lead ingested (event {event_id}) "
                        f"contact_id={contact_id} created={created_new_contact}"
                    )
            except Exception as exc:
                db.insert_inbound_lead_event(
                    outlook_message_id=msg_id,
                    source_sender=from_addr,
                    subject=subject,
                    body_preview=text_preview,
                    lead_name=parsed.get("name"),
                    lead_company=parsed.get("company"),
                    lead_email=parsed.get("email"),
                    lead_phone=parsed.get("phone"),
                    lead_title=parsed.get("title"),
                    lead_industry=parsed.get("industry"),
                    lead_location=parsed.get("location"),
                    contact_id=contact_id,
                    received_at=received_at,
                    status="error",
                    error=str(exc),
                )
                print(f"[OutlookMonitor] Failed to ingest inbound lead: {exc}")

    # Catch-up pass: queue any inbound contacts that still need Salesforce create.
    if config.LEADFORGE_SALESFORCE_ENABLED:
        try:
            queued_catchup = 0
            with db.get_db() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT id, name, salesforce_sync_status
                    FROM linkedin_contacts
                    WHERE lower(COALESCE(salesforce_status, '')) LIKE 'inbound%'
                    ORDER BY scraped_at DESC, id DESC
                    LIMIT 250
                    """
                )
                rows = cursor.fetchall()
            for row in rows:
                sync_status = ((row["salesforce_sync_status"] or "").strip().lower())
                contact_id = int(row["id"])
                try:
                    _auto_enroll_inbound_contact(contact_id)
                except Exception as enroll_exc:
                    print(f"[OutlookMonitor] Auto-enroll catch-up failed for contact_id={contact_id}: {enroll_exc}")
                if sync_status in SYNC_TERMINAL_OR_ACTIVE:
                    continue
                contact_name = ((row["name"] or "").strip() or "Unknown Lead")
                enqueue_salesforce_create(contact_id, contact_name)
                queued_catchup += 1
            if queued_catchup > 0:
                print(f"[OutlookMonitor] Salesforce catch-up queued {queued_catchup} inbound contacts")
        except Exception as catchup_exc:
            print(f"[OutlookMonitor] Salesforce catch-up queue failed: {catchup_exc}")

    result = {
        "success": True,
        "checked": checked,
        "matched": matched_count,
        "new_replies": new_replies,
        "new_leads": new_leads,
        "lead_candidates": lead_candidates,
        "lead_parsed": lead_parsed,
        "lead_created_contacts": lead_created_contacts,
        "lead_updated_contacts": lead_updated_contacts,
        "message": (
            f"Checked {checked} messages. {matched_count} matched replies, "
            f"{new_replies} new replies logged, {new_leads} inbound leads ingested."
        ),
    }

    print(f"\n{'='*70}")
    print(f"[OutlookMonitor] SUMMARY:")
    print(f"  - Inbox messages checked: {checked}")
    print(f"  - Messages matched to sent emails: {matched_count}")
    print(f"  - New replies logged: {new_replies}")
    print(f"  - Lead candidates from sender: {lead_candidates}")
    print(f"  - Leads parsed: {lead_parsed}")
    print(f"  - New inbound leads ingested: {new_leads}")
    print(f"{'='*70}\n")

    _persist_poll_status(
        success=True,
        checked=checked,
        new_replies=new_replies,
        new_leads=new_leads,
        message=result.get("message"),
        error=None,
    )

    return result


async def backfill_inbound_lead_details(limit: int = 500, only_missing: bool = True) -> Dict:
    """
    Re-fetch stored inbound lead notification emails and enrich missing details
    (industry/location/etc.) from the preview-lead details page.
    """
    bounded_limit = max(1, min(int(limit or 500), 5000))
    token = get_access_token(interactive=False)
    if not token:
        return {
            "success": False,
            "error": "Not authenticated to Microsoft Graph",
            "scanned": 0,
            "updated": 0,
            "skipped": 0,
            "errors": 0,
        }

    with db.get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT
                id, outlook_message_id, source_sender, contact_id,
                lead_name, lead_company, lead_email, lead_phone, lead_title, lead_industry, lead_location
            FROM inbound_lead_events
            WHERE lower(COALESCE(source_sender, '')) = ?
              AND COALESCE(NULLIF(outlook_message_id, ''), '') != ''
        """
        params: list[object] = [INBOUND_LEAD_SENDER.lower()]
        if only_missing:
            query += " AND (COALESCE(NULLIF(lead_industry, ''), '') = '' OR COALESCE(NULLIF(lead_location, ''), '') = '')"
        query += " ORDER BY datetime(COALESCE(received_at, detected_at)) DESC, id DESC LIMIT ?"
        params.append(bounded_limit)
        cursor.execute(query, params)
        rows = [dict(r) for r in cursor.fetchall()]

    scanned = 0
    updated = 0
    skipped = 0
    errors = 0

    async with aiohttp.ClientSession() as session:
        async with aiohttp.ClientSession() as details_session:
            for row in rows:
                scanned += 1
                msg_id = (row.get("outlook_message_id") or "").strip()
                event_id = int(row["id"])
                if not msg_id:
                    skipped += 1
                    continue

                message = await _graph_get(
                    session,
                    f"{GRAPH_BASE}/me/messages/{msg_id}"
                    "?$select=id,subject,from,receivedDateTime,body,bodyPreview,internetMessageHeaders",
                    token,
                )
                if not message:
                    errors += 1
                    continue

                parsed = _parse_inbound_lead_notification(message)
                if not parsed:
                    skipped += 1
                    continue

                details_url = (parsed.get("details_url") or "").strip()
                if details_url:
                    details = await _fetch_preview_lead_details(details_session, details_url)
                    if details:
                        merged_name = " ".join(
                            [p for p in [details.get("first_name"), details.get("last_name")] if p]
                        ).strip()
                        parsed["name"] = merged_name or parsed.get("name")
                        parsed["company"] = details.get("company") or parsed.get("company")
                        parsed["email"] = details.get("email") or parsed.get("email")
                        parsed["phone"] = details.get("phone") or parsed.get("phone")
                        parsed["title"] = details.get("title") or parsed.get("title")
                        parsed["industry"] = details.get("industry") or parsed.get("industry")
                        parsed["location"] = details.get("location") or parsed.get("location")

                try:
                    resolved_contact_id, _ = db.upsert_inbound_lead_contact(
                        lead_name=parsed.get("name") or row.get("lead_name") or "Unknown Lead",
                        lead_company=parsed.get("company") or row.get("lead_company"),
                        lead_email=parsed.get("email") or row.get("lead_email"),
                        lead_phone=parsed.get("phone") or row.get("lead_phone"),
                        lead_title=parsed.get("title") or row.get("lead_title"),
                        lead_location=parsed.get("location") or row.get("lead_location"),
                        lead_source="website_form",
                        ingest_batch_id=f"outlook-backfill-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                    )
                    did = db.update_inbound_lead_event_details(
                        event_id=event_id,
                        lead_name=parsed.get("name"),
                        lead_company=parsed.get("company"),
                        lead_email=parsed.get("email"),
                        lead_phone=parsed.get("phone"),
                        lead_title=parsed.get("title"),
                        lead_industry=parsed.get("industry"),
                        lead_location=parsed.get("location"),
                        body_preview=_extract_text_body(message)[:1200],
                        contact_id=resolved_contact_id or row.get("contact_id"),
                        status="backfilled_details",
                        error=None,
                    )
                    if did:
                        updated += 1
                    else:
                        skipped += 1
                except Exception as exc:
                    errors += 1
                    db.update_inbound_lead_event_details(
                        event_id=event_id,
                        status="backfill_error",
                        error=str(exc),
                    )

    return {
        "success": True,
        "scanned": scanned,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
        "message": f"Backfill scanned {scanned}, updated {updated}, skipped {skipped}, errors {errors}.",
    }
