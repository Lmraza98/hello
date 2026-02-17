"""Email delivery, queue, scheduling, and config endpoints."""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.email_routes.models import (
    CampaignScheduleSummaryRecord,
    EmailConfigResponse,
    EmailConfigUpdateRequest,
    EmailConfigUpdateResponse,
    EmailDetailResponse,
    EmailQueueRecord,
    EmailSendResultResponse,
    ProcessScheduledResponse,
    ReorderRequest,
    RescheduleCampaignOffsetRequest,
    RescheduleCampaignOffsetResponse,
    RescheduleRequest,
    SendEmailsRequest,
    SendNowResponse,
    SentEmailRecord,
    SuccessResponse,
)
from api.routes.email_routes.utils import launch_sender

router = APIRouter()

def _offset_send_time(days_from_now: int) -> str:
    days = max(0, days_from_now)
    return (
        datetime.now().replace(microsecond=0) + timedelta(days=days)
    ).isoformat(timespec="seconds")


@router.post("/send", response_model=EmailSendResultResponse, responses=COMMON_ERROR_RESPONSES)
async def send_campaign_emails(data: SendEmailsRequest, background_tasks: BackgroundTasks):
    """
    Start sending campaign emails.
    Launches Salesforce automation in a separate process.
    """
    _ = background_tasks  # Kept for compatibility with existing client calls.
    try:
        campaign_info = ""
        if data.campaign_id:
            campaign = db.get_email_campaign(data.campaign_id)
            if not campaign:
                return {
                    "success": False,
                    "error": f"Campaign {data.campaign_id} not found",
                    "ready_count": 0,
                }
            if campaign["status"] != "active":
                return {
                    "success": False,
                    "error": f'Campaign is not active (status: {campaign["status"]}). Activate it first.',
                    "ready_count": 0,
                }

            enrolled = db.get_campaign_contacts(data.campaign_id)
            if not enrolled:
                return {
                    "success": False,
                    "error": "No contacts enrolled in this campaign. Enroll contacts first.",
                    "ready_count": 0,
                }
            campaign_info = f"Campaign: {campaign['name']}, {len(enrolled)} contacts enrolled. "

        contacts = db.get_contacts_ready_for_email(campaign_id=data.campaign_id, limit=data.limit or 10)

        if not contacts:
            if data.campaign_id:
                conn = db.get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    """
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
                """,
                    (data.campaign_id,),
                )
                samples = cursor.fetchall()
                conn.close()

                if samples:
                    details = []
                    for s in samples:
                        details.append(
                            f"{s['name']}: status={s['status']}, step={s['current_step']}/{s['num_emails']}, next_at={s['next_email_at']}"
                        )
                    return {
                        "success": False,
                        "error": "No contacts ready. Sample contacts:\n" + "\n".join(details),
                        "ready_count": 0,
                    }

            return {
                "success": False,
                "error": "No contacts ready to receive emails. Check that contacts are enrolled and campaign is active.",
                "ready_count": 0,
            }

        args = ["campaign", "--limit", str(data.limit or len(contacts))]
        if data.campaign_id:
            args += ["--campaign-id", str(data.campaign_id)]
        if data.review_mode:
            args.append("--review")
        args.append("--no-headless")
        launch_sender(args)

        return {
            "success": True,
            "message": f"{campaign_info}Launched sender with {len(contacts)} contacts ready",
            "ready_count": len(contacts),
        }
    except Exception as e:
        import traceback

        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


@router.get("/queue", response_model=list[EmailQueueRecord], responses=COMMON_ERROR_RESPONSES)
def get_email_queue(campaign_id: Optional[int] = None, limit: int = 50):
    """Get contacts waiting to receive their next email."""
    return db.get_contacts_ready_for_email(campaign_id=campaign_id, limit=limit)


@router.get("/sent", response_model=list[SentEmailRecord], responses=COMMON_ERROR_RESPONSES)
def get_sent_emails(campaign_id: Optional[int] = None, contact_id: Optional[int] = None, limit: int = 100):
    """Get sent email history."""
    return db.get_sent_emails(campaign_id=campaign_id, contact_id=contact_id, limit=limit)


@router.get("/scheduled", response_model=list[SentEmailRecord], responses=COMMON_ERROR_RESPONSES)
def get_scheduled():
    """Get approved emails with scheduled send times (due now - for the sender)."""
    return db.get_scheduled_emails(limit=50)


@router.get("/scheduled-emails", response_model=list[SentEmailRecord], responses=COMMON_ERROR_RESPONSES)
def get_all_scheduled(campaign_id: Optional[int] = None, limit: int = 200):
    """Get ALL future scheduled emails for the UI timeline view."""
    return db.get_all_scheduled_emails(campaign_id=campaign_id, limit=limit)


@router.get("/scheduled-emails/{email_id}", response_model=EmailDetailResponse, responses=COMMON_ERROR_RESPONSES)
def get_email_detail(email_id: int):
    """Get detailed info for a single email including sequence history."""
    detail = db.get_email_detail(email_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Email not found")
    return detail


@router.get(
    "/campaign-schedule-summary",
    response_model=list[CampaignScheduleSummaryRecord],
    responses=COMMON_ERROR_RESPONSES,
)
def get_campaign_schedule_summary():
    """Get per-campaign scheduled/pending counts for campaign cards."""
    return db.get_campaign_scheduled_summary()


@router.put(
    "/scheduled-emails/{email_id}/reschedule",
    response_model=SuccessResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def reschedule_email(email_id: int, data: RescheduleRequest):
    """Reschedule a single email to a new time."""
    success = db.reschedule_email(email_id, data.send_time)
    if not success:
        raise HTTPException(status_code=404, detail="Email not found or not in approved state")
    return {"success": True}


@router.put("/scheduled-emails/reorder", response_model=SuccessResponse, responses=COMMON_ERROR_RESPONSES)
def reorder_emails(data: ReorderRequest):
    """Reorder scheduled emails with auto-adjusted times (1-min spacing)."""
    db.reorder_scheduled_emails(data.email_ids, data.start_time)
    return {"success": True}

@router.put(
    "/scheduled-emails/reschedule-by-offset",
    response_model=RescheduleCampaignOffsetResponse,
    responses=COMMON_ERROR_RESPONSES,
)
def reschedule_campaign_by_offset(data: RescheduleCampaignOffsetRequest):
    """Reschedule approved pending emails in a campaign to N days from now."""
    scheduled = db.get_all_scheduled_emails(campaign_id=data.campaign_id, limit=max(1, min(data.limit, 500)))
    if len(scheduled) == 0:
        return {
            "success": True,
            "campaign_id": data.campaign_id,
            "rescheduled": 0,
            "send_time": _offset_send_time(data.days_from_now),
        }

    send_time = _offset_send_time(data.days_from_now)
    rescheduled = 0
    for row in scheduled:
        email_id = int(row.get("id") or 0)
        if email_id <= 0:
            continue
        ok = db.reschedule_email(email_id, send_time)
        if ok:
            rescheduled += 1

    return {
        "success": True,
        "campaign_id": data.campaign_id,
        "rescheduled": rescheduled,
        "send_time": send_time,
    }


@router.post("/scheduled-emails/{email_id}/send-now", response_model=SendNowResponse, responses=COMMON_ERROR_RESPONSES)
async def send_email_now(email_id: int):
    """Send a single scheduled email immediately via Salesforce automation."""
    try:
        detail = db.get_email_detail(email_id)
        if not detail:
            return {"success": False, "error": "Email not found"}
        if detail["review_status"] != "approved":
            return {"success": False, "error": f'Email is not approved (status: {detail["review_status"]})'}

        db.reschedule_email(email_id, datetime.now().isoformat())
        contact_name = detail.get("contact_name", "Unknown")
        company_name = detail.get("company_name", "")
        subject = detail.get("rendered_subject") or detail.get("subject", "")

        launch_sender(["send-now", "--limit", "1"])
        return {
            "success": True,
            "message": f"Salesforce sender launched for {contact_name} at {company_name}",
            "contact_name": contact_name,
            "company_name": company_name,
            "subject": subject,
        }
    except Exception as e:
        import traceback

        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


@router.post(
    "/process-scheduled",
    response_model=ProcessScheduledResponse,
    responses=COMMON_ERROR_RESPONSES,
)
async def process_scheduled():
    """Process scheduled emails that are due for sending."""
    try:
        emails = db.get_scheduled_emails(limit=10)
        if not emails:
            return {"success": True, "message": "No emails due for sending", "processed": 0}

        launch_sender(["process-scheduled", "--limit", str(len(emails))])
        return {
            "success": True,
            "message": f"Launched sender for {len(emails)} scheduled emails",
            "count": len(emails),
        }
    except Exception as e:
        import traceback

        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


@router.get("/config", response_model=EmailConfigResponse, responses=COMMON_ERROR_RESPONSES)
def get_email_config():
    """Get all email system config values."""
    return db.get_all_config()


@router.put("/config", response_model=EmailConfigUpdateResponse, responses=COMMON_ERROR_RESPONSES)
def update_email_config(data: EmailConfigUpdateRequest):
    """Update config values (daily cap, send window, etc.)."""
    allowed_keys = {
        "daily_send_cap",
        "send_window_start",
        "send_window_end",
        "min_minutes_between_sends",
        "tracking_poll_interval_minutes",
        "tracking_lookback_days",
    }
    updated = []
    for key, value in data.model_dump(exclude_none=True).items():
        if key in allowed_keys:
            db.set_config(key, str(value))
            updated.append(key)
    return {"success": True, "updated": updated}
