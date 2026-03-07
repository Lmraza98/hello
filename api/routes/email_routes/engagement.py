"""Metrics, review, tracking, and Outlook/reply endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException

import config
import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.email_routes.models import (
    ActiveConversationRecord,
    ApproveCampaignQueueRequest,
    ApproveCampaignQueueResponse,
    BatchPreparationResponse,
    BulkApproveRequest,
    BulkApproveResponse,
    ConversationThreadResponse,
    DashboardMetricsResponse,
    EmailApproveRequest,
    EmailCampaignStatsResponse,
    EmailReplyRecord,
    InboundLeadAlertsResponse,
    InboundLeadBackfillResponse,
    InboundLeadEventRecord,
    InboundLeadMarkSeenResponse,
    InboundLeadQueueSalesforceResponse,
    OutlookAuthStartResponse,
    OutlookAuthStatusResponse,
    OutlookPollRepliesResponse,
    OutlookPollStatusResponse,
    ReviewQueueItem,
    SuccessResponse,
    TrackingPollResponse,
    TrackingStatusResponse,
)
from services.web_automation.salesforce.lookup_queue import enqueue_pending_inbound_salesforce_creates

router = APIRouter()


@router.get("/stats", response_model=EmailCampaignStatsResponse, responses=COMMON_ERROR_RESPONSES)
def get_email_stats():
    """Get overall email campaign statistics."""
    return db.get_email_campaign_stats()


@router.get("/dashboard-metrics", response_model=DashboardMetricsResponse, responses=COMMON_ERROR_RESPONSES)
def get_dashboard_metrics(days: int = 30, active_days: int = 30):
    """Get aggregated email metrics for the dashboard."""
    tracking = db.get_tracking_stats(days=days)
    daily = db.get_daily_email_stats(days=days)
    meeting = db.get_meeting_booking_rate(days=days)
    active_conversations = db.get_active_conversations_count(days=active_days)
    best_campaign = db.get_best_campaign_segment(days=days)
    recent_replies = db.get_active_conversations(days=active_days, limit=5)

    outlook_connected = False
    try:
        from services.email.graph_auth import is_authenticated

        outlook_connected = is_authenticated()
    except ImportError:
        pass

    return {
        "reply_rate": tracking.get("reply_rate", 0),
        "meeting_booking_rate": meeting.get("meeting_rate", 0),
        "active_conversations": active_conversations,
        "best_campaign": best_campaign,
        "daily": daily,
        "recent_replies": recent_replies,
        "outlook_connected": outlook_connected,
    }


@router.get("/review-queue", response_model=list[ReviewQueueItem], responses=COMMON_ERROR_RESPONSES)
def get_review_queue():
    """Get all emails pending review."""
    return db.get_review_queue()


@router.post(
    "/review-queue/{email_id}/approve",
    response_model=SuccessResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def approve_email(email_id: int, data: Optional[EmailApproveRequest] = None):
    """Approve a single email. Body can include edited subject/body."""
    db.approve_email(
        email_id,
        edited_subject=data.subject if data else None,
        edited_body=data.body if data else None,
    )
    return {"success": True}


@router.post(
    "/review-queue/{email_id}/reject",
    response_model=SuccessResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def reject_email(email_id: int):
    """Reject a single email."""
    db.reject_email(email_id)
    return {"success": True}


@router.post(
    "/review-queue/approve-all",
    response_model=BulkApproveResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def approve_all(data: BulkApproveRequest):
    """Bulk approve emails."""
    db.approve_all_emails(data.email_ids)
    return {"success": True, "approved": len(data.email_ids)}

@router.post(
    "/review-queue/approve-campaign",
    response_model=ApproveCampaignQueueResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def approve_campaign_queue(data: ApproveCampaignQueueRequest):
    """Approve pending review emails for a campaign (up to limit)."""
    queue = db.get_review_queue(limit=max(1, min(data.limit or 50, 500)))
    ids = [
        int(row["id"])
        for row in queue
        if isinstance(row, dict) and int(row.get("campaign_id") or 0) == data.campaign_id and row.get("id") is not None
    ]
    if len(ids) == 0:
        return {"success": True, "approved": 0, "campaign_id": data.campaign_id, "queued": 0}
    db.approve_all_emails(ids)
    return {"success": True, "approved": len(ids), "campaign_id": data.campaign_id, "queued": len(ids)}


@router.post("/prepare-batch", response_model=BatchPreparationResponse, responses=COMMON_ERROR_RESPONSES)
async def prepare_batch():
    """Manually trigger daily batch preparation."""
    from services.email.preparer import prepare_daily_batch

    return await prepare_daily_batch()


@router.get("/tracking-status", response_model=TrackingStatusResponse, responses=COMMON_ERROR_RESPONSES)
def get_tracking_status(days: int = 7):
    """Get recent tracking data for dashboard display."""
    return db.get_tracking_stats(days=days)


@router.post("/poll-tracking", response_model=TrackingPollResponse, responses=COMMON_ERROR_RESPONSES)
async def poll_tracking():
    """Manually trigger Salesforce tracking poll."""
    from services.email.salesforce_tracker import poll_salesforce_tracking

    return await poll_salesforce_tracking()


@router.get(
    "/outlook/auth-status",
    response_model=OutlookAuthStatusResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def get_outlook_auth_status():
    """Check Microsoft Graph authentication status. Returns instantly."""
    try:
        from services.email.graph_auth import get_auth_status

        return get_auth_status()
    except ImportError:
        return {"authenticated": False, "error": "MSAL not installed. Run: pip install msal"}
    except Exception as e:
        return {"authenticated": False, "error": str(e)}


@router.post("/outlook/auth", response_model=OutlookAuthStartResponse, responses=COMMON_ERROR_RESPONSES)
def start_outlook_auth():
    """Start interactive Microsoft Graph authentication (device-code flow)."""
    try:
        from services.email.graph_auth import initiate_auth

        return initiate_auth()
    except ImportError:
        return {"success": False, "error": "MSAL not installed. Run: pip install msal"}
    except Exception as e:
        import traceback

        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


@router.post("/outlook/logout", response_model=SuccessResponse, responses=COMMON_ERROR_RESPONSES)
def outlook_logout():
    """Clear Microsoft Graph tokens."""
    try:
        from services.email.graph_auth import logout

        logout()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post(
    "/outlook/poll-replies",
    response_model=OutlookPollRepliesResponse,
    responses=COMMON_ERROR_RESPONSES,
)
async def poll_outlook_replies_endpoint(minutes_back: int = 15):
    """Manually trigger Outlook reply polling."""
    try:
        from services.email.outlook_monitor import poll_outlook_replies

        return await poll_outlook_replies(minutes_back=minutes_back)
    except ImportError:
        return {"success": False, "error": "MSAL not installed. Run: pip install msal"}
    except Exception as e:
        import traceback

        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


@router.get(
    "/outlook/poll-status",
    response_model=OutlookPollStatusResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def get_outlook_poll_status():
    """Get latest persisted Outlook poll summary (last run time, counts, status)."""
    return db.get_outlook_poll_status()


@router.get(
    "/outlook/inbound-leads/alerts",
    response_model=InboundLeadAlertsResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def get_inbound_lead_alerts():
    """Get unseen inbound lead notification count for nav alerting."""
    return {"unseen_count": db.get_unseen_inbound_lead_count()}


@router.post(
    "/outlook/inbound-leads/mark-seen",
    response_model=InboundLeadMarkSeenResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def mark_inbound_leads_seen():
    """Mark inbound lead notifications as seen."""
    return {"success": True, "marked_seen": db.mark_inbound_leads_seen()}


@router.post(
    "/outlook/inbound-leads/queue-salesforce",
    response_model=InboundLeadQueueSalesforceResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def queue_inbound_leads_for_salesforce(limit: int = 500):
    """
    Queue existing inbound contacts for single-contact Salesforce create jobs.
    Useful for backfilling leads that were ingested before queueing was enabled.
    """
    if not config.LEADFORGE_SALESFORCE_ENABLED:
        return {
            "success": False,
            "queued": 0,
            "message": "Salesforce sync is disabled (LEADFORGE_SALESFORCE_ENABLED=0).",
        }
    queued = enqueue_pending_inbound_salesforce_creates(limit=limit)
    return {
        "success": True,
        "queued": int(queued),
        "message": f"Queued {int(queued)} inbound contacts for Salesforce sync.",
    }


@router.post(
    "/outlook/inbound-leads/backfill-details",
    response_model=InboundLeadBackfillResponse,
    responses=COMMON_ERROR_RESPONSES,
)
async def backfill_inbound_lead_details_endpoint(limit: int = 500, only_missing: bool = True):
    """Backfill missing inbound lead details by re-parsing historical Outlook lead emails."""
    try:
        from services.email.outlook_monitor import backfill_inbound_lead_details

        return await backfill_inbound_lead_details(limit=limit, only_missing=only_missing)
    except Exception as e:
        return {
            "success": False,
            "scanned": 0,
            "updated": 0,
            "skipped": 0,
            "errors": 1,
            "error": str(e),
            "message": "Inbound lead details backfill failed.",
        }


@router.get(
    "/outlook/inbound-leads/recent",
    response_model=list[InboundLeadEventRecord],
    responses=COMMON_ERROR_RESPONSES,
)
def get_recent_inbound_leads(limit: int = 20):
    """List recent inbound lead ingestion events."""
    return db.get_recent_inbound_leads(limit=limit)


@router.get("/replies", response_model=list[EmailReplyRecord], responses=COMMON_ERROR_RESPONSES)
def get_replies(contact_id: Optional[int] = None, campaign_id: Optional[int] = None, limit: int = 50):
    """Get logged email replies."""
    return db.get_email_replies(contact_id=contact_id, campaign_id=campaign_id, limit=limit)


@router.get(
    "/active-conversations",
    response_model=list[ActiveConversationRecord],
    responses=COMMON_ERROR_RESPONSES,
)
def get_active_conversations_endpoint(days: int = 30, limit: int = 50):
    """Get active conversations (contacts who replied) for the dashboard."""
    return db.get_active_conversations(days=days, limit=limit)


@router.post(
    "/conversations/{reply_id}/mark-handled",
    response_model=SuccessResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def mark_conversation_handled(reply_id: int):
    """Mark a conversation as handled (removes from Active Conversations)."""
    success = db.mark_conversation_handled(reply_id)
    if not success:
        raise HTTPException(status_code=404, detail="Reply not found")
    return {"success": True}


@router.get(
    "/conversations/{contact_id}/thread",
    response_model=ConversationThreadResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def get_conversation_thread(contact_id: int, limit: int = 20):
    """Get the full conversation thread for a contact."""
    thread = db.get_conversation_thread(contact_id, limit=limit)
    conn = db.get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, name, title, company_name, email_generated as email, linkedin_url
        FROM linkedin_contacts WHERE id = ?
    """,
        (contact_id,),
    )
    row = cursor.fetchone()
    conn.close()
    contact = dict(row) if row else None
    return {"contact": contact, "thread": thread}
