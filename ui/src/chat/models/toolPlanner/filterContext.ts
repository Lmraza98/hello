import {
  FILTER_CONTEXT_PREFETCH_INTERVAL_MS,
  FILTER_CONTEXT_TTL_MS,
} from './config';

let filterContextCache: { value: string; cachedAt: number } = { value: '', cachedAt: 0 };
let filterPrefetchTimer: ReturnType<typeof setInterval> | null = null;

async function refreshFilterContextCache(): Promise<string> {
  try {
    const [companiesRes, contactsRes, campaignsRes] = await Promise.all([
      fetch('/api/companies'),
      fetch('/api/contacts'),
      fetch('/api/emails/campaigns'),
    ]);

    const companies = companiesRes.ok ? await companiesRes.json() as Array<Record<string, unknown>> : [];
    const contacts = contactsRes.ok ? await contactsRes.json() as Array<Record<string, unknown>> : [];
    const campaigns = campaignsRes.ok ? await campaignsRes.json() as Array<Record<string, unknown>> : [];

    const uniq = (rows: Array<Record<string, unknown>>, key: string, limit = 25): string[] => {
      const out = new Set<string>();
      for (const row of rows) {
        const raw = row?.[key];
        if (raw == null) continue;
        const text = String(raw).trim();
        if (!text) continue;
        out.add(text);
      }
      return [...out].sort((a, b) => a.localeCompare(b)).slice(0, limit);
    };

    const companiesVertical = uniq(companies, 'vertical');
    const companiesTier = uniq(companies, 'tier');
    const companiesStatus = uniq(companies, 'status');
    const contactsVertical = uniq(contacts, 'vertical');
    const campaignsNames = uniq(campaigns, 'name', 15);

    const block =
      `Known canonical filter values (sampled from current app data):\n` +
      `- search_companies.vertical: ${companiesVertical.join(' | ') || 'none'}\n` +
      `- search_companies.tier: ${companiesTier.join(' | ') || 'none'}\n` +
      `- search_companies.status: ${companiesStatus.join(' | ') || 'none'}\n` +
      `- search_contacts.vertical: ${contactsVertical.join(' | ') || 'none'}\n` +
      `- list_campaigns.name: ${campaignsNames.join(' | ') || 'none'}\n` +
      `If user asks for a near-match category, first call list_filter_values with starts_with before final filtering.\n`;

    filterContextCache = { value: block, cachedAt: Date.now() };
    return block;
  } catch {
    return filterContextCache.value || '';
  }
}

function getFilterContextBlock(): string {
  const now = Date.now();
  if (now - filterContextCache.cachedAt < FILTER_CONTEXT_TTL_MS && filterContextCache.value) {
    return filterContextCache.value;
  }
  return filterContextCache.value;
}

export function startFilterContextPrefetch(): void {
  if (filterPrefetchTimer) return;
  refreshFilterContextCache().catch(() => { /* best-effort */ });
  filterPrefetchTimer = setInterval(() => {
    refreshFilterContextCache().catch(() => { /* best-effort */ });
  }, FILTER_CONTEXT_PREFETCH_INTERVAL_MS);
}

export function stopFilterContextPrefetch(): void {
  if (filterPrefetchTimer) {
    clearInterval(filterPrefetchTimer);
    filterPrefetchTimer = null;
  }
}

export async function prewarmToolPlannerContext(): Promise<void> {
  try {
    await refreshFilterContextCache();
    startFilterContextPrefetch();
  } catch {
    // best-effort warmup only
  }
}

export { getFilterContextBlock, refreshFilterContextCache };
