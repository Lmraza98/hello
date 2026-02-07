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
  salesforce_status: string | null;
  salesforce_uploaded_at: string | null;
  salesforce_upload_batch: string | null;
  scraped_at: string | null;
  vertical: string | null;
}

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
  
  addCompany: (company: Partial<Company>) =>
    fetchJson<Company>('/companies', { method: 'POST', body: JSON.stringify(company) }),
  
  updateCompany: (company: Company) =>
    fetchJson<Company>(`/companies/${company.id}`, { method: 'PUT', body: JSON.stringify(company) }),
  
  deleteCompany: (id: number) =>
    fetchJson<{ deleted: boolean }>(`/companies/${id}`, { method: 'DELETE' }),
  
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
};
