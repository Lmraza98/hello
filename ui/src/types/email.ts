export type EmailCampaign = {
  id: number;
  name: string;
  description: string | null;
  num_emails: number;
  days_between_emails: number;
  status: string;
  created_at: string;
  templates?: EmailTemplate[];
  stats?: CampaignStats;
};

export type EmailTemplate = {
  id: number;
  campaign_id: number;
  step_number: number;
  subject_template: string;
  body_template: string;
};

export type CampaignStats = {
  total_contacts: number;
  active: number;
  completed: number;
  total_sent: number;
  failed: number;
  open_rate?: number;
  reply_rate?: number;
};

export type CampaignContact = {
  id: number;
  contact_id: number;
  contact_name: string;
  email: string;
  title: string;
  company_name: string;
  current_step: number;
  status: string;
  next_email_at: string | null;
};

export type SentEmail = {
  id: number;
  campaign_id: number;
  campaign_name: string;
  contact_id: number;
  contact_name: string;
  company_name: string;
  step_number: number;
  subject: string;
  body: string;
  sent_at: string;
  status: string;
  error_message: string | null;
  review_status: string | null;
  rendered_subject: string | null;
  rendered_body: string | null;
  opened: number;
  open_count: number;
  first_opened_at: string | null;
  replied: number;
  replied_at: string | null;
  last_tracked_at: string | null;
  scheduled_send_time: string | null;
};

export type ReviewQueueItem = {
  id: number;
  campaign_id: number;
  campaign_name: string;
  contact_id: number;
  contact_name: string;
  company_name: string;
  contact_title: string;
  contact_email: string;
  step_number: number;
  num_emails: number;
  subject: string;
  body: string;
  rendered_subject: string;
  rendered_body: string;
  review_status: string;
};

export type EmailConfig = {
  daily_send_cap: string;
  send_window_start: string;
  send_window_end: string;
  min_minutes_between_sends: string;
  tracking_poll_interval_minutes: string;
  tracking_lookback_days: string;
};

export type GlobalStats = {
  total_campaigns: number;
  active_campaigns: number;
  total_contacts_enrolled: number;
  total_sent: number;
  sent_today: number;
};

export type ScheduledEmail = {
  id: number;
  campaign_id: number;
  contact_id: number;
  step_number: number;
  subject: string;
  body: string;
  rendered_subject: string | null;
  rendered_body: string | null;
  review_status: string;
  scheduled_send_time: string;
  status: string | null;
  opened: number;
  open_count: number;
  first_opened_at: string | null;
  replied: number;
  replied_at: string | null;
  contact_name: string;
  company_name: string;
  contact_title: string;
  contact_email: string;
  contact_linkedin: string | null;
  campaign_name: string;
  num_emails: number;
  days_between_emails: number;
  campaign_contact_id: number;
};

export type EmailDetail = ScheduledEmail & {
  current_step: number;
  enrollment_status: string;
  sequence_emails: Array<{
    id: number;
    step_number: number;
    subject: string;
    rendered_subject: string | null;
    status: string | null;
    review_status: string;
    sent_at: string | null;
    scheduled_send_time: string | null;
    opened: number;
    open_count: number;
    replied: number;
    replied_at: string | null;
  }>;
};

export type CampaignScheduleSummary = {
  campaign_id: number;
  campaign_name: string;
  campaign_status: string;
  scheduled_count: number;
  pending_review_count: number;
  next_send_time: string | null;
  next_contact_name: string | null;
  last_sent_at: string | null;
};
