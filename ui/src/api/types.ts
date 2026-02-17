/**
 * API response types — shared across all domain modules.
 *
 * Email-specific types live in `types/email.ts` and are re-exported
 * from this file for convenience.
 */

// ── Re-exports from canonical type files ────────────────────
export type { EmailCampaign, CampaignStats as EmailCampaignStats } from '../types/email';

// ── Admin ───────────────────────────────────────────────────

export type AdminLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AdminLogRow = {
  id: number;
  timestamp: string;
  level: AdminLogLevel;
  feature?: string | null;
  source?: string | null;
  message: string;
  user_id?: string | null;
  correlation_id?: string | null;
  request_id?: string | null;
  status_code?: number | null;
  duration_ms?: number | null;
  meta_json?: Record<string, unknown>;
};

export type GetAdminLogsParams = {
  q?: string;
  level?: AdminLogLevel;
  feature?: string;
  source?: string;
  time_range?: '15m' | '1h' | '24h' | '7d';
  correlation_id?: string;
  limit?: number;
};

export type AdminCostsRange = 'today' | '7d' | '30d';

export type ChatTracePayload = {
  user_message?: string;
  route?: string;
  route_reason?: string;
  model_used?: string;
  tool_brain_name?: string;
  tool_brain_model?: string;
  tools_used?: string[];
  fallback_used?: boolean;
  success?: boolean;
  failure_reason?: string;
  native_tool_calls?: number;
  token_tool_calls?: number;
  selected_tools?: string[];
  model_switches?: Array<{ from: string; to: string; reason: string }>;
  response_preview?: string;
};

export type AdminCostsResponse = {
  summary: {
    total_usd: number;
    openai_usd: number;
    tavily_usd: number;
    requests: number;
    avg_cost_usd: number;
    p95_cost_usd: number;
  };
  by_feature: Array<{ key: string; requests: number; total_usd: number; avg_usd: number; errors?: number }>;
  by_model: Array<{ key: string; requests: number; total_usd: number; avg_usd: number; errors?: number }>;
  top_expensive: Array<{ correlation_id?: string; endpoint?: string; tool?: string; total_usd: number; requests: number }>;
};

// ── Core entities ───────────────────────────────────────────

export type Stats = {
  total_companies: number;
  total_contacts: number;
  contacts_with_email: number;
  contacts_today: number;
};

export type Company = {
  id: number;
  company_name: string;
  domain: string | null;
  tier: string | null;
  vertical: string | null;
  target_reason: string | null;
  wedge: string | null;
  status: string | null;
};

export type CompanyBiProfile = {
  linked: boolean;
  company_key?: string | null;
  match_method?: string | null;
  match_confidence?: number | null;
  bi_company?: Record<string, unknown> | null;
  signals: Array<Record<string, unknown>>;
  coverage: Record<string, number>;
  app_evidence: Array<Record<string, unknown>>;
  collection_logs?: BiSourceRun[];
  source_links?: Array<{ source?: string; url?: string }>;
  prospect_score?: { score: number; computed_at: string } | null;
};

export type Contact = {
  id: number;
  company_name: string;
  domain: string | null;
  name: string;
  title: string | null;
  email: string | null;
  email_pattern: string | null;
  email_confidence: number | null;
  email_verified: boolean;
  phone: string | null;
  phone_source: string | null;
  phone_confidence: number | null;
  linkedin_url: string | null;
  salesforce_url: string | null;
  salesforce_status: string | null;
  salesforce_uploaded_at: string | null;
  salesforce_upload_batch: string | null;
  scraped_at: string | null;
  vertical: string | null;
};

export type CreateContactInput = Partial<Contact> & {
  location?: string;
  first_name?: string;
  last_name?: string;
};

export type PipelineStatus = {
  running: boolean;
  output: { time: string; text: string }[];
  started_at: string | null;
};

// ── Email / Outlook / Conversations ─────────────────────────

export type EmailDailyStat = {
  date: string;
  sent: number;
  viewed: number;
  responded: number;
};

export type BestCampaignMetric = {
  campaign_id: number;
  campaign_name: string;
  segment_type: 'vertical' | 'title';
  segment_value: string;
  reply_rate: number;
  total_sent: number;
  total_replied: number;
};

export type ReplyPreview = {
  reply_id: number;
  contact_id: number;
  contact_name: string;
  company_name: string;
  contact_email: string;
  contact_title: string | null;
  campaign_name: string;
  reply_subject: string | null;
  body_preview: string | null;
  original_subject: string | null;
  received_at: string;
};

export type OutlookAuthStatus = {
  authenticated: boolean;
  account: string | null;
  client_id?: string;
  tenant_id?: string;
  has_active_flow?: boolean;
  error?: string;
};

export type SalesforceAuthStatus = {
  status: 'authenticated' | 'expired' | 'not_configured';
  username: string | null;
  message: string;
};

export type EmailDashboardMetrics = {
  reply_rate: number;
  meeting_booking_rate: number;
  active_conversations: number;
  best_campaign: BestCampaignMetric | null;
  daily: EmailDailyStat[];
  recent_replies: ReplyPreview[];
  outlook_connected: boolean;
};

export type ThreadMessage = {
  msg_type: 'sent' | 'reply';
  id: number;
  subject: string | null;
  body: string | null;
  timestamp: string | null;
  campaign_name: string;
  step_number: number;
};

export type ConversationThread = {
  contact: {
    id: number;
    name: string;
    title: string | null;
    company_name: string;
    email: string | null;
    linkedin_url: string | null;
  } | null;
  thread: ThreadMessage[];
};

export type ScheduledEmailPreview = {
  id: number;
  contact_name: string;
  company_name: string;
  campaign_name: string;
  rendered_subject: string | null;
  subject: string;
  step_number: number;
  num_emails: number;
  scheduled_send_time: string;
};

export type GeneratedEmail = {
  id: number;
  subject?: string | null;
  rendered_subject?: string | null;
  body?: string | null;
  rendered_body?: string | null;
  scheduled_send_time?: string | null;
};

// ── BI ──────────────────────────────────────────────────────

export type BiCompany = {
  id: number;
  source_target_id: number | null;
  name: string;
  domain: string | null;
  vertical: string | null;
  tier: string | null;
  status: string | null;
  prospect_score: number;
  icp_fit_score: number;
  signal_score: number;
  engagement_score: number;
  score_updated_at: string | null;
  updated_at: string | null;
};

export type BiRun = {
  id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  processed: number;
  inserted: number;
  updated: number;
  unchanged?: number;
  signals_added?: number;
  failed: number;
  error_log: string | null;
};

export type BiSourceRun = {
  source: string;
  query?: string;
  started_at?: string;
  completed_at?: string;
  ok?: boolean;
  http_status?: number;
  collected?: number;
  saved?: number;
  message?: string;
  link?: string;
  parse_error?: boolean;
  raw?: string;
};

export type BiStatus = {
  db_path: string;
  has_bi_companies: boolean;
  has_bi_runs: boolean;
  bi_companies_count: number;
  updated_last_hour: number;
  top5: Array<{
    name: string;
    vertical: string | null;
    tier: string | null;
    status: string | null;
    prospect_score: number;
    updated_at: string | null;
  }>;
  recent_runs: BiRun[];
  recent_source_runs: BiSourceRun[];
  source_summary_24h?: Array<{
    source: string;
    runs: number;
    ok: number;
    failed: number;
    collected: number;
    saved: number;
  }>;
};

export type BiSourceConfig = {
  path: string;
  values: Record<string, string>;
  allowed_keys: string[];
};

export type BiSourceConfigUpdateResponse = {
  ok: boolean;
  changed: number;
  path: string;
  values: Record<string, string>;
};

export type BiOverview = {
  ingestion_status: 'healthy' | 'degraded' | 'down';
  last_successful_source_run: string | null;
  freshness: {
    median_age_minutes: number | null;
    p95_age_minutes: number | null;
    companies_refreshed_1h: number;
  };
  events_1h: {
    collected: number;
    saved: number;
    deduped: number;
    normalized: number;
  };
  error_rate_24h: number;
  top_failing_source_24h: string | null;
};

export type BiSourceSummary = {
  source: string;
  runs_24h: number;
  ok_24h: number;
  failed_24h: number;
  collected_24h: number;
  saved_24h: number;
  last_run_at: string | null;
  last_success_at: string | null;
  status: 'ok' | 'degraded' | 'failed' | 'idle';
  success_rate_24h: number;
};

export type BiSourcesResponse = {
  sources: BiSourceSummary[];
  salesnav_daily_requests_used: number;
  salesnav_daily_requests_max: number;
  collector_interval_minutes: number;
  source_state: Record<string, unknown>;
  config_path: string;
};

export type BiCoverageCompany = {
  id: number;
  name: string;
  domain: string | null;
  vertical: string | null;
  tier: string | null;
  status: string | null;
  updated_at: string | null;
  score_updated_at: string | null;
  prospect_score: number;
  signal_score: number;
  coverage: Record<string, boolean>;
  last_collected_at: string | null;
  last_normalized_at: string | null;
  signal_count: number;
  failing_sources_count: number;
};

export type BiCompanyDetail = {
  company: Record<string, unknown>;
  signals: Array<Record<string, unknown>>;
  collection_logs: BiSourceRun[];
};

export type BiErrorRow = {
  source: string;
  error_type: string;
  count: number;
  last_occurrence: string | null;
  example_message: string;
  http_status?: number | null;
};

// ── Browser Skills ──────────────────────────────────────────

export type BrowserSkillHint = {
  action: string;
  role?: string;
  text: string;
};

export type BrowserSkillSummary = {
  skill_id: string;
  name: string;
  description: string;
  domains: string[];
  tasks: string[];
  tags: string[];
  version: number;
  action_hint_count: number;
  repair_log_count: number;
  updated_at: string;
  path: string;
  match_score?: number;
};

export type BrowserSkill = BrowserSkillSummary & {
  content: string;
  action_hints: BrowserSkillHint[];
};

export type BrowserTab = {
  id: string;
  index?: number;
  url?: string;
  title?: string;
  active?: boolean;
  mode?: string;
};

export type BrowserTabsResponse = {
  tabs: BrowserTab[];
  active_tab_id?: string | null;
  mode?: string;
};

export type BrowserWorkflowTask = {
  id?: string;
  task_id: string;
  status: 'pending' | 'running' | 'finished' | 'failed' | string;
  progress_pct: number;
  stage: string;
  diagnostics?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: { code?: string; message?: string } | null;
  created_at?: number;
  updated_at?: number;
  started_at?: number | null;
  finished_at?: number | null;
  heartbeat_at?: number | null;
  heartbeat_seq?: number;
  heartbeat_age_ms?: number | null;
};

export type BrowserWorkflowTasksResponse = {
  ok: boolean;
  count: number;
  tasks: BrowserWorkflowTask[];
};

export type CompoundWorkflowSummary = {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | string;
  name?: string | null;
  description?: string | null;
  original_query?: string | null;
  current_phase_id?: string | null;
  total_phases: number;
  completed_phases: number;
  browser_calls_used: number;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  heartbeat_at?: string | null;
  heartbeat_seq?: number;
  heartbeat_age_ms?: number | null;
  error?: Record<string, unknown> | null;
};

export type CompoundWorkflowListResponse = {
  ok: boolean;
  count: number;
  workflows: CompoundWorkflowSummary[];
};

export type BrowserScreenshotResponse = {
  ok?: boolean;
  tab_id?: string;
  image?: string;
  base64?: string;
  mime?: string;
  [key: string]: unknown;
};
