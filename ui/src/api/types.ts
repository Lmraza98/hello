/**
 * API response types â€” shared across all domain modules.
 *
 * Email-specific types live in `types/email.ts` and are re-exported
 * from this file for convenience.
 */

// â”€â”€ Re-exports from canonical type files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type { EmailCampaign, CampaignStats as EmailCampaignStats } from '../types/email';

// â”€â”€ Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

export type LauncherStopMode = 'run' | 'after_current' | 'terminate_workers';

export type LauncherStartupIssue = {
  code: string;
  message: string;
  remediation: string;
};

export type LauncherStartupState = {
  phase: string;
  ready: boolean;
  checks: Record<string, unknown>;
  issues: LauncherStartupIssue[];
};

export type LauncherCaseStatus = 'idle' | 'queued' | 'running' | 'passed' | 'failed' | 'canceled' | 'timed_out';

export type LauncherTestCase = {
  id: string;
  suite_id: string;
  suite_name: string;
  name: string;
  kind: 'unit' | 'integration' | 'live' | 'smoke' | 'custom';
  tags: string[];
  enabled: boolean;
  file_path?: string | null;
  marker?: string | null;
};

export type LauncherTestStatus = {
  status: LauncherCaseStatus;
  lastRun?: number | null;
  duration?: number | null;
  attempt?: number | null;
  started_at?: number | null;
  finished_at?: number | null;
  artifact_count?: number;
};

export type LauncherRunPlanItem = {
  order: number;
  id: string;
  name: string;
};

export type LauncherRunRecord = {
  run_id: string;
  status: 'passed' | 'failed' | 'canceled' | 'running' | 'queued' | 'unknown';
  started_at?: string | null;
  finished_at?: string | null;
  duration_sec?: number | null;
  selected_test_ids?: string[];
  selected_tags?: string[];
  tests?: Array<{ id: string; status: string; duration_sec?: number; message?: string }>;
  artifacts?: {
    events?: string;
    stdout?: string;
    junit?: string;
    json?: string;
  };
  run_dir?: string;
};

export type LauncherArtifactResponse = {
  ok: boolean;
  run_id: string;
  kind: 'json' | 'junit' | 'events' | 'stdout';
  path?: string | null;
};

// â”€â”€ Core entities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

export type Contact = {
  id: number;
  company_name: string;
  domain: string | null;
  location: string | null;
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
  salesforce_sync_status: string | null;
  salesforce_uploaded_at: string | null;
  salesforce_upload_batch: string | null;
  engagement_status: string | null;
  lead_source: string | null;
  ingest_batch_id: string | null;
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

// ── LangGraph ──────────────────────────────────────────────

export type LangGraphRunStatus = {
  id: string;
  graph_id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  progress?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};

export type LangGraphRunListResponse = {
  ok: boolean;
  count: number;
  runs: LangGraphRunStatus[];
};

export type LeadResearchRunRequest = {
  prompt: string;
  options?: {
    max_results?: number;
    geo_bias?: string;
    include_sources?: string[];
    exclude_sources?: string[];
  };
};

export type LeadResearchLead = {
  id: number;
  run_id: string;
  name?: string | null;
  company_name?: string | null;
  domain?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  location?: string | null;
  source_type?: string | null;
  rating?: number | null;
  review_count?: number | null;
  score_total?: number | null;
  score_breakdown?: Record<string, unknown>;
  dedupe_key?: string | null;
  created_at?: string | null;
};

export type LeadCreditsSummary = {
  ok?: boolean;
  user_id: string;
  period_ym: string;
  monthly_limit: number;
  used: number;
  remaining: number;
  charged?: number;
};

export type LeadCrmExportResponse = {
  ok: boolean;
  provider: 'hubspot' | 'pipedrive';
  sent: number;
  status_code: number;
};

// â”€â”€ Email / Outlook / Conversations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

export type InboundLeadAlerts = {
  unseen_count: number;
};

export type InboundLeadMarkSeenResponse = {
  success: boolean;
  marked_seen: number;
};

export type OutlookPollStatus = {
  last_polled_at?: string | null;
  success: boolean;
  checked: number;
  new_replies: number;
  new_leads: number;
  message?: string | null;
  error?: string | null;
};

export type InboundLeadEvent = {
  id: number;
  outlook_message_id?: string | null;
  source_sender?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  lead_name?: string | null;
  lead_company?: string | null;
  lead_email?: string | null;
  lead_phone?: string | null;
  lead_title?: string | null;
  lead_industry?: string | null;
  contact_id?: number | null;
  contact_name?: string | null;
  status?: string | null;
  error?: string | null;
  received_at?: string | null;
  detected_at?: string | null;
  seen?: number | null;
  seen_at?: string | null;
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

// â”€â”€ Browser Skills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  fingerprint_count?: number;
  regression_test_count?: number;
  qa_status?: string;
  ready_for_promotion?: boolean;
  last_regression_total?: number;
  last_regression_passes?: number;
  last_regression_failures?: number;
  last_regression_at?: string;
  updated_at: string;
  path: string;
  match_score?: number;
};

export type BrowserSkillRegressionCaseResult = {
  name: string;
  ok: boolean;
  task?: string;
  query?: string;
  extract_type?: string;
  count?: number;
  expectation?: Record<string, unknown>;
  stop_reason?: string;
  item_validation?: Record<string, unknown>;
  error?: { code?: string; message?: string } | Record<string, unknown>;
};

export type BrowserSkillRegressionRunResponse = {
  ok: boolean;
  skill_id: string;
  total: number;
  passes: number;
  failures: number;
  results: BrowserSkillRegressionCaseResult[];
};

export type BrowserSkillPromoteResponse = {
  ok: boolean;
  skill_id: string;
  promoted: boolean;
  dry_run?: boolean;
  gate?: Record<string, unknown>;
  regression?: BrowserSkillRegressionRunResponse;
  skill?: BrowserSkill;
  message?: string;
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

export type CompoundWorkflowEvent = {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

export type CompoundWorkflowStatusResponse = {
  ok: boolean;
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
  events: CompoundWorkflowEvent[];
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

export type BrowserAnnotationBox = {
  box_id: string;
  label?: string;
  href?: string;
  role?: string;
  landmark_role?: string | null;
  container_hint?: string | null;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
};

export type BrowserObservationPackResponse = {
  ok: boolean;
  tab_id?: string | null;
  observation: Record<string, unknown>;
};

export type BrowserValidateCandidateResponse = {
  ok: boolean;
  tab_id?: string | null;
  candidate_validation?: Record<string, unknown>;
  observation_summary?: Record<string, unknown>;
};

export type BrowserAnnotateCandidateResponse = {
  ok: boolean;
  tab_id?: string | null;
  annotation: {
    tab_id?: string | null;
    href_contains?: string[];
    count?: number;
    boxes: BrowserAnnotationBox[];
    screenshot_base64?: string | null;
    has_screenshot?: boolean;
  };
};

export type BrowserSynthesizeFromFeedbackResponse = {
  ok: boolean;
  tab_id?: string | null;
  suggested_href_contains?: string[];
  suggested_candidate?: {
    href_contains?: string[];
    label_contains_any?: string[];
    exclude_label_contains_any?: string[];
    role_allowlist?: string[];
    must_be_within_roles?: string[];
    exclude_within_roles?: string[];
    container_hint_contains?: string[];
    exclude_container_hint_contains?: string[];
  };
  feedback_stats?: Record<string, unknown>;
  candidate_validation?: Record<string, unknown>;
  observation_summary?: Record<string, unknown>;
};

export type DocumentStatus =
  | 'pending'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'analyzing'
  | 'ready'
  | 'failed'
  | string;

export type DocumentEntity = {
  name?: string;
  title?: string;
  company?: string;
  date?: string;
  amount?: string;
  context?: string;
  role_in_document?: string;
  matched_crm_id?: number | null;
  match_confidence?: number | null;
};

export type DocumentRecord = {
  id: string;
  filename: string;
  mime_type: string;
  file_size_bytes?: number | null;
  storage_backend: string;
  storage_path: string;
  folder_path?: string | null;
  status: DocumentStatus;
  status_message?: string | null;
  processed_at?: string | null;
  extracted_text?: string | null;
  text_length?: number | null;
  page_count?: number | null;
  document_type?: string | null;
  document_type_confidence?: number | null;
  summary?: string | null;
  key_points?: string[] | null;
  extracted_entities?: {
    companies?: DocumentEntity[];
    contacts?: DocumentEntity[];
    dates?: DocumentEntity[];
    amounts?: DocumentEntity[];
    action_items?: string[];
  } | null;
  linked_company_id?: number | null;
  linked_company_name?: string | null;
  linked_contact_count?: number | null;
  chunk_count?: number | null;
  link_confirmed?: boolean | null;
  uploaded_by?: string | null;
  uploaded_at?: string | null;
  source?: string | null;
  conversation_id?: string | null;
  notes?: string | null;
};

export type DocumentFolderRecord = {
  path: string;
  parent_path: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DocumentListResponse = {
  count: number;
  documents: DocumentRecord[];
};

export type DocumentDetailsResponse = {
  document: DocumentRecord;
  contacts: Array<{
    contact_id: number;
    name: string;
    mention_type?: string | null;
    confidence?: number | null;
    confirmed?: boolean | null;
    context_snippet?: string | null;
  }>;
  chunk_count: number;
};

export type DocumentAnswerResponse = {
  answer: string;
  confidence: number;
  sources: Array<{
    document_id: string;
    filename: string;
    page?: number | null;
    similarity?: number;
    snippet?: string;
  }>;
};
