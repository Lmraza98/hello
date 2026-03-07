/**
 * Email Service — provider-agnostic interface + default HTTP implementation.
 *
 * The `EmailProvider` interface defines the contract that any email backend
 * must satisfy.  The default export (`emailApi`) is wired to the local API
 * server.  To swap providers (e.g. SendGrid, Mailgun) implement
 * `EmailProvider` and call `setEmailProvider(myProvider)`.
 */

import type {
  EmailCampaign,
  EmailTemplate,
  EmailLibraryTemplate,
  EmailTemplateRevision,
  EmailTemplateBlock,
  CampaignContact,
  SentEmail,
  GlobalStats,
  ReviewQueueItem,
  EmailConfig,
  ScheduledEmail,
  EmailDetail,
  CampaignScheduleSummary,
} from '../types/email';

// ── Provider interface ──────────────────────────────────────

export interface EmailProvider {
  // Campaigns
  getCampaigns(status?: string): Promise<EmailCampaign[]>;
  getCampaign(id: number): Promise<EmailCampaign | null>;
  createCampaign(data: Partial<EmailCampaign>): Promise<EmailCampaign>;
  updateCampaign(id: number, data: Partial<EmailCampaign>): Promise<EmailCampaign>;
  deleteCampaign(id: number): Promise<void>;
  activateCampaign(id: number): Promise<void>;
  pauseCampaign(id: number): Promise<void>;

  // Templates
  getTemplates(campaignId: number): Promise<EmailTemplate[]>;
  saveTemplates(campaignId: number, templates: Partial<EmailTemplate>[]): Promise<void>;
  listTemplateLibrary(query?: string, status?: string): Promise<EmailLibraryTemplate[]>;
  getTemplateLibraryItem(templateId: number): Promise<EmailLibraryTemplate | null>;
  createTemplateLibraryItem(data: Partial<EmailLibraryTemplate>): Promise<EmailLibraryTemplate>;
  updateTemplateLibraryItem(templateId: number, data: Partial<EmailLibraryTemplate>): Promise<EmailLibraryTemplate>;
  duplicateTemplateLibraryItem(templateId: number): Promise<EmailLibraryTemplate>;
  archiveTemplateLibraryItem(templateId: number): Promise<void>;
  renderTemplateLibraryItem(
    templateId: number,
    payload: { contact_id?: number; campaign_id?: number; sample_vars?: Record<string, unknown> }
  ): Promise<{ subject: string; preheader?: string; html: string; text: string; sanitized_html?: string; warnings: string[]; errors: string[] }>;
  validateTemplateContent(payload: { subject: string; html: string; from_email?: string }): Promise<{ warnings: string[]; errors: string[] }>;
  getTemplateRevisions(templateId: number): Promise<EmailTemplateRevision[]>;
  revertTemplateRevision(templateId: number, revisionNumber: number): Promise<EmailLibraryTemplate>;
  testSendTemplate(
    templateId: number,
    payload: { to_email: string; contact_id?: number; campaign_id?: number; sample_vars?: Record<string, unknown> }
  ): Promise<{ success: boolean; mode?: string; message?: string; warnings?: string[]; errors?: string[] }>;
  exportTemplateLibraryItem(templateId: number): Promise<Record<string, unknown>>;
  importTemplateLibraryItem(payload: Record<string, unknown>): Promise<EmailLibraryTemplate>;
  linkCampaignTemplate(campaignId: number, payload: { template_id?: number | null; template_mode: 'linked' | 'copied' }): Promise<EmailCampaign>;
  listTemplateBlocks(status?: string): Promise<EmailTemplateBlock[]>;
  createTemplateBlock(data: Partial<EmailTemplateBlock>): Promise<EmailTemplateBlock>;
  updateTemplateBlock(blockId: number, data: Partial<EmailTemplateBlock>): Promise<EmailTemplateBlock>;
  deleteTemplateBlock(blockId: number): Promise<void>;

  // Contacts & enrollment
  getCampaignContacts(campaignId: number): Promise<CampaignContact[]>;
  enrollContacts(campaignId: number, contactIds: number[]): Promise<{ enrolled: number; skipped: number }>;
  removeCampaignContact(campaignId: number, campaignContactId: number): Promise<{ success: boolean }>;

  // Sending
  sendEmails(campaignId?: number, limit?: number, reviewMode?: boolean): Promise<{ success: boolean; message?: string; error?: string; ready_count?: number }>;

  // Sent / queue
  getSentEmails(campaignId?: number, limit?: number): Promise<SentEmail[]>;
  getQueue(campaignId?: number): Promise<CampaignContact[]>;

  // Stats
  getStats(): Promise<GlobalStats>;

  // Review queue
  getReviewQueue(): Promise<ReviewQueueItem[]>;
  approveEmail(emailId: number, subject?: string, body?: string): Promise<void>;
  rejectEmail(emailId: number): Promise<void>;
  approveAll(emailIds: number[]): Promise<void>;
  prepareBatch(): Promise<{ success: boolean; drafts_created?: number; message?: string; error?: string }>;

  // Tracking
  getTrackingStatus(days?: number): Promise<unknown>;

  // Scheduled
  getScheduled(): Promise<SentEmail[]>;
  getAllScheduledEmails(campaignId?: number): Promise<ScheduledEmail[]>;
  getEmailDetail(emailId: number): Promise<EmailDetail | null>;
  sendEmailNow(emailId: number): Promise<{ success: boolean; message?: string; error?: string; contact_name?: string; company_name?: string }>;
  rescheduleEmail(emailId: number, sendTime: string): Promise<void>;
  reorderEmails(emailIds: number[], startTime?: string): Promise<void>;
  getCampaignScheduleSummary(): Promise<CampaignScheduleSummary[]>;
  processScheduled(reviewMode?: boolean): Promise<{ success: boolean; message?: string; count?: number; processed?: number; error?: string }>;

  // Config
  getConfig(): Promise<EmailConfig | null>;
  updateConfig(data: Partial<EmailConfig>): Promise<void>;

  // Salesforce upload
  uploadToSalesforce(campaignId: number): Promise<{ success: boolean; message?: string; error?: string; exported?: number }>;
}

// ── Helpers ─────────────────────────────────────────────────

async function safeFetch<T>(url: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return fallback;
    const data = await res.json();
    return data as T;
  } catch {
    return fallback;
  }
}

async function strictFetch<T>(url: string, init?: RequestInit, errorMsg?: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).detail || errorMsg || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Default HTTP implementation ─────────────────────────────

function createHttpEmailProvider(baseUrl: string): EmailProvider {
  return {
    getCampaigns: (status) =>
      safeFetch(status ? `${baseUrl}/campaigns?status=${status}` : `${baseUrl}/campaigns`, []),

    getCampaign: (id) =>
      safeFetch(`${baseUrl}/campaigns/${id}`, null),

    createCampaign: (data) =>
      strictFetch(`${baseUrl}/campaigns`, { method: 'POST', body: JSON.stringify(data) }, 'Failed to create campaign'),

    updateCampaign: (id, data) =>
      strictFetch(`${baseUrl}/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }, 'Failed to update campaign'),

    deleteCampaign: async (id) => {
      await strictFetch<void>(`${baseUrl}/campaigns/${id}`, { method: 'DELETE' }, 'Failed to delete campaign');
    },

    activateCampaign: async (id) => {
      await strictFetch<void>(`${baseUrl}/campaigns/${id}/activate`, { method: 'POST' }, 'Failed to activate campaign');
    },

    pauseCampaign: async (id) => {
      await strictFetch<void>(`${baseUrl}/campaigns/${id}/pause`, { method: 'POST' }, 'Failed to pause campaign');
    },

    getTemplates: (campaignId) =>
      safeFetch(`${baseUrl}/campaigns/${campaignId}/templates`, []),

    saveTemplates: async (campaignId, templates) => {
      await strictFetch<void>(`${baseUrl}/campaigns/${campaignId}/templates/bulk`, {
        method: 'POST',
        body: JSON.stringify(templates),
      }, 'Failed to save templates');
    },
    listTemplateLibrary: (query, status) => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (status) params.set('status', status);
      return safeFetch(`${baseUrl}/templates?${params}`, []);
    },
    getTemplateLibraryItem: (templateId) =>
      safeFetch(`${baseUrl}/templates/${templateId}`, null),
    createTemplateLibraryItem: (data) =>
      strictFetch(`${baseUrl}/templates`, { method: 'POST', body: JSON.stringify(data) }, 'Failed to create template'),
    updateTemplateLibraryItem: (templateId, data) =>
      strictFetch(`${baseUrl}/templates/${templateId}`, { method: 'PUT', body: JSON.stringify(data) }, 'Failed to update template'),
    duplicateTemplateLibraryItem: (templateId) =>
      strictFetch(`${baseUrl}/templates/${templateId}/duplicate`, { method: 'POST' }, 'Failed to duplicate template'),
    archiveTemplateLibraryItem: async (templateId) => {
      await strictFetch<void>(`${baseUrl}/templates/${templateId}/archive`, { method: 'POST' }, 'Failed to archive template');
    },
    renderTemplateLibraryItem: (templateId, payload) =>
      strictFetch(`${baseUrl}/templates/${templateId}/render`, { method: 'POST', body: JSON.stringify(payload) }, 'Failed to render template'),
    validateTemplateContent: (payload) =>
      strictFetch(`${baseUrl}/templates/validate`, { method: 'POST', body: JSON.stringify(payload) }, 'Failed to validate template'),
    getTemplateRevisions: (templateId) =>
      safeFetch(`${baseUrl}/templates/${templateId}/revisions`, []),
    revertTemplateRevision: (templateId, revisionNumber) =>
      strictFetch(`${baseUrl}/templates/${templateId}/revert`, { method: 'POST', body: JSON.stringify({ revision_number: revisionNumber }) }, 'Failed to revert template'),
    testSendTemplate: (templateId, payload) =>
      strictFetch(`${baseUrl}/templates/${templateId}/test-send`, { method: 'POST', body: JSON.stringify(payload) }, 'Failed to run test send'),
    exportTemplateLibraryItem: (templateId) =>
      strictFetch(`${baseUrl}/templates/${templateId}/export`, undefined, 'Failed to export template'),
    importTemplateLibraryItem: (payload) =>
      strictFetch(`${baseUrl}/templates/import`, { method: 'POST', body: JSON.stringify(payload) }, 'Failed to import template'),
    linkCampaignTemplate: (campaignId, payload) =>
      strictFetch(`${baseUrl}/campaigns/${campaignId}/template-link`, { method: 'PUT', body: JSON.stringify(payload) }, 'Failed to link template to campaign'),
    listTemplateBlocks: (status) =>
      safeFetch(`${baseUrl}/template-blocks${status ? `?status=${encodeURIComponent(status)}` : ''}`, []),
    createTemplateBlock: (data) =>
      strictFetch(`${baseUrl}/template-blocks`, { method: 'POST', body: JSON.stringify(data) }, 'Failed to create template block'),
    updateTemplateBlock: (blockId, data) =>
      strictFetch(`${baseUrl}/template-blocks/${blockId}`, { method: 'PUT', body: JSON.stringify(data) }, 'Failed to update template block'),
    deleteTemplateBlock: async (blockId) => {
      await strictFetch<void>(`${baseUrl}/template-blocks/${blockId}`, { method: 'DELETE' }, 'Failed to delete template block');
    },

    getCampaignContacts: (campaignId) =>
      safeFetch(`${baseUrl}/campaigns/${campaignId}/contacts`, []),

    enrollContacts: (campaignId, contactIds) =>
      strictFetch(`${baseUrl}/campaigns/${campaignId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ contact_ids: contactIds }),
      }, 'Failed to enroll contacts'),
    removeCampaignContact: (campaignId, campaignContactId) =>
      strictFetch(`${baseUrl}/campaigns/${campaignId}/contacts/${campaignContactId}`, {
        method: 'DELETE',
      }, 'Failed to remove contact from campaign'),

    sendEmails: (campaignId, limit, reviewMode = true) =>
      safeFetch(`${baseUrl}/send`, { success: false, error: 'Request failed' }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, limit, review_mode: reviewMode }),
      }),

    getSentEmails: (campaignId, limit) => {
      const params = new URLSearchParams();
      if (campaignId) params.set('campaign_id', String(campaignId));
      if (limit) params.set('limit', String(limit));
      return safeFetch(`${baseUrl}/sent?${params}`, []);
    },

    getStats: () =>
      safeFetch(`${baseUrl}/stats`, { total_campaigns: 0, active_campaigns: 0, total_contacts_enrolled: 0, total_sent: 0, sent_today: 0 }),

    getQueue: (campaignId) =>
      safeFetch(`${baseUrl}/queue${campaignId ? `?campaign_id=${campaignId}` : ''}`, []),

    uploadToSalesforce: (campaignId) =>
      safeFetch(`${baseUrl}/campaigns/${campaignId}/salesforce-upload`, { success: false, error: 'Request failed' }, { method: 'POST' }),

    getReviewQueue: () =>
      safeFetch(`${baseUrl}/review-queue`, []),

    approveEmail: async (emailId, subject, body) => {
      await strictFetch<void>(`${baseUrl}/review-queue/${emailId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ subject, body }),
      }, 'Failed to approve email');
    },

    rejectEmail: async (emailId) => {
      await strictFetch<void>(`${baseUrl}/review-queue/${emailId}/reject`, { method: 'POST' }, 'Failed to reject email');
    },

    approveAll: async (emailIds) => {
      await strictFetch<void>(`${baseUrl}/review-queue/approve-all`, {
        method: 'POST',
        body: JSON.stringify({ email_ids: emailIds }),
      }, 'Failed to bulk approve');
    },

    prepareBatch: () =>
      safeFetch(`${baseUrl}/prepare-batch`, { success: false, error: 'Request failed' }, { method: 'POST' }),

    getTrackingStatus: (days = 7) =>
      safeFetch(`${baseUrl}/tracking-status?days=${days}`, null),

    getScheduled: () =>
      safeFetch(`${baseUrl}/scheduled`, []),

    getConfig: () =>
      safeFetch(`${baseUrl}/config`, null),

    updateConfig: async (data) => {
      await strictFetch<void>(`${baseUrl}/config`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }, 'Failed to update config');
    },

    getAllScheduledEmails: (campaignId) =>
      safeFetch(`${baseUrl}/scheduled-emails${campaignId ? `?campaign_id=${campaignId}` : ''}`, []),

    getEmailDetail: (emailId) =>
      safeFetch(`${baseUrl}/scheduled-emails/${emailId}`, null),

    sendEmailNow: (emailId) =>
      safeFetch(`${baseUrl}/scheduled-emails/${emailId}/send-now`, { success: false, error: 'Request failed' }, { method: 'POST' }),

    rescheduleEmail: async (emailId, sendTime) => {
      await strictFetch<void>(`${baseUrl}/scheduled-emails/${emailId}/reschedule`, {
        method: 'PUT',
        body: JSON.stringify({ send_time: sendTime }),
      }, 'Failed to reschedule email');
    },

    reorderEmails: async (emailIds, startTime) => {
      await strictFetch<void>(`${baseUrl}/scheduled-emails/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ email_ids: emailIds, start_time: startTime }),
      }, 'Failed to reorder emails');
    },

    getCampaignScheduleSummary: () =>
      safeFetch(`${baseUrl}/campaign-schedule-summary`, []),

    processScheduled: (reviewMode = false) =>
      safeFetch(
        `${baseUrl}/process-scheduled${reviewMode ? '?review_mode=true' : ''}`,
        { success: false, error: 'Request failed' },
        { method: 'POST' }
      ),
  };
}

// ── Singleton + provider swap ───────────────────────────────

let _provider: EmailProvider = createHttpEmailProvider('/api/emails');

/**
 * Replace the active email provider at runtime.
 * Useful for tests or for swapping to a different email backend
 * (SendGrid, Mailgun, etc.).
 */
export function setEmailProvider(provider: EmailProvider): void {
  _provider = provider;
}

/** Get the current email provider (for testing / inspection). */
export function getEmailProvider(): EmailProvider {
  return _provider;
}

/**
 * Email API — delegates to the current `EmailProvider`.
 *
 * All consumers should import `emailApi` and call methods on it.
 * The underlying provider can be swapped via `setEmailProvider()`.
 */
export const emailApi: EmailProvider = new Proxy({} as EmailProvider, {
  get(_target, prop: string) {
    return (...args: unknown[]) =>
      (_provider as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args);
  },
});
