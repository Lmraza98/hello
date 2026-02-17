"""Pydantic models used across email route modules."""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, RootModel


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


class EmailTemplateRecord(BaseModel):
    id: Optional[int] = None
    campaign_id: Optional[int] = None
    step_number: int
    subject_template: str
    body_template: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailCampaignStatsResponse(BaseModel):
    total_contacts: Optional[int] = None
    active: Optional[int] = None
    completed: Optional[int] = None
    total_sent: Optional[int] = None
    failed: Optional[int] = None
    total_opened: Optional[int] = None
    total_replied: Optional[int] = None
    open_rate: Optional[float] = None
    reply_rate: Optional[float] = None
    total_campaigns: Optional[int] = None
    active_campaigns: Optional[int] = None
    total_contacts_enrolled: Optional[int] = None
    sent_today: Optional[int] = None

    model_config = ConfigDict(extra="allow")


class EmailCampaignSegmentResponse(BaseModel):
    campaign_id: int
    campaign_name: str
    segment_type: str
    segment_value: str
    total_sent: int
    total_replied: int
    reply_rate: float

    model_config = ConfigDict(extra="allow")


class EmailDailyMetric(BaseModel):
    date: str
    sent: int
    viewed: int
    responded: int

    model_config = ConfigDict(extra="allow")


class EmailCampaignRecord(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    num_emails: int
    days_between_emails: int
    status: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    templates: list[EmailTemplateRecord] = Field(default_factory=list)
    stats: Optional[EmailCampaignStatsResponse] = None

    model_config = ConfigDict(extra="allow")


class EnrollContactsRequest(BaseModel):
    contact_ids: list[int]


class EnrollContactsByFilterRequest(BaseModel):
    """Enroll contacts matching filter criteria into a campaign.
    All filters are optional; at least one must be provided."""
    query: Optional[str] = None
    vertical: Optional[str] = None
    company: Optional[str] = None
    has_email: Optional[bool] = None
    today_only: bool = False


class EnrollByFilterResponse(BaseModel):
    enrolled: int
    skipped: int
    total_matched: int
    filter_used: dict
    error: Optional[str] = None


class CampaignStatusResponse(BaseModel):
    status: str


class EnrollContactsResponse(BaseModel):
    enrolled: int
    skipped: int
    error: Optional[str] = None


class CampaignDeleteResponse(BaseModel):
    deleted: bool


class CampaignContactRemovedResponse(BaseModel):
    removed: bool


class CampaignContactRecord(BaseModel):
    id: int
    campaign_id: int
    contact_id: int
    current_step: Optional[int] = None
    status: Optional[str] = None
    next_email_at: Optional[str] = None
    enrolled_at: Optional[str] = None
    last_email_at: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    domain: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class CampaignSalesforceUploadedContact(BaseModel):
    id: int
    name: str
    uploaded_at: str

    model_config = ConfigDict(extra="allow")


class CampaignSalesforceUploadResponse(BaseModel):
    success: bool
    csv_path: Optional[str] = None
    csv_filename: Optional[str] = None
    exported: Optional[int] = None
    skipped_already_uploaded: Optional[int] = None
    batch_id: Optional[str] = None
    campaign_name: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None
    already_uploaded: list[CampaignSalesforceUploadedContact] = Field(default_factory=list)
    traceback: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailPreviewContact(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    domain: Optional[str] = None
    email: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailPreviewResponse(BaseModel):
    subject: str
    body: str
    contact: EmailPreviewContact
    step: int
    error: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class SendEmailsRequest(BaseModel):
    campaign_id: Optional[int] = None
    limit: Optional[int] = None
    review_mode: bool = True


class EmailSendResultResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    ready_count: Optional[int] = None
    error: Optional[str] = None
    traceback: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailQueueRecord(BaseModel):
    id: int
    campaign_id: int
    contact_id: int
    current_step: int
    status: str
    next_email_at: Optional[str] = None
    campaign_name: Optional[str] = None
    contact_name: Optional[str] = None
    company_name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    domain: Optional[str] = None
    num_emails: Optional[int] = None
    days_between_emails: Optional[int] = None

    model_config = ConfigDict(extra="allow")


class SentEmailRecord(BaseModel):
    id: int
    campaign_id: int
    contact_id: int
    step_number: Optional[int] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    rendered_subject: Optional[str] = None
    rendered_body: Optional[str] = None
    review_status: Optional[str] = None
    status: Optional[str] = None
    sent_at: Optional[str] = None
    scheduled_send_time: Optional[str] = None
    opened: Optional[bool] = None
    open_count: Optional[int] = None
    first_opened_at: Optional[str] = None
    replied: Optional[bool] = None
    replied_at: Optional[str] = None
    contact_name: Optional[str] = None
    company_name: Optional[str] = None
    campaign_name: Optional[str] = None
    contact_title: Optional[str] = None
    contact_email: Optional[str] = None
    contact_linkedin: Optional[str] = None
    campaign_contact_id: Optional[int] = None
    num_emails: Optional[int] = None
    days_between_emails: Optional[int] = None

    model_config = ConfigDict(extra="allow")


class EmailSequenceRecord(BaseModel):
    id: int
    step_number: Optional[int] = None
    subject: Optional[str] = None
    rendered_subject: Optional[str] = None
    status: Optional[str] = None
    review_status: Optional[str] = None
    sent_at: Optional[str] = None
    scheduled_send_time: Optional[str] = None
    opened: Optional[bool] = None
    open_count: Optional[int] = None
    replied: Optional[bool] = None
    replied_at: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailDetailResponse(SentEmailRecord):
    current_step: Optional[int] = None
    enrollment_status: Optional[str] = None
    sequence_emails: list[EmailSequenceRecord] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


class CampaignScheduleSummaryRecord(BaseModel):
    campaign_id: int
    campaign_name: str
    campaign_status: Optional[str] = None
    scheduled_count: int
    pending_review_count: int
    next_send_time: Optional[str] = None
    last_sent_at: Optional[str] = None
    next_contact_name: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailApproveRequest(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None


class BulkApproveRequest(BaseModel):
    email_ids: list[int]

class ApproveCampaignQueueRequest(BaseModel):
    campaign_id: int
    limit: Optional[int] = 50


class SuccessResponse(BaseModel):
    success: bool


class BulkApproveResponse(BaseModel):
    success: bool
    approved: int

class ApproveCampaignQueueResponse(BaseModel):
    success: bool
    approved: int
    campaign_id: int
    queued: int


class RescheduleRequest(BaseModel):
    send_time: str

class RescheduleCampaignOffsetRequest(BaseModel):
    campaign_id: int
    days_from_now: int = 3
    limit: int = 200

class RescheduleCampaignOffsetResponse(BaseModel):
    success: bool
    campaign_id: int
    rescheduled: int
    send_time: str


class ReorderRequest(BaseModel):
    email_ids: list[int]
    start_time: Optional[str] = None


class ProcessScheduledResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    processed: Optional[int] = None
    count: Optional[int] = None
    error: Optional[str] = None
    traceback: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class SendNowResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    contact_name: Optional[str] = None
    company_name: Optional[str] = None
    subject: Optional[str] = None
    error: Optional[str] = None
    traceback: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailConfigResponse(RootModel[dict[str, str]]):
    pass


class EmailConfigUpdateRequest(BaseModel):
    daily_send_cap: Optional[int] = None
    send_window_start: Optional[str] = None
    send_window_end: Optional[str] = None
    min_minutes_between_sends: Optional[int] = None
    tracking_poll_interval_minutes: Optional[int] = None
    tracking_lookback_days: Optional[int] = None


class EmailConfigUpdateResponse(BaseModel):
    success: bool
    updated: list[str]


class DashboardMetricsResponse(BaseModel):
    reply_rate: float
    meeting_booking_rate: float
    active_conversations: int
    best_campaign: Optional[EmailCampaignSegmentResponse] = None
    daily: list[EmailDailyMetric] = Field(default_factory=list)
    recent_replies: list[dict[str, Any]] = Field(default_factory=list)
    outlook_connected: bool

    model_config = ConfigDict(extra="allow")


class ReviewQueueItem(SentEmailRecord):
    model_config = ConfigDict(extra="allow")


class TrackingStatusResponse(BaseModel):
    total_sent: int
    total_opened: int
    total_replied: int
    open_rate: float
    reply_rate: float
    avg_open_count: float

    model_config = ConfigDict(extra="allow")


class BatchPreparationResponse(BaseModel):
    success: bool
    drafts_created: int
    contacts_checked: Optional[int] = None
    daily_cap: Optional[int] = None
    already_created: Optional[int] = None
    remaining_cap: Optional[int] = None
    message: Optional[str] = None
    errors: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


class TrackingPollResponse(BaseModel):
    success: bool
    checked: int
    updated: int
    message: Optional[str] = None
    error: Optional[str] = None
    errors: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


class OutlookAuthStatusResponse(BaseModel):
    authenticated: bool
    account: Optional[str] = None
    client_id: Optional[str] = None
    tenant_id: Optional[str] = None
    auth_in_progress: Optional[bool] = None
    auth_error: Optional[str] = None
    error: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class OutlookAuthStartResponse(BaseModel):
    success: bool
    already_authenticated: Optional[bool] = None
    account: Optional[str] = None
    verification_uri: Optional[str] = None
    user_code: Optional[str] = None
    message: Optional[str] = None
    expires_in: Optional[int] = None
    error: Optional[str] = None
    traceback: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class OutlookPollRepliesResponse(BaseModel):
    success: bool
    checked: int = 0
    new_replies: int = 0
    matched: Optional[int] = None
    message: Optional[str] = None
    error: Optional[str] = None
    traceback: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class EmailReplyRecord(BaseModel):
    id: int
    sent_email_id: Optional[int] = None
    campaign_contact_id: Optional[int] = None
    contact_id: int
    outlook_message_id: Optional[str] = None
    from_address: Optional[str] = None
    subject: Optional[str] = None
    body_preview: Optional[str] = None
    received_at: Optional[str] = None
    contact_name: Optional[str] = None
    company_name: Optional[str] = None
    contact_email: Optional[str] = None
    campaign_name: Optional[str] = None
    original_subject: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ActiveConversationRecord(BaseModel):
    reply_id: int
    contact_id: int
    reply_subject: Optional[str] = None
    body_preview: Optional[str] = None
    received_at: Optional[str] = None
    contact_name: Optional[str] = None
    company_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_title: Optional[str] = None
    campaign_name: Optional[str] = None
    original_subject: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ConversationThreadMessage(BaseModel):
    msg_type: str
    id: int
    subject: Optional[str] = None
    body: Optional[str] = None
    timestamp: Optional[str] = None
    campaign_name: Optional[str] = None
    step_number: Optional[int] = None

    model_config = ConfigDict(extra="allow")


class ConversationContact(BaseModel):
    id: int
    name: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ConversationThreadResponse(BaseModel):
    contact: Optional[ConversationContact] = None
    thread: list[ConversationThreadMessage] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")
