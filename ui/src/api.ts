const API_BASE = '/api';

export type Stats = {
  total_companies: number;
  total_contacts: number;
  contacts_with_email: number;
  contacts_today: number;
}

export type Company = {
  id: number;
  company_name: string;
  domain: string | null;
  tier: string | null;
  vertical: string | null;
  target_reason: string | null;
  wedge: string | null;
  status: string | null;
}

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
  phone_links: string[] | null;
  linkedin_url: string | null;
  salesforce_url: string | null;
  salesforce_status: string | null;
  salesforce_uploaded_at: string | null;
  salesforce_upload_batch: string | null;
  scraped_at: string | null;
  vertical: string | null;
}

// Minimal input type for chat-driven contact creation.
// Backend currently tolerates extra fields, but we keep this explicit for TS.
export type CreateContactInput = Partial<Contact> & {
  location?: string;
  first_name?: string;
  last_name?: string;
};

export type PipelineStatus = {
  running: boolean;
  output: { time: string; text: string }[];
  started_at: string | null;
}

export type EmailCampaign = {
  id: number;
  name: string;
  description: string | null;
  num_emails: number;
  days_between_emails: number;
  status: string;
  created_at: string;
}

export type EmailCampaignStats = {
  total_contacts: number;
  active: number;
  completed: number;
  total_sent: number;
  failed: number;
}

export type EmailDailyStat = {
  date: string;
  sent: number;
  viewed: number;
  responded: number;
}

export type BestCampaignMetric = {
  campaign_id: number;
  campaign_name: string;
  segment_type: 'vertical' | 'title';
  segment_value: string;
  reply_rate: number;
  total_sent: number;
  total_replied: number;
}

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
}

export type OutlookAuthStatus = {
  authenticated: boolean;
  account: string | null;
  client_id?: string;
  tenant_id?: string;
  has_active_flow?: boolean;
  error?: string;
}

export type SalesforceAuthStatus = {
  status: 'authenticated' | 'expired' | 'not_configured';
  username: string | null;
  message: string;
}

export type EmailDashboardMetrics = {
  reply_rate: number;
  meeting_booking_rate: number;
  active_conversations: number;
  best_campaign: BestCampaignMetric | null;
  daily: EmailDailyStat[];
  recent_replies: ReplyPreview[];
  outlook_connected: boolean;
}

export type ThreadMessage = {
  msg_type: 'sent' | 'reply';
  id: number;
  subject: string | null;
  body: string | null;
  timestamp: string | null;
  campaign_name: string;
  step_number: number;
}

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
}

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
}

export type GeneratedEmail = {
  id: number;
  subject?: string | null;
  rendered_subject?: string | null;
  body?: string | null;
  rendered_body?: string | null;
  scheduled_send_time?: string | null;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getStats: () => fetchJson<Stats>('/stats'),
  
  getCompanies: (tier?: string) => 
    fetchJson<Company[]>(`/companies${tier ? `?tier=${tier}` : ''}`),

  lookupExistingCompanies: (companyNames: string[]) =>
    fetchJson<Record<string, {
      id: number;
      company_name: string;
      status: string;
      vetted_at: string | null;
      icp_fit_score: number | null;
      contact_count: number;
    }>>('/companies/lookup-existing', {
      method: 'POST',
      body: JSON.stringify(companyNames),
    }),

  markCompanyVetted: (companyId: number, icpScore?: number) =>
    fetchJson<{ success: boolean }>(
      `/companies/${companyId}/mark-vetted${icpScore != null ? `?icp_score=${icpScore}` : ''}`,
      { method: 'POST' }
    ),
  
  addCompany: (company: Partial<Company>) =>
    fetchJson<Company>('/companies', { method: 'POST', body: JSON.stringify(company) }),
  
  updateCompany: (company: Company) =>
    fetchJson<Company>(`/companies/${company.id}`, { method: 'PUT', body: JSON.stringify(company) }),
  
  deleteCompany: (id: number) =>
    fetchJson<{ deleted: boolean }>(`/companies/${id}`, { method: 'DELETE' }),
  
  bulkDeleteCompanies: (companyIds: number[]) =>
    fetchJson<{ success: boolean; deleted: number; message: string }>('/companies/bulk-delete', {
      method: 'POST',
      body: JSON.stringify(companyIds)
    }),
  
  resetCompanies: () =>
    fetchJson<{ reset: boolean }>('/companies/reset', { method: 'POST' }),
  
  skipPendingCompanies: () =>
    fetchJson<{ skipped: number }>('/companies/skip-pending', { method: 'POST' }),
  
  clearPendingCompanies: () =>
    fetchJson<{ deleted: number }>('/companies/pending', { method: 'DELETE' }),
  
  getPendingCount: () =>
    fetchJson<{ pending: number }>('/companies/pending-count'),
  
  importCompanies: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(API_BASE + '/companies/import', { method: 'POST', body: formData });
    return res.json();
  },
  
  getContacts: (params?: { company?: string; has_email?: boolean; today_only?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.company) sp.set('company', params.company);
    if (params?.has_email !== undefined) sp.set('has_email', String(params.has_email));
    if (params?.today_only) sp.set('today_only', 'true');
    return fetchJson<Contact[]>(`/contacts${sp.toString() ? `?${sp}` : ''}`);
  },
  
  exportContacts: (todayOnly = false) => {
    window.open(API_BASE + `/contacts/export?today_only=${todayOnly}`, '_blank');
  },
  
  clearContacts: (todayOnly = false) =>
    fetchJson<{ deleted: number }>(`/contacts?today_only=${todayOnly}`, { method: 'DELETE' }),
  
  addContact: (contact: Partial<Contact>) =>
    fetchJson<Contact>('/contacts', { method: 'POST', body: JSON.stringify(contact) }),

  getContact: (id: number) =>
    fetchJson<Contact>(`/contacts/${id}`),

  saveSalesforceUrl: (id: number, salesforceUrl: string) =>
    fetchJson<{ success: boolean; salesforce_url: string }>(`/contacts/${id}/salesforce-url`, {
      method: 'POST',
      body: JSON.stringify({ salesforce_url: salesforceUrl }),
    }),

  enqueueSalesforceSearch: (id: number) =>
    fetchJson<{ success: boolean; queued: boolean; busy: boolean }>(`/contacts/${id}/salesforce-search`, {
      method: 'POST',
    }),

  skipSalesforce: (id: number) =>
    fetchJson<{ success: boolean }>(`/contacts/${id}/salesforce-skip`, { method: 'POST' }),
  
  deleteContact: (id: number) =>
    fetchJson<{ deleted: boolean }>(`/contacts/${id}`, { method: 'DELETE' }),
  
  bulkDeleteContacts: (contactIds: number[]) =>
    fetchJson<{ success: boolean; deleted: number; message: string }>('/contacts/bulk-actions/delete', {
      method: 'POST',
      body: JSON.stringify({ contact_ids: contactIds })
    }),
  
  getPipelineStatus: () => fetchJson<PipelineStatus>('/pipeline/status'),
  
  startPipeline: (tier?: string, maxContacts = 25) =>
    fetchJson<{ started: boolean }>(`/pipeline/start?max_contacts=${maxContacts}${tier ? `&tier=${tier}` : ''}`, { method: 'POST' }),
  
  stopPipeline: () =>
    fetchJson<{ stopped: boolean }>('/pipeline/stop', { method: 'POST' }),
  
  runEmailDiscovery: () =>
    fetchJson<{ started: boolean }>('/pipeline/emails', { method: 'POST' }),
  
  runPhoneDiscovery: (workers = 10, todayOnly = false) =>
    fetchJson<{ started: boolean }>(`/pipeline/phones?workers=${workers}&today_only=${todayOnly}`, { method: 'POST' }),
  
  // Email campaign endpoints
  getEmailCampaigns: (status?: string) =>
    fetchJson<EmailCampaign[]>(`/emails/campaigns${status ? `?status=${status}` : ''}`),
  
  getEmailCampaign: (id: number) =>
    fetchJson<EmailCampaign & { stats: EmailCampaignStats }>(`/emails/campaigns/${id}`),
  
  enrollInCampaign: (campaignId: number, contactIds: number[]) =>
    fetchJson<{ enrolled: number; skipped: number }>(`/emails/campaigns/${campaignId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ contact_ids: contactIds })
    }),
  
  getCampaignContacts: (campaignId: number) =>
    fetchJson<Array<{ contact_id: number; contact_name: string; email: string; title: string; company_name: string }>>(`/emails/campaigns/${campaignId}/contacts`),

  // Dashboard email metrics
  getEmailDashboardMetrics: () =>
    fetchJson<EmailDashboardMetrics>('/emails/dashboard-metrics'),

  // Outlook / Microsoft Graph
  getOutlookAuthStatus: () =>
    fetchJson<OutlookAuthStatus>('/emails/outlook/auth-status'),
  
  startOutlookAuth: () =>
    fetchJson<{ success: boolean; verification_uri?: string; user_code?: string; message?: string; error?: string; already_authenticated?: boolean }>(
      '/emails/outlook/auth', { method: 'POST' }
    ),
  
  completeOutlookAuth: () =>
    fetchJson<{ success: boolean; pending?: boolean; account?: string; error?: string }>(
      '/emails/outlook/auth-complete', { method: 'POST' }
    ),
  
  outlookLogout: () =>
    fetchJson<{ success: boolean }>('/emails/outlook/logout', { method: 'POST' }),
  
  pollOutlookReplies: (minutesBack = 15) =>
    fetchJson<{ success: boolean; checked: number; new_replies: number; message: string }>(
      `/emails/outlook/poll-replies?minutes_back=${minutesBack}`, { method: 'POST' }
    ),

  getActiveConversations: (days = 30, limit = 50) =>
    fetchJson<ReplyPreview[]>(`/emails/active-conversations?days=${days}&limit=${limit}`),

  markConversationHandled: (replyId: number) =>
    fetchJson<{ success: boolean }>(`/emails/conversations/${replyId}/mark-handled`, { method: 'POST' }),

  getConversationThread: (contactId: number) =>
    fetchJson<ConversationThread>(`/emails/conversations/${contactId}/thread`),

  getScheduledEmailsForDashboard: () =>
    fetchJson<ScheduledEmailPreview[]>('/emails/scheduled-emails?limit=5'),

  // Chat workflow helpers (Phase 2)
  searchContacts: async (params: { name: string; company?: string }) => {
    const contacts = await api.getContacts({
      company: params.company,
    });
    const q = params.name.toLowerCase().trim();
    return contacts.filter((contact) =>
      contact.name.toLowerCase().includes(q)
    );
  },

  salesnavSearch: async (params: {
    first_name: string;
    last_name: string;
    company?: string;
  }) => {
    const result = await fetchJson<{
      success: boolean;
      profiles: Array<{
        name: string;
        title?: string;
        company?: string;
        linkedin_url?: string;
        location?: string;
        source?: string;
      }>;
      searched_query?: string;
      error?: string;
    }>('/salesnav/search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!result.success) {
      throw new Error(result.error || 'Sales Navigator search failed');
    }
    return result;
  },

  salesnavSearchCompanies: async (params: {
    query: string;
    max_companies?: number;
    save_to_db?: boolean;
  }) => {
    return fetchJson<{
      status: string;
      companies: Array<{
        company_name?: string;
        name?: string;
        industry?: string;
        employee_count?: string;
        linkedin_url?: string;
        location?: string;
        domain?: string;
      }>;
      filters_applied?: Record<string, any>;
      error?: string;
      query: string;
      saved_count?: number;
    }>('/salesnav/search-companies', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  salesnavScrapeLeads: async (params: {
    companies: Array<{ name: string; domain?: string; linkedin_url?: string }>;
    title_filter?: string;
    max_per_company?: number;
  }) => {
    return fetchJson<{
      success: boolean;
      leads: Array<{
        name: string;
        title?: string;
        linkedin_url?: string;
        company?: string;
      }>;
      saved_count: number;
      companies_processed?: number;
      errors?: Array<{ company: string; error: string }> | null;
      error?: string;
    }>('/salesnav/scrape-leads', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  createContact: async (params: CreateContactInput): Promise<Contact> => {
    return api.addContact(params);
  },

  syncToSalesforce: async (contactId: number) => {
    void contactId;
    throw new Error('Not implemented');
  },

  getCampaigns: async () => {
    return api.getEmailCampaigns();
  },

  registerToCampaign: async (campaignId: number, contactId: number) => {
    return api.enrollInCampaign(campaignId, [contactId]);
  },

  generateEmail: async (contactId: number, campaignId: number): Promise<GeneratedEmail> => {
    void contactId;
    void campaignId;
    throw new Error('Not implemented');
  },

  approveEmail: async (emailId: number): Promise<{ success: boolean }> => {
    void emailId;
    throw new Error('Not implemented');
  },

  discardEmail: async (emailId: number): Promise<{ success: boolean }> => {
    void emailId;
    throw new Error('Not implemented');
  },

  // Salesforce credential management
  getSalesforceAuthStatus: () =>
    fetchJson<SalesforceAuthStatus>('/salesforce/auth-status'),

  saveSalesforceCredentials: (username: string, password: string) =>
    fetchJson<{ success: boolean; message: string }>('/salesforce/credentials', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  deleteSalesforceCredentials: () =>
    fetchJson<{ success: boolean; message: string }>('/salesforce/credentials', {
      method: 'DELETE',
    }),

  triggerSalesforceReauth: () =>
    fetchJson<{ success: boolean; message: string; in_progress: boolean }>('/salesforce/reauth', {
      method: 'POST',
    }),
};
