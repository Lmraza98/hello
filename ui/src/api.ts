// API client for LinkedIn Scraper backend

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
}

export type Contact = {
  id: number;
  company_name: string;
  domain: string | null;
  name: string;
  title: string | null;
  email: string | null;
  email_pattern: string | null;
  linkedin_url: string | null;
  scraped_at: string | null;
}

export type ScrapeStatus = {
  running: boolean;
  progress: number;
  total: number;
  current_company: string | null;
  results: {
    success: number;
    failed: number;
    contacts: number;
  };
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Stats
  getStats: () => fetchJson<Stats>('/stats'),
  
  // Companies
  getCompanies: (tier?: string) => 
    fetchJson<Company[]>(`/companies${tier ? `?tier=${tier}` : ''}`),
  
  importCompanies: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(API_BASE + '/companies/import', {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  
  // Contacts
  getContacts: (params?: { company?: string; has_email?: boolean; today_only?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.company) searchParams.set('company', params.company);
    if (params?.has_email !== undefined) searchParams.set('has_email', String(params.has_email));
    if (params?.today_only) searchParams.set('today_only', 'true');
    const query = searchParams.toString();
    return fetchJson<Contact[]>(`/contacts${query ? `?${query}` : ''}`);
  },
  
  exportContacts: (todayOnly = false) => {
    window.open(API_BASE + `/contacts/export?today_only=${todayOnly}`, '_blank');
  },
  
  clearContacts: (todayOnly = false) =>
    fetchJson<{ deleted: number }>(`/contacts?today_only=${todayOnly}`, { method: 'DELETE' }),
  
  // Scraping
  getScrapeStatus: () => fetchJson<ScrapeStatus>('/scrape/status'),
  
  startScrape: (tier?: string, maxContacts = 25, workers = 3) =>
    fetchJson<{ message: string }>('/scrape/start', {
      method: 'POST',
      body: JSON.stringify({ tier, max_contacts: maxContacts, workers }),
    }),
  
  discoverEmails: () =>
    fetchJson<{ message: string }>('/emails/discover', { method: 'POST' }),
};

