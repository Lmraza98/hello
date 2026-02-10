import type {
  EmailCampaign,
  EmailTemplate,
  CampaignContact,
  SentEmail,
  GlobalStats,
  ReviewQueueItem,
  EmailConfig,
  ScheduledEmail,
  EmailDetail,
  CampaignScheduleSummary
} from '../types/email';

const API_BASE = '/api/emails';

export const emailApi = {
  getCampaigns: async (status?: string): Promise<EmailCampaign[]> => {
    try {
      const url = status ? `${API_BASE}/campaigns?status=${status}` : `${API_BASE}/campaigns`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  getCampaign: async (id: number): Promise<EmailCampaign | null> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${id}`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },
  
  createCampaign: async (data: Partial<EmailCampaign>): Promise<EmailCampaign> => {
    const res = await fetch(`${API_BASE}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to create campaign');
    return res.json();
  },
  
  updateCampaign: async (id: number, data: Partial<EmailCampaign>): Promise<EmailCampaign> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update campaign');
    return res.json();
  },
  
  deleteCampaign: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete campaign');
  },
  
  activateCampaign: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}/activate`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Failed to activate campaign');
    }
  },
  
  pauseCampaign: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}/pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to pause campaign');
  },
  
  getTemplates: async (campaignId: number): Promise<EmailTemplate[]> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/templates`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  saveTemplates: async (campaignId: number, templates: Partial<EmailTemplate>[]): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${campaignId}/templates/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templates)
    });
    if (!res.ok) throw new Error('Failed to save templates');
  },
  
  getCampaignContacts: async (campaignId: number): Promise<CampaignContact[]> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/contacts`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  enrollContacts: async (campaignId: number, contactIds: number[]): Promise<{ enrolled: number; skipped: number }> => {
    const res = await fetch(`${API_BASE}/campaigns/${campaignId}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: contactIds })
    });
    if (!res.ok) throw new Error('Failed to enroll contacts');
    return res.json();
  },
  
  sendEmails: async (campaignId?: number, limit?: number, reviewMode: boolean = true): Promise<{ success: boolean; message?: string; error?: string; ready_count?: number }> => {
    try {
      const res = await fetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, limit, review_mode: reviewMode })
      });
      return res.json();
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  
  getSentEmails: async (campaignId?: number, limit?: number): Promise<SentEmail[]> => {
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set('campaign_id', String(campaignId));
      if (limit) params.set('limit', String(limit));
      const res = await fetch(`${API_BASE}/sent?${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  getStats: async (): Promise<GlobalStats> => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (!res.ok) return { total_campaigns: 0, active_campaigns: 0, total_contacts_enrolled: 0, total_sent: 0, sent_today: 0 };
      return res.json();
    } catch {
      return { total_campaigns: 0, active_campaigns: 0, total_contacts_enrolled: 0, total_sent: 0, sent_today: 0 };
    }
  },
  
  getQueue: async (campaignId?: number): Promise<CampaignContact[]> => {
    try {
      const params = campaignId ? `?campaign_id=${campaignId}` : '';
      const res = await fetch(`${API_BASE}/queue${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  uploadToSalesforce: async (campaignId: number): Promise<{ success: boolean; message?: string; error?: string; exported?: number }> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/salesforce-upload`, {
        method: 'POST'
      });
      return res.json();
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  getReviewQueue: async (): Promise<ReviewQueueItem[]> => {
    try {
      const res = await fetch(`${API_BASE}/review-queue`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  approveEmail: async (emailId: number, subject?: string, body?: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/review-queue/${emailId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body })
    });
    if (!res.ok) throw new Error('Failed to approve email');
  },

  rejectEmail: async (emailId: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/review-queue/${emailId}/reject`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reject email');
  },

  approveAll: async (emailIds: number[]): Promise<void> => {
    const res = await fetch(`${API_BASE}/review-queue/approve-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_ids: emailIds })
    });
    if (!res.ok) throw new Error('Failed to bulk approve');
  },

  prepareBatch: async (): Promise<{ success: boolean; drafts_created?: number; message?: string; error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/prepare-batch`, { method: 'POST' });
      return res.json();
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  getTrackingStatus: async (days: number = 7) => {
    try {
      const res = await fetch(`${API_BASE}/tracking-status?days=${days}`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  getScheduled: async (): Promise<SentEmail[]> => {
    try {
      const res = await fetch(`${API_BASE}/scheduled`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  getConfig: async (): Promise<EmailConfig | null> => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  updateConfig: async (data: Partial<EmailConfig>): Promise<void> => {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update config');
  },

  // === Scheduled Emails (full timeline) ===

  getAllScheduledEmails: async (campaignId?: number): Promise<ScheduledEmail[]> => {
    try {
      const params = campaignId ? `?campaign_id=${campaignId}` : '';
      const res = await fetch(`${API_BASE}/scheduled-emails${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  getEmailDetail: async (emailId: number): Promise<EmailDetail | null> => {
    try {
      const res = await fetch(`${API_BASE}/scheduled-emails/${emailId}`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  sendEmailNow: async (emailId: number): Promise<{ success: boolean; message?: string; error?: string; contact_name?: string; company_name?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/scheduled-emails/${emailId}/send-now`, {
        method: 'POST'
      });
      return res.json();
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  rescheduleEmail: async (emailId: number, sendTime: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/scheduled-emails/${emailId}/reschedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ send_time: sendTime })
    });
    if (!res.ok) throw new Error('Failed to reschedule email');
  },

  reorderEmails: async (emailIds: number[], startTime?: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/scheduled-emails/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_ids: emailIds, start_time: startTime })
    });
    if (!res.ok) throw new Error('Failed to reorder emails');
  },

  getCampaignScheduleSummary: async (): Promise<CampaignScheduleSummary[]> => {
    try {
      const res = await fetch(`${API_BASE}/campaign-schedule-summary`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
};
