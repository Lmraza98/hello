import type { PlannedToolCall } from './chatEngineTypes';

const CONTACT_VERBS = ['find ', 'search ', 'show ', 'get ', 'lookup ', 'look up '];
const SALESNAV_WORDS = ['salesnavigator', 'sales navigator', 'salesnav', 'linkedin'];
const SALESNAV_SCRAPE_WORDS = ['collect', 'scrape', 'harvest', 'bulk', 'discover', 'find companies', 'find leads', 'lead list', 'account list'];

type IntentCategory =
  | 'contact_lookup'
  | 'company_lookup'
  | 'salesnav_discovery'
  | 'browser_navigation'
  | 'email_campaign'
  | 'research'
  | 'pipeline_admin'
  | 'general';

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function startsWithVerb(lower: string): boolean {
  return CONTACT_VERBS.some((v) => lower.startsWith(v));
}

function stripLeadingVerb(text: string): string {
  let out = text.trim();
  for (const verb of CONTACT_VERBS) {
    if (out.toLowerCase().startsWith(verb)) {
      out = out.slice(verb.length);
      break;
    }
  }
  return normalizeSpace(out);
}

function extractNameAndCompany(message: string): { name: string; company?: string } | null {
  const raw = stripLeadingVerb(message);
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const fromIdx = lower.lastIndexOf(' from ');
  if (fromIdx > 0) {
    const name = normalizeSpace(raw.slice(0, fromIdx));
    const company = normalizeSpace(raw.slice(fromIdx + 6));
    if (!name) return null;
    return company ? { name, company } : { name };
  }
  if (raw.split(' ').length < 2) return null;
  return { name: raw };
}

function mapVertical(message: string): string | null {
  const lower = message.toLowerCase();
  const pairs: Array<[string[], string]> = [
    [['construction', 'contractor', 'builders'], 'Construction'],
    [['veterinary', 'vet', 'vet clinic', 'animal hospital', 'vet clinics'], 'Veterinary'],
    [['banking', 'bank', 'credit union', 'financial institution'], 'Banking'],
    [['automotive', 'auto', 'car dealership'], 'Automotive'],
    [['healthcare', 'medical', 'clinic'], 'Healthcare'],
    [['software', 'saas', 'technology', 'tech'], 'Software'],
  ];
  for (const [keywords, value] of pairs) {
    if (keywords.some((k) => lower.includes(k))) return value;
  }
  return null;
}

function hasAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w));
}

function isExplicitContactListIntent(lower: string): boolean {
  return (
    hasAny(lower, ['contacts added today', "today's contacts", 'today only']) ||
    hasAny(lower, ['contacts with email', 'with emails', 'has email']) ||
    (hasAny(lower, ['list contacts', 'show contacts']) && hasAny(lower, ['today', 'email', 'with email']))
  );
}

function isExplicitCompanyListIntent(lower: string): boolean {
  return (
    hasAny(lower, ['list companies', 'show companies']) &&
    hasAny(lower, ['tier', 'vertical', 'industry', 'status'])
  );
}

function isRecallLikeLookupIntent(lower: string): boolean {
  return hasAny(lower, [
    'find ',
    'recall',
    'about ',
    'who',
    'where',
    'what did we say',
    'previously',
    'work history',
    'thread',
    'conversation',
  ]);
}

function extractLocationHint(message: string): string | null {
  const lower = message.toLowerCase();
  const separators = [' in ', ' from ', ' near '];
  for (const sep of separators) {
    const idx = lower.indexOf(sep);
    if (idx >= 0) {
      const value = normalizeSpace(message.slice(idx + sep.length));
      if (value && value.length > 1) return value;
    }
  }
  return null;
}

function hasNavigationIntent(message: string): boolean {
  const lower = message.toLowerCase();
  if (/https?:\/\//.test(lower)) return true;
  if (/\bopen\s+([a-z0-9-]+\.)+[a-z]{2,}\b/.test(lower)) return true;
  const navigationWords = [
    'navigate',
    'go to ',
    'click ',
    'type ',
    'fill ',
    'snapshot',
    'screenshot',
    'tab',
    'browser',
    'page',
    'ref ',
  ];
  return hasAny(lower, navigationWords);
}

function hasSalesNavScrapeIntent(message: string): boolean {
  const lower = message.toLowerCase();
  if (!hasAny(lower, SALESNAV_WORDS)) return false;
  if (hasAny(lower, SALESNAV_SCRAPE_WORDS)) return true;
  if (hasAny(lower, ['company', 'companies']) && hasAny(lower, ['find', 'search', 'show'])) return true;
  return false;
}

function extractSalesNavTarget(message: string): string | null {
  let text = normalizeSpace(message);
  text = text.replace(/\b(on|in|from)\s+(linkedin\s+)?sales\s*navigator\b.*$/i, '').trim();
  text = text.replace(/^(find|search|show|get|lookup|look up)\s+/i, '').trim();
  text = text.replace(/\b(on|in)\s+linkedin\b.*$/i, '').trim();
  text = text.replace(/[?.!]+$/g, '').trim();
  return text || null;
}

function extractSearchAndClickTargets(message: string): { query: string; clickCompany?: string } | null {
  const lower = message.toLowerCase();
  const searchMatch = lower.match(/search for ([^,\n]+?)(?: then| and|$)/i);
  const clickMatch = lower.match(/click on ([^,\n]+?)(?: then| and|$)/i);
  const query = searchMatch?.[1] ? normalizeSpace(message.slice(searchMatch.index! + 'search for '.length, searchMatch.index! + 'search for '.length + searchMatch[1].length)) : '';
  const clickCompany = clickMatch?.[1]
    ? normalizeSpace(message.slice(clickMatch.index! + 'click on '.length, clickMatch.index! + 'click on '.length + clickMatch[1].length))
    : '';
  if (!query) return null;
  return { query, clickCompany: clickCompany || undefined };
}

export function classifyIntentCategory(message: string): IntentCategory {
  const lower = message.toLowerCase();
  const hasSalesNav = hasAny(lower, SALESNAV_WORDS);
  const hasContactWord = hasAny(lower, ['contact', 'person', 'people', 'lead', 'prospect']);
  const hasCompanyWord = hasAny(lower, ['company', 'companies', 'business', 'industry', 'vertical', 'clinic']);
  const hasEmailWord = hasAny(lower, ['email', 'campaign', 'sequence', 'enroll', 'add to campaign', 'send']);
  const hasResearchWord = hasAny(lower, ['research', 'assess', 'similar', 'like ']);
  const hasAdminWord = hasAny(lower, ['pipeline', 'dashboard', 'stats', 'status']);

  if (hasSalesNav && !hasSalesNavScrapeIntent(lower)) return 'browser_navigation';
  if (hasNavigationIntent(lower) && !hasSalesNav) return 'browser_navigation';
  if (hasSalesNav) return 'salesnav_discovery';
  if (hasEmailWord && (hasContactWord || startsWithVerb(lower))) return 'email_campaign';
  if (hasContactWord || /\b(find|search|show|get)\b.+\b[A-Z]/.test(message)) return 'contact_lookup';
  if (hasCompanyWord) return 'company_lookup';
  if (hasResearchWord) return 'research';
  if (hasAdminWord) return 'pipeline_admin';
  return 'general';
}

export function selectToolsForIntent(message: string): string[] {
  const category = classifyIntentCategory(message);
  const lower = message.toLowerCase();
  const explicitList = isExplicitContactListIntent(lower) || isExplicitCompanyListIntent(lower);
  const categories: Record<IntentCategory, string[]> = {
    contact_lookup: explicitList
      ? ['search_contacts', 'list_filter_values', 'hybrid_search', 'resolve_entity', 'get_contact']
      : ['resolve_entity', 'hybrid_search', 'search_contacts', 'get_contact', 'list_filter_values'],
    company_lookup: explicitList
      ? ['search_companies', 'list_filter_values', 'hybrid_search', 'resolve_entity', 'get_pending_companies_count']
      : ['resolve_entity', 'hybrid_search', 'search_companies', 'list_filter_values', 'get_pending_companies_count'],
    salesnav_discovery: ['collect_companies_from_salesnav', 'salesnav_person_search', 'salesnav_scrape_leads'],
    browser_navigation: ['browser_health', 'browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_find_ref', 'browser_act', 'browser_wait', 'browser_screenshot', 'browser_extract_companies', 'browser_salesnav_search_account'],
    email_campaign: ['search_contacts', 'list_campaigns', 'get_campaign', 'enroll_contacts_in_campaign', 'send_campaign_emails', 'send_email_now'],
    research: ['research_company', 'research_person', 'assess_icp_fit'],
    pipeline_admin: ['start_pipeline', 'get_pipeline_status', 'get_dashboard_stats'],
    general: ['resolve_entity', 'hybrid_search', 'search_contacts', 'search_companies', 'collect_companies_from_salesnav'],
  };

  const base = [...(categories[category] || categories.general)];
  if (category === 'email_campaign') {
    // Cross-category context for name->company lookup before write actions.
    base.push('search_companies');
  }
  return [...new Set(base)].slice(0, 10);
}

export function detectFastPathPlan(message: string): { calls: PlannedToolCall[]; reason: string } | null {
  const trimmed = normalizeSpace(message);
  const lower = trimmed.toLowerCase();
  if (!trimmed) return null;

  const isGreetingOnly = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'cancel', 'new request'].includes(lower);
  if (isGreetingOnly) return null;

  const hasSalesNav = hasAny(lower, SALESNAV_WORDS);
  if (hasSalesNavScrapeIntent(lower)) {
    return {
      reason: 'fast_path_salesnav',
      calls: [
        {
          name: 'collect_companies_from_salesnav',
          args: { query: trimmed },
        },
      ],
    };
  }

  if (hasSalesNav && !hasSalesNavScrapeIntent(lower)) {
    const target = extractSalesNavTarget(trimmed) || trimmed;
    return {
      reason: 'fast_path_salesnav_navigation',
      calls: [
        { name: 'browser_health', args: {} },
        { name: 'browser_salesnav_search_account', args: { query: target, click_company: target, wait_ms: 3500, limit: 5 } },
      ],
    };
  }

  const followup = extractSearchAndClickTargets(trimmed);
  if (followup) {
    return {
      reason: 'fast_path_browser_search_click',
      calls: [
        { name: 'browser_health', args: {} },
        {
          name: 'browser_salesnav_search_account',
          args: {
            query: followup.query,
            click_company: followup.clickCompany || followup.query,
            wait_ms: 3500,
            limit: 5,
          },
        },
      ],
    };
  }

  if (isExplicitContactListIntent(lower)) {
    const args: Record<string, unknown> = {};
    if (hasAny(lower, ['today', 'today only', "today's"])) args.today_only = true;
    if (hasAny(lower, ['with email', 'with emails', 'has email'])) args.has_email = true;
    return { reason: 'fast_path_contact_list_filters', calls: [{ name: 'search_contacts', args }] };
  }

  if (isExplicitCompanyListIntent(lower)) {
    const args: Record<string, unknown> = {};
    const tierMatch = lower.match(/\btier\s+([abc])\b/i);
    if (tierMatch?.[1]) args.tier = tierMatch[1].toUpperCase();
    const vertical = mapVertical(trimmed);
    if (vertical) args.vertical = vertical;
    return { reason: 'fast_path_company_list_filters', calls: [{ name: 'search_companies', args }] };
  }

  if (isRecallLikeLookupIntent(lower)) {
    return {
      reason: 'fast_path_hybrid_recall',
      calls: [{ name: 'hybrid_search', args: { query: trimmed, k: 10 } }],
    };
  }

  if (hasAny(lower, ['send an email to', 'email ']) && !hasAny(lower, ['campaign stats', 'email dashboard'])) {
    const extracted = extractNameAndCompany(trimmed);
    if (extracted?.name) {
      return {
        reason: 'fast_path_email_lookup',
        calls: [{ name: 'hybrid_search', args: {
          query: extracted.company ? `${extracted.name} ${extracted.company}` : extracted.name,
          entity_types: ['contact'],
          k: 10,
        } }],
      };
    }
  }

  if (hasAny(lower, ['add ', 'enroll']) && hasAny(lower, ['campaign'])) {
    const extracted = extractNameAndCompany(trimmed);
    if (extracted?.name) {
      return {
        reason: 'fast_path_campaign_lookup',
        calls: [{ name: 'hybrid_search', args: {
          query: extracted.company ? `${extracted.name} ${extracted.company}` : extracted.name,
          entity_types: ['contact'],
          k: 10,
        } }],
      };
    }
  }

  if (startsWithVerb(lower) && (hasAny(lower, ['contact', 'person']) || !hasAny(lower, ['companies', 'company']))) {
    const extracted = extractNameAndCompany(trimmed);
    if (extracted?.name) {
      return {
        reason: 'fast_path_contact_lookup',
        calls: [{ name: 'hybrid_search', args: {
          query: extracted.company ? `${extracted.name} ${extracted.company}` : extracted.name,
          entity_types: ['contact'],
          k: 10,
        } }],
      };
    }
  }

  if (hasAny(lower, ['companies', 'company', 'industry', 'vertical', 'clinics'])) {
    const vertical = mapVertical(trimmed);
    const location = extractLocationHint(trimmed);
    const args: Record<string, unknown> = {};
    if (vertical) args.vertical = vertical;
    if (location) args.q = location;
    if (Object.keys(args).length > 0) {
      return {
        reason: 'fast_path_company_lookup',
        calls: [{ name: 'hybrid_search', args: {
          query: [args.company_name, args.vertical, args.q].filter(Boolean).join(' ').trim() || trimmed,
          entity_types: ['company'],
          k: 10,
        } }],
      };
    }
  }

  return null;
}
