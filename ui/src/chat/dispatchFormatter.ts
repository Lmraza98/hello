import type { ChatMessage, ContactAction } from '../types/chat';
import { textMsg } from '../services/workflows/helpers';
import { dispatchToolCalls } from './toolExecutor';
import {
  asObject,
  extractCompaniesFromResult,
  extractContactsFromResult,
  extractSalesNavProfilesFromResult,
  removeEmptyArgs,
  type CompanyLike,
} from './resultExtractors';
import { buildResearchCardMessage } from './researchCards';

type DispatchResult = Awaited<ReturnType<typeof dispatchToolCalls>>;

type HybridSearchItem = {
  entity_type?: string;
  entity_id?: string;
  title?: string;
  snippet?: string;
  source_refs?: unknown[];
};

function formatFilterValues(dispatched: DispatchResult): ChatMessage[] | null {
  const call = [...dispatched.executed]
    .reverse()
    .find((item) => item.name === 'list_filter_values' && item.ok);
  if (!call) return null;

  const payload = asObject(call.result);
  const values = Array.isArray(payload?.values) ? payload.values : [];
  const argName = typeof payload?.arg_name === 'string' ? payload.arg_name : 'filter';
  if (values.length === 0) return [textMsg(`No available values found for ${argName}.`)];
  return [textMsg(`Available ${argName} values: ${values.slice(0, 20).join(', ')}`)];
}

function formatCollectedCompanies(dispatched: DispatchResult): ChatMessage[] | null {
  const call = [...dispatched.executed]
    .reverse()
    .find((item) => item.name === 'collect_companies_from_salesnav' && item.ok);
  if (!call) return null;

  const companies = extractCompaniesFromResult(call.result);
  if (companies.length === 0) return [textMsg('No companies found from Sales Navigator for that query.')];

  const limited = companies.slice(0, 20);
  const header =
    companies.length === 1
      ? 'Collected 1 company from Sales Navigator:'
      : `Collected ${companies.length} companies from Sales Navigator${companies.length > 20 ? ' (showing first 20)' : ''}:`;

  return [
    textMsg(header),
    {
      id: `company-list-collect-${Date.now()}`,
      type: 'company_list',
      sender: 'bot',
      timestamp: new Date(),
      companies: limited.map((company) => ({
        company_name: company.company_name || 'Unknown company',
        industry: company.vertical || company.industry || undefined,
        location: company.location || undefined,
        linkedin_url: company.linkedin_url || undefined,
        employee_count: undefined,
      })),
      prompt: 'Sales Navigator results:',
      selectable: false,
    },
  ];
}

function intersectCompanyResults(companyCalls: Array<{ args: Record<string, unknown>; rows: CompanyLike[] }>): CompanyLike[] {
  const toKey = (company: CompanyLike): string =>
    `${String(company.company_name || '').trim().toLowerCase()}|${String(company.domain || '').trim().toLowerCase()}`;

  const isUnionCategoryExpansion = companyCalls.every((entry) => {
    const keys = Object.keys(removeEmptyArgs(entry.args)).filter((k) => !k.startsWith('_'));
    return keys.length === 1 && ['vertical', 'tier', 'status'].includes(keys[0] || '');
  });

  if (isUnionCategoryExpansion) {
    const seen = new Set<string>();
    const out: CompanyLike[] = [];
    for (const entry of companyCalls) {
      for (const row of entry.rows) {
        const key = toKey(row);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
    }
    return out;
  }

  const maps = companyCalls
    .map((entry) => {
      const map = new Map<string, CompanyLike>();
      for (const row of entry.rows) {
        const key = toKey(row);
        if (!key) continue;
        map.set(key, row);
      }
      return map;
    })
    .filter((m) => m.size > 0);

  if (maps.length === 0) return [];
  if (maps.length === 1) return [...maps[0].values()];

  const [first, ...rest] = maps;
  const intersectionKeys = [...first.keys()].filter((key) => rest.every((m) => m.has(key)));
  return intersectionKeys.map((key) => first.get(key)).filter(Boolean) as CompanyLike[];
}

function formatSearchCompanies(dispatched: DispatchResult): ChatMessage[] | null {
  const companyCalls = dispatched.executed.filter((item) => item.name === 'search_companies' && item.ok);
  if (companyCalls.length === 0) return null;

  const researchCall = [...dispatched.executed]
    .reverse()
    .find((item) => (item.name === 'research_company' || item.name === 'research_person') && item.ok);
  const researchCard = researchCall ? buildResearchCardMessage(researchCall.result) : null;
  const callResults = companyCalls.map((call) => ({
    args: call.args || {},
    rows: extractCompaniesFromResult(call.result),
  }));
  const companies = intersectCompanyResults(callResults);

  if (companies.length === 0) {
    if (researchCard) return [textMsg('No matching companies found in your local database.'), researchCard];
    return [textMsg('No matching companies found.')];
  }

  const limited = companies.slice(0, 20);
  const header =
    companies.length === 1
      ? 'Found 1 matching company:'
      : `Found ${companies.length} matching companies${companies.length > 20 ? ' (showing first 20)' : ''}:`;

  return [
    textMsg(header),
    {
      id: `company-list-${Date.now()}`,
      type: 'company_list',
      sender: 'bot',
      timestamp: new Date(),
      companies: limited.map((company) => ({
        company_name: company.company_name || 'Unknown company',
        industry: company.vertical || undefined,
        location: company.location || undefined,
        linkedin_url: company.linkedin_url || undefined,
        employee_count: undefined,
      })),
      prompt: 'Here are the results:',
      selectable: false,
    },
    ...(researchCard ? [researchCard] : []),
  ];
}

function formatSalesNavPeople(dispatched: DispatchResult): ChatMessage[] | null {
  const peopleCall = [...dispatched.executed]
    .reverse()
    .find((item) => item.name === 'salesnav_person_search' && item.ok);
  if (!peopleCall) return null;

  const profiles = extractSalesNavProfilesFromResult(peopleCall.result);
  if (profiles.length === 0) return [textMsg('No matching profiles found in Sales Navigator.')];

  const cards = profiles.slice(0, 5).map((profile, idx) => ({
    id: `salesnav-profile-card-${Date.now()}-${idx}`,
    type: 'contact_card' as const,
    sender: 'bot' as const,
    timestamp: new Date(),
    contact: {
      name: profile.name || 'Unknown',
      title: profile.title || undefined,
      company: profile.company || 'Unknown company',
      linkedin_url: profile.linkedin_url || undefined,
      location: profile.location || undefined,
      source: 'Sales Navigator',
    },
    actions: [],
  }));

  const header =
    profiles.length === 1
      ? 'Found 1 matching profile in Sales Navigator:'
      : `Found ${profiles.length} matching profiles in Sales Navigator${profiles.length > 5 ? ' (showing first 5)' : ''}:`;

  return [textMsg(header), ...cards];
}

function formatSearchContacts(dispatched: DispatchResult): ChatMessage[] | null {
  const searchCall = [...dispatched.executed].reverse().find((item) => item.name === 'search_contacts' && item.ok);
  const researchCall = [...dispatched.executed]
    .reverse()
    .find((item) => (item.name === 'research_company' || item.name === 'research_person') && item.ok);
  const researchCard = researchCall ? buildResearchCardMessage(researchCall.result) : null;

  if (!searchCall && researchCard) return [researchCard];
  if (!searchCall) return null;

  const contacts = extractContactsFromResult(searchCall.result);
  if (contacts.length === 0) return [textMsg('No matching contacts found.')];

  const cards = contacts.slice(0, 5).map((contact, idx) => ({
    id: `contact-card-${Date.now()}-${idx}`,
    type: 'contact_card' as const,
    sender: 'bot' as const,
    timestamp: new Date(),
    contact: {
      id: typeof contact.id === 'number' ? contact.id : undefined,
      name: contact.name || 'Unknown',
      title: contact.title || undefined,
      company: contact.company_name || 'Unknown company',
      email: contact.email || undefined,
      phone: contact.phone || undefined,
      location: undefined,
      linkedin_url: contact.linkedin_url || undefined,
      salesforce_url: contact.salesforce_url || undefined,
      source: contact.phone ? `Phone: ${contact.phone}` : undefined,
    },
    actions:
      (typeof contact.id === 'number'
        ? ['add_to_campaign', 'send_email', 'sync_salesforce', 'delete_contact']
        : ['add_to_campaign', 'send_email']) as ContactAction[],
  }));

  const header =
    contacts.length === 1
      ? 'Found 1 matching contact:'
      : `Found ${contacts.length} matching contacts${contacts.length > 5 ? ' (showing first 5)' : ''}:`;

  return [textMsg(header), ...cards];
}

function formatHybridSearch(dispatched: DispatchResult): ChatMessage[] | null {
  const searchCall = [...dispatched.executed].reverse().find((item) => item.name === 'hybrid_search' && item.ok);
  if (!searchCall || !searchCall.result || typeof searchCall.result !== 'object') return null;
  const payload = searchCall.result as { results?: HybridSearchItem[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (results.length === 0) return [textMsg('No grounded local matches found for that query.')];

  const lines = results.slice(0, 8).map((item, idx) => {
    const kind = String(item.entity_type || 'item');
    const id = String(item.entity_id || '');
    const title = String(item.title || `${kind} ${id}`).trim();
    const snippet = String(item.snippet || '').trim();
    const refsCount = Array.isArray(item.source_refs) ? item.source_refs.length : 0;
    return `${idx + 1}. [${kind}] ${title}${snippet ? ` - ${snippet}` : ''}${refsCount > 0 ? ` (refs: ${refsCount})` : ''}`;
  });

  return [
    textMsg(`Found ${results.length} grounded match${results.length === 1 ? '' : 'es'}:`),
    textMsg(lines.join('\n')),
  ];
}

export function formatDispatchMessages(dispatched: DispatchResult): ChatMessage[] {
  const formatters = [
    formatHybridSearch,
    formatFilterValues,
    formatCollectedCompanies,
    formatSearchCompanies,
    formatSalesNavPeople,
    formatSearchContacts,
  ] as const;

  for (const formatter of formatters) {
    const out = formatter(dispatched);
    if (out && out.length > 0) return out;
  }

  return [textMsg(dispatched.summary)];
}
