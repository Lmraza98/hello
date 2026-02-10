/* ── Message Types ── */

export type ChatMessage =
  | TextMessage
  | ActionButtonsMessage
  | StatusMessage
  | SalesforceUrlPromptMessage
  | ContactCardMessage
  | EmailPreviewMessage
  | CampaignListMessage
  | ConversationCardMessage
  | EmbeddedComponentMessage
  | CompanyListMessage
  | CompanyVetCardMessage
  | BackgroundTaskMessage;

interface BaseMessage {
  id: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

export interface TextMessage extends BaseMessage {
  type: 'text';
  content: string;
}

export interface ActionButtonsMessage extends BaseMessage {
  type: 'action_buttons';
  content: string;
  buttons: ActionButton[];
  sender: 'bot';
}

export interface ActionButton {
  label: string;
  value: string;
  variant: 'primary' | 'secondary' | 'danger';
}

export interface StatusMessage extends BaseMessage {
  type: 'status';
  content: string;
  status: 'loading' | 'success' | 'error' | 'info';
  sender: 'bot';
}

export interface SalesforceUrlPromptMessage extends BaseMessage {
  type: 'sf_url_prompt';
  sender: 'bot';
  contact: {
    id: number;
    name: string;
  };
}

export interface ContactCardMessage extends BaseMessage {
  type: 'contact_card';
  contact: {
    id?: number;
    name: string;
    title?: string;
    company: string;
    email?: string;
    linkedin_url?: string;
    location?: string;
    source?: string;
    salesforce_url?: string;
  };
  actions?: ContactAction[];
  sender: 'bot';
}

export type ContactAction =
  | 'add_to_campaign'
  | 'send_email'
  | 'view_in_salesforce'
  | 'edit_contact'
  | 'search_salesnav'
  | 'add_to_database'
  | 'sync_salesforce';

export interface EmailPreviewMessage extends BaseMessage {
  type: 'email_preview';
  email: {
    id: number;
    to: string;
    subject: string;
    body: string;
    campaign_name?: string;
    scheduled_time?: string;
  };
  actions: ('approve' | 'edit' | 'discard')[];
  sender: 'bot';
}

export interface CampaignListMessage extends BaseMessage {
  type: 'campaign_list';
  campaigns: {
    id: number;
    name: string;
    status: string;
    contact_count: number;
    reply_rate?: number;
  }[];
  prompt?: string;
  selectable?: boolean;
  sender: 'bot';
}

export interface ConversationCardMessage extends BaseMessage {
  type: 'conversation_card';
  conversation: {
    reply_id: number;
    contact_name: string;
    company_name: string;
    snippet: string;
    received_at: string;
    sentiment?: string;
  };
  actions: ('view' | 'mark_done')[];
  sender: 'bot';
}

export interface CompanyListMessage extends BaseMessage {
  type: 'company_list';
  companies: {
    company_name: string;
    industry?: string;
    employee_count?: string;
    linkedin_url?: string;
    location?: string;
  }[];
  prompt?: string;
  selectable?: boolean;
  sender: 'bot';
}

export type EmbeddedComponentType =
  | 'overview'
  | 'active_conversations'
  | 'scheduled_sends'
  | 'email_performance'
  | 'todays_contacts'
  | 'background_tasks';

export interface EmbeddedComponentMessage extends BaseMessage {
  type: 'embedded_component';
  componentType: EmbeddedComponentType;
  sender: 'bot';
  props: Record<string, any>;
}

/* ── Company Vet Card ── */

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface CompanyVetCardMessage extends BaseMessage {
  type: 'company_vet_card';
  sender: 'bot';
  company: {
    name: string;
    industry: string;
    headcount: string;
    hq_location?: string;
    website?: string;
    linkedin_url?: string;
    description?: string;
  };
  research?: {
    website_summary?: string;
    recent_news?: string[];
    services_relevance?: string;
    icp_fit_score?: number;
    icp_fit_reasoning?: string;
    linkedin_activity?: string;
    talking_points?: string[];
    sources?: ResearchSource[];
  };
  /** Info about existing DB record — shown when company already collected */
  existing?: {
    id: number;
    contact_count: number;
    vetted_at?: string;     // ISO date of last vetting
    status?: string;
  };
  position: {
    current: number;
    total: number;
    approved_so_far: number;
  };
  actions: ('approve' | 'skip' | 'more_info' | 'skip_rest' | 're_vet')[];
}

/* ── Background Task Message ── */

export interface BackgroundTaskMessage extends BaseMessage {
  type: 'background_task';
  sender: 'bot';
  task: BackgroundTask;
}

/* ── Background Tasks ── */

export interface BackgroundTask {
  id: string;
  type: 'lead_scraping' | 'company_search' | 'email_generation' | 'research';
  label: string;
  status: 'running' | 'completed' | 'failed';
  progress?: { current: number; total: number };
  details?: string[];
  startedAt: Date;
  completedAt?: Date;
}

/* ── Alert System ── */

export interface AlertState {
  conversations: { count: number; isNew: boolean };
  scheduled: { count: number; isNew: boolean };
  contacts: { count: number; isNew: boolean };
  companies: { count: number; isNew: boolean };
  performance: { hasUpdate: boolean };
  overview: { hasUpdate: boolean };
}

/* ── Dashboard Data Bridge ── */

export interface DashboardDataBridge {
  // Overview
  stats: { total_companies: number; total_contacts: number } | null;
  replyRate: number;
  meetingRate: number;
  activeConversations: number;

  // Conversations
  recentReplies: any[];
  outlookConnected: boolean;
  pollReplies: () => void;
  pollRepliesLoading: boolean;
  disconnectOutlook: () => void;
  onSelectConversation: (reply: any) => void;
  onMarkDone: (replyId: number) => void;
  removingIds: number[];

  // Scheduled
  nextSends: any[];
  totalScheduled: number;

  // Email Performance
  daily: any[];

  // Contacts
  todaysContacts: any[];
  onExportContacts: () => void;
  onClearContacts: () => void;

  // Outlook auth
  outlookAuthFlow: { verification_uri: string; user_code: string } | null;
  connectOutlook: () => void;
  connectOutlookLoading: boolean;
  cancelOutlookAuth: () => void;
}

/* ── Intent Types ── */

export interface ParsedIntent {
  intent: IntentType;
  entities: Record<string, any>;
  confidence: number;
  raw: string;
}

export type IntentType =
  | 'contact_lookup'
  | 'contact_create'
  | 'contact_outreach'
  | 'campaign_list'
  | 'campaign_create'
  | 'campaign_register'
  | 'email_approve'
  | 'email_list_pending'
  | 'status_check'
  | 'conversation_list'
  | 'conversation_mark_done'
  | 'lead_generation'
  | 'company_research'
  | 'check_job'
  | 'help'
  | 'unknown';

/* ── Workflow Types ── */

export interface Workflow {
  id: string;
  intent: IntentType;
  steps: WorkflowStep[];
  currentStepIndex: number;
  context: Record<string, any>;
  status: 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'api_call' | 'user_prompt' | 'decision' | 'format';
  execute: (
    context: Record<string, any>,
    userInput?: string
  ) => Promise<StepResult>;
}

export interface StepResult {
  success: boolean;
  data?: Record<string, any>;
  messages: ChatMessage[];
  nextStepIndex?: number;
  waitForUser?: boolean;
  expandSection?: string;
  openBrowserViewer?: boolean;
  closeBrowserViewer?: boolean;
  done?: boolean;
}
