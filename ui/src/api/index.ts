/**
 * API layer — barrel export.
 *
 * Structure:
 *   api/client.ts   — shared fetchJson + API_BASE
 *   api/types.ts    — all response / request types
 *   api/emailApi.ts — provider-agnostic email service (EmailProvider interface)
 *   api/index.ts    — this file: assembles `api` object + re-exports types
 *
 * Usage:
 *   import { api } from '../api';           // the api object
 *   import type { Contact } from '../api';  // types
 */

import { fetchJson, API_BASE } from './client';
import { emailApi } from './emailApi';
import type {
  AdminLogRow,
  AdminCostsRange,
  AdminCostsResponse,
  BiCompany,
  BiCompanyDetail,
  BiCoverageCompany,
  BiErrorRow,
  BiOverview,
  BiRun,
  BiSourceConfig,
  BiSourceConfigUpdateResponse,
  BiSourceRun,
  BiSourcesResponse,
  BiStatus,
  BrowserSkill,
  BrowserSkillSummary,
  BrowserScreenshotResponse,
  BrowserTabsResponse,
  BrowserWorkflowTasksResponse,
  CompoundWorkflowListResponse,
  CompoundWorkflowSummary,
  ChatTracePayload,
  Company,
  CompanyBiProfile,
  Contact,
  ConversationThread,
  CreateContactInput,
  EmailDashboardMetrics,
  GeneratedEmail,
  GetAdminLogsParams,
  OutlookAuthStatus,
  PipelineStatus,
  ReplyPreview,
  SalesforceAuthStatus,
  ScheduledEmailPreview,
  Stats,
} from './types';

// Re-export all types so consumers can `import type { Foo } from '../api'`.
export * from './types';

// Re-export the email provider interface + swap function.
export { emailApi, setEmailProvider, getEmailProvider } from './emailApi';
export type { EmailProvider } from './emailApi';

// ─────────────────────────────────────────────────────────────
// api object — grouped by domain
// ─────────────────────────────────────────────────────────────

export const api = {
  // ── Admin ─────────────────────────────────────────────────
  admin: {
    getLogs: (params: GetAdminLogsParams = {}) => {
      const sp = new URLSearchParams();
      if (params.q) sp.set('q', params.q);
      if (params.level) sp.set('level', params.level);
      if (params.feature) sp.set('feature', params.feature);
      if (params.source) sp.set('source', params.source);
      if (params.time_range) sp.set('time_range', params.time_range);
      if (params.correlation_id) sp.set('correlation_id', params.correlation_id);
      if (params.limit != null) sp.set('limit', String(params.limit));
      return fetchJson<AdminLogRow[]>(`/admin/logs${sp.toString() ? `?${sp.toString()}` : ''}`);
    },

    getCosts: (range: AdminCostsRange = 'today') =>
      fetchJson<AdminCostsResponse>(`/admin/costs?range=${range}`),
  },

  // ── Chat ──────────────────────────────────────────────────
  chat: {
    trace: (payload: ChatTracePayload) =>
      fetchJson<{ ok: boolean }>('/chat/trace', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  // ── Stats ─────────────────────────────────────────────────
  getStats: () => fetchJson<Stats>('/stats'),

  // ── BI ────────────────────────────────────────────────────
  getBiStatus: () => fetchJson<BiStatus>('/bi/status'),
  getBiOverview: () => fetchJson<BiOverview>('/bi/overview'),
  getBiSources: () => fetchJson<BiSourcesResponse>('/bi/sources'),
  getBiRuns: (params?: { limit?: number; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.limit != null) sp.set('limit', String(params.limit));
    if (params?.status) sp.set('status', params.status);
    return fetchJson<{ results: BiRun[]; count: number }>(`/bi/runs${sp.toString() ? `?${sp.toString()}` : ''}`);
  },
  getBiRunDetail: (runId: number) =>
    fetchJson<{ run: BiRun; source_breakdown: Array<Record<string, unknown>>; errors: Array<Record<string, unknown>> }>(`/bi/run/${runId}`),
  getBiCompaniesCoverage: (params?: { q?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.limit != null) sp.set('limit', String(params.limit));
    return fetchJson<{ results: BiCoverageCompany[]; count: number }>(`/bi/companies${sp.toString() ? `?${sp.toString()}` : ''}`);
  },
  getBiCompanyDetail: (companyId: number) => fetchJson<BiCompanyDetail>(`/bi/companies/${companyId}`),
  getBiEvents: (params?: { source?: string; ok?: boolean; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.source) sp.set('source', params.source);
    if (params?.ok != null) sp.set('ok', String(params.ok));
    if (params?.limit != null) sp.set('limit', String(params.limit));
    return fetchJson<{ results: BiSourceRun[]; count: number }>(`/bi/events${sp.toString() ? `?${sp.toString()}` : ''}`);
  },
  getBiErrors: (params?: { hours?: number }) => {
    const sp = new URLSearchParams();
    if (params?.hours != null) sp.set('hours', String(params.hours));
    return fetchJson<{ results: BiErrorRow[]; count: number }>(`/bi/errors${sp.toString() ? `?${sp.toString()}` : ''}`);
  },
  getBiSourceConfig: () => fetchJson<BiSourceConfig>('/bi/source-config'),
  updateBiSourceConfig: (values: Record<string, string>) =>
    fetchJson<BiSourceConfigUpdateResponse>('/bi/source-config', {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }),
  getBiTopProspects: (params?: { limit?: number; vertical?: string; min_score?: number }) => {
    const sp = new URLSearchParams();
    if (params?.limit != null) sp.set('limit', String(params.limit));
    if (params?.vertical) sp.set('vertical', params.vertical);
    if (params?.min_score != null) sp.set('min_score', String(params.min_score));
    return fetchJson<{ results: BiCompany[]; count: number }>(`/bi/top-prospects${sp.toString() ? `?${sp.toString()}` : ''}`);
  },

  // ── Browser Skills ────────────────────────────────────────
  listBrowserSkills: (params?: { url?: string; task?: string; query?: string }) => {
    const sp = new URLSearchParams();
    if (params?.url) sp.set('url', params.url);
    if (params?.task) sp.set('task', params.task);
    if (params?.query) sp.set('query', params.query);
    return fetchJson<{ skills: BrowserSkillSummary[]; best_match: BrowserSkillSummary | null }>(`/browser/skills${sp.toString() ? `?${sp.toString()}` : ''}`);
  },
  matchBrowserSkill: (params: { url?: string; task?: string; query?: string }) =>
    fetchJson<{ match: BrowserSkillSummary | null }>('/browser/skills/match', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  getBrowserSkill: (skillId: string) => fetchJson<BrowserSkill>(`/browser/skills/${skillId}`),
  upsertBrowserSkill: (skillId: string, content: string) =>
    fetchJson<{ ok: boolean; skill: BrowserSkill }>(`/browser/skills/${skillId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  deleteBrowserSkill: (skillId: string) =>
    fetchJson<{ ok: boolean }>(`/browser/skills/${skillId}`, { method: 'DELETE' }),
  repairBrowserSkill: (
    skillId: string,
    payload: {
      issue: string;
      context?: Record<string, unknown>;
      action?: string;
      role?: string;
      text?: string;
    }
  ) =>
    fetchJson<{ ok: boolean; skill: BrowserSkill }>(`/browser/skills/${skillId}/repair`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getBrowserTabs: () => fetchJson<BrowserTabsResponse>('/browser/tabs'),
  getBrowserScreenshot: (tabId?: string) =>
    fetchJson<BrowserScreenshotResponse>('/browser/screenshot', {
      method: 'POST',
      body: JSON.stringify(tabId ? { tab_id: tabId, full_page: false } : { full_page: false }),
    }),
  getBrowserWorkflowTasks: (params?: { includeFinished?: boolean; limit?: number }) => {
    const sp = new URLSearchParams();
    if (typeof params?.includeFinished === 'boolean') sp.set('include_finished', String(params.includeFinished));
    if (typeof params?.limit === 'number') sp.set('limit', String(params.limit));
    return fetchJson<BrowserWorkflowTasksResponse>(`/browser/workflows/tasks${sp.toString() ? `?${sp.toString()}` : ''}`);
  },
  getBrowserWorkflowStatus: (taskId: string) =>
    fetchJson<Record<string, unknown>>(`/browser/workflows/status/${encodeURIComponent(taskId)}`),
  getCompoundWorkflows: (params?: { status?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (typeof params?.limit === 'number') sp.set('limit', String(params.limit));
    return fetchJson<CompoundWorkflowListResponse>(`/compound_workflow${sp.toString() ? `?${sp.toString()}` : ''}`);
  },
  getCompoundWorkflowStatus: (workflowId: string) =>
    fetchJson<{ ok: boolean } & CompoundWorkflowSummary>(`/compound_workflow/${encodeURIComponent(workflowId)}/status`),

  // ── Companies ─────────────────────────────────────────────
  getCompanies: (tier?: string) =>
    fetchJson<Company[]>(`/companies${tier ? `?tier=${tier}` : ''}`),

  getCompanyBiProfile: (companyId: number) =>
    fetchJson<CompanyBiProfile>(`/companies/${companyId}/bi-profile`),

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
      body: JSON.stringify(companyIds),
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

  // ── Contacts ──────────────────────────────────────────────
  getContacts: (params?: { company?: string; name?: string; has_email?: boolean; today_only?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.company) sp.set('company', params.company);
    if (params?.name) sp.set('name', params.name);
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
      body: JSON.stringify({ contact_ids: contactIds }),
    }),

  sendEmailsToContacts: (contactIds: number[], campaignId?: number) =>
    fetchJson<{ success: boolean; sent?: number; processed?: number; total?: number; message?: string }>(
      '/contacts/bulk-actions/send-email',
      {
        method: 'POST',
        body: JSON.stringify({ contact_ids: contactIds, campaign_id: campaignId }),
      }
    ),

  // ── Pipeline ──────────────────────────────────────────────
  getPipelineStatus: () => fetchJson<PipelineStatus>('/pipeline/status'),

  startPipeline: (tier?: string, maxContacts = 25) =>
    fetchJson<{ started: boolean }>(`/pipeline/start?max_contacts=${maxContacts}${tier ? `&tier=${tier}` : ''}`, { method: 'POST' }),

  stopPipeline: () =>
    fetchJson<{ stopped: boolean }>('/pipeline/stop', { method: 'POST' }),

  runEmailDiscovery: () =>
    fetchJson<{ started: boolean }>('/pipeline/emails', { method: 'POST' }),

  runPhoneDiscovery: (workers = 10, todayOnly = false) =>
    fetchJson<{ started: boolean }>(`/pipeline/phones?workers=${workers}&today_only=${todayOnly}`, { method: 'POST' }),

  // ── Email campaigns (delegates to emailApi provider) ──────
  getEmailCampaigns: (status?: string) => emailApi.getCampaigns(status),
  getEmailCampaign: (id: number) => emailApi.getCampaign(id),
  enrollInCampaign: (campaignId: number, contactIds: number[]) => emailApi.enrollContacts(campaignId, contactIds),
  getCampaignContacts: (campaignId: number) => emailApi.getCampaignContacts(campaignId),

  getEmailDashboardMetrics: () =>
    fetchJson<EmailDashboardMetrics>('/emails/dashboard-metrics'),

  // ── Outlook / Microsoft Graph ─────────────────────────────
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

  // ── Chat workflow helpers ─────────────────────────────────
  searchContacts: async (params: { name: string; company?: string }) => {
    const contacts = await api.getContacts({ company: params.company });
    const q = params.name.toLowerCase().trim();
    return contacts.filter((contact) => contact.name.toLowerCase().includes(q));
  },

  // ── Sales Navigator ───────────────────────────────────────
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
  }) =>
    fetchJson<{
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
      filters_applied?: Record<string, unknown>;
      error?: string;
      query: string;
      saved_count?: number;
    }>('/salesnav/search-companies', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  salesnavScrapeLeads: async (params: {
    companies: Array<{ name: string; domain?: string; linkedin_url?: string }>;
    title_filter?: string;
    max_per_company?: number;
  }) =>
    fetchJson<{
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
    }),

  // ── Contact aliases (workflow compat) ─────────────────────
  createContact: async (params: CreateContactInput): Promise<Contact> => {
    return api.addContact(params);
  },

  syncToSalesforce: (contactId: number) =>
    fetchJson<{ success: boolean; message?: string }>(`/contacts/${contactId}/salesforce-sync`, { method: 'POST' }),

  /** @deprecated Use `getEmailCampaigns` directly. */
  getCampaigns: async () => emailApi.getCampaigns(),

  /** @deprecated Use `enrollInCampaign` directly. */
  registerToCampaign: async (campaignId: number, contactId: number) =>
    emailApi.enrollContacts(campaignId, [contactId]),

  generateEmail: (contactId: number, campaignId: number): Promise<GeneratedEmail> =>
    fetchJson<GeneratedEmail>('/emails/generate', {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, campaign_id: campaignId }),
    }),

  approveEmail: async (emailId: number): Promise<{ success: boolean }> => {
    await emailApi.approveEmail(emailId);
    return { success: true };
  },

  discardEmail: async (emailId: number): Promise<{ success: boolean }> => {
    await emailApi.rejectEmail(emailId);
    return { success: true };
  },

  // ── Salesforce credentials ────────────────────────────────
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

  // ── Workflow endpoints ────────────────────────────────────
  workflows: {
    resolveContact: (params: { name: string; company?: string }) =>
      fetchJson<{
        found_in_db: Array<Record<string, unknown>>;
        found_in_salesnav: Array<Record<string, unknown>>;
        best_match: Record<string, unknown> | null;
      }>('/workflows/resolve-contact', {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    enrollAndDraft: (params: {
      campaign_id: number;
      contact_id?: number;
      create_if_missing?: Record<string, unknown>;
    }) =>
      fetchJson<{
        contact_id: number | null;
        enrolled: boolean;
        already_enrolled: boolean;
        email_draft: { subject?: string; body?: string; contact_name?: string; company_name?: string; error?: string } | null;
        error?: string;
      }>('/workflows/enroll-and-draft', {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    prospect: (params: {
      query: string;
      industry?: string;
      location?: string;
      max_companies?: number;
      save_to_db?: boolean;
    }) =>
      fetchJson<{
        companies: Array<Record<string, unknown>>;
        saved_count: number;
        existing_count: number;
        existing_companies: Record<string, unknown>;
        query: string;
        error?: string;
      }>('/workflows/prospect', {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    scrapeLeadsBatch: (params: {
      company_names: string[];
      title_filter?: string;
      max_per_company?: number;
    }) =>
      fetchJson<{
        leads: Array<Record<string, unknown>>;
        saved_count: number;
        companies_processed: number;
        errors?: Array<Record<string, unknown>>;
      }>('/workflows/scrape-leads-batch', {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    lookupAndResearch: (params: {
      company_names: string[];
      icp_context?: { industry?: string; location?: string };
    }) =>
      fetchJson<{
        companies: Array<{
          name: string;
          existing: Record<string, unknown> | null;
          research: {
            website_summary?: string;
            recent_news?: string[];
            services_relevance?: string;
            icp_fit_score?: number;
            icp_fit_reasoning?: string;
            talking_points?: string[];
            sources?: Array<{ title: string; url: string; snippet?: string }>;
            error?: string;
          };
        }>;
      }>('/workflows/lookup-and-research', {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    vetBatch: (params: {
      decisions: Array<{
        company_name: string;
        company_id?: number;
        approved: boolean;
        icp_score?: number;
      }>;
    }) =>
      fetchJson<{ vetted: number; skipped: number }>('/workflows/vet-batch', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  },
};
