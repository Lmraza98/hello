import { TOOLS } from './tools';
import { normalizeToolArgs } from '../utils/filterNormalization';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export type ParsedToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type ToolDispatchItem = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
};

export type ToolDispatchResult = {
  success: boolean;
  toolsUsed: string[];
  executed: ToolDispatchItem[];
  summary: string;
};

function getPathValue(source: unknown, path: string): unknown {
  if (!path) return source;
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.').filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

function resolveTemplate(
  value: unknown,
  previousResult: unknown,
  resultsByTool: Record<string, unknown>
): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    const prevMatch = trimmed.match(/^\$prev(?:\.(.+))?$/);
    if (trimmed === '$previous_result') return previousResult;
    if (prevMatch) return getPathValue(previousResult, prevMatch[1] || '');

    const toolMatch = trimmed.match(/^\$tool\.([a-zA-Z0-9_]+)(?:\.(.+))?$/);
    if (toolMatch) {
      const toolName = toolMatch[1] || '';
      const path = toolMatch[2] || '';
      return getPathValue(resultsByTool[toolName], path);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplate(v, previousResult, resultsByTool));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplate(v, previousResult, resultsByTool);
    }
    return out;
  }

  return value;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    return { error: true, status: res.status, ...err };
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }

  return { success: true, message: 'File download triggered' };
}

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())) {
      p.set(k, String(v));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toLowerString(value: unknown): string {
  if (value == null) return '';
  return String(value).toLowerCase();
}

function postFilterSearchCompanies(args: Record<string, unknown>, result: unknown): unknown {
  if (!Array.isArray(result)) return result;
  const q = typeof args.q === 'string' ? args.q.trim().toLowerCase() : '';
  const companyName = typeof args.company_name === 'string' ? args.company_name.trim().toLowerCase() : '';
  const vertical = typeof args.vertical === 'string' ? args.vertical.trim().toLowerCase() : '';
  const tier = typeof args.tier === 'string' ? args.tier.trim().toLowerCase() : '';

  if (!q && !companyName && !vertical && !tier) return result;

  const qTokens = q
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);

  return result.filter((item) => {
    const row = asObject(item);
    if (!row) return false;
    const nameText = toLowerString(row.company_name || row.name);
    const verticalText = toLowerString(row.vertical || row.industry);
    const tierText = toLowerString(row.tier);
    const searchable = [
      toLowerString(row.company_name),
      toLowerString(row.name),
      toLowerString(row.domain),
      toLowerString(row.vertical),
      toLowerString(row.industry),
      toLowerString(row.target_reason),
      toLowerString(row.wedge),
    ].join(' ');

    if (companyName && !nameText.includes(companyName)) return false;
    if (vertical && !verticalText.includes(vertical)) return false;
    if (tier && tier !== 'all' && tier !== 'any' && tierText !== tier) return false;
    if (qTokens.length > 0 && !qTokens.some((token) => searchable.includes(token))) return false;

    return true;
  });
}

function distinctValues(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    out.add(text);
  }
  return [...out];
}

async function listFilterValues(args: Record<string, unknown>): Promise<unknown> {
  const toolName = typeof args.tool_name === 'string' ? args.tool_name.trim() : '';
  const argName = typeof args.arg_name === 'string' ? args.arg_name.trim() : '';
  const startsWith = typeof args.starts_with === 'string' ? args.starts_with.trim().toLowerCase() : '';
  const limitRaw = Number(args.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 25;

  if (!argName) return { error: true, message: 'arg_name is required' };

  const lowerArg = argName.toLowerCase();
  let values: string[] = [];
  let source = 'unknown';

  if (lowerArg === 'has_email' || lowerArg === 'today_only' || lowerArg === 'with_email_only') {
    values = ['true', 'false'];
    source = 'synthetic';
  } else if (
    ['vertical', 'tier', 'status', 'company_name', 'q', 'domain'].includes(lowerArg) ||
    toolName === 'search_companies'
  ) {
    const companies = await api('GET', '/api/companies');
    const rows = Array.isArray(companies) ? companies : [];
    source = 'companies';
    if (lowerArg === 'q') {
      values = distinctValues(
        rows.flatMap((row) => {
          const obj = asObject(row);
          if (!obj) return [];
          return [obj.vertical, obj.company_name, obj.domain];
        })
      );
    } else {
      values = distinctValues(
        rows.map((row) => {
          const obj = asObject(row);
          if (!obj) return '';
          return obj[lowerArg] ?? '';
        })
      );
    }
  } else if (
    ['company', 'name', 'title', 'salesforce_status', 'vertical'].includes(lowerArg) ||
    toolName === 'search_contacts'
  ) {
    const contacts = await api('GET', '/api/contacts');
    const rows = Array.isArray(contacts) ? contacts : [];
    source = 'contacts';
    const fieldMap: Record<string, string> = {
      company: 'company_name',
      name: 'name',
      title: 'title',
      salesforce_status: 'salesforce_status',
      vertical: 'vertical',
    };
    const field = fieldMap[lowerArg] || lowerArg;
    values = distinctValues(
      rows.map((row) => {
        const obj = asObject(row);
        if (!obj) return '';
        return obj[field] ?? '';
      })
    );
  } else if (toolName.includes('campaign') || ['campaign_name'].includes(lowerArg)) {
    const campaigns = await api('GET', '/api/emails/campaigns');
    const rows = Array.isArray(campaigns) ? campaigns : [];
    source = 'campaigns';
    values = distinctValues(
      rows.map((row) => {
        const obj = asObject(row);
        if (!obj) return '';
        return obj.name ?? '';
      })
    );
  }

  if (startsWith) {
    values = values.filter((v) => v.toLowerCase().startsWith(startsWith));
  }

  values.sort((a, b) => a.localeCompare(b));
  const limited = values.slice(0, limit);
  return {
    tool_name: toolName || null,
    arg_name: argName,
    source,
    starts_with: startsWith || null,
    total_values: values.length,
    values: limited,
  };
}

function hybridResultItems(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== 'object') return [];
  const items = (result as { results?: unknown }).results;
  if (!Array.isArray(items)) return [];
  return items.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>;
}

function hybridHasResults(result: unknown): boolean {
  return hybridResultItems(result).length > 0;
}

function toHybridRecordFromContact(contact: Record<string, unknown>): Record<string, unknown> {
  const id = String(contact.id ?? '');
  const name = String(contact.name ?? 'Unknown');
  const company = String(contact.company_name ?? 'Unknown company');
  return {
    entity_type: 'contact',
    entity_id: id,
    title: `${name} @ ${company}`,
    snippet: `email=${String(contact.email ?? 'n/a')}, phone=${String(contact.phone ?? 'n/a')}`,
    timestamp: typeof contact.scraped_at === 'string' ? contact.scraped_at : null,
    score_total: 30,
    score_exact: 0,
    score_lex: 0.75,
    score_vec: 0,
    source_refs: [{ kind: 'entity', entity_type: 'contact', entity_id: id, field: 'primary' }],
  };
}

function toHybridRecordFromCompany(company: Record<string, unknown>): Record<string, unknown> {
  const id = String(company.id ?? '');
  return {
    entity_type: 'company',
    entity_id: id,
    title: String(company.company_name ?? 'Unknown company'),
    snippet: `domain=${String(company.domain ?? 'n/a')}, vertical=${String(company.vertical ?? 'n/a')}`,
    timestamp: null,
    score_total: 30,
    score_exact: 0,
    score_lex: 0.75,
    score_vec: 0,
    source_refs: [{ kind: 'entity', entity_type: 'company', entity_id: id, field: 'primary' }],
  };
}

function postProcessResult(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown
): unknown {
  if (toolName === 'search_companies') {
    return postFilterSearchCompanies(args, result);
  }
  return result;
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const normalizedArgs = normalizeToolArgs(toolName, args);
  switch (toolName) {
    case 'resolve_entity':
      return api('POST', '/api/search/resolve', normalizedArgs);
    case 'hybrid_search':
      {
        const initial = await api('POST', '/api/search/hybrid', normalizedArgs);
        const entityTypes = Array.isArray(normalizedArgs.entity_types)
          ? normalizedArgs.entity_types.map((x) => String(x).toLowerCase())
          : [];
        const query = String(normalizedArgs.query || '').trim();
        if (hybridHasResults(initial) || !query) return initial;

        const merged = hybridResultItems(initial);
        if (entityTypes.includes('contact')) {
          const contactRows = await api('GET', `/api/contacts${qs({ name: query })}`);
          if (Array.isArray(contactRows)) {
            merged.push(...contactRows.map((row) => toHybridRecordFromContact(row as Record<string, unknown>)));
          }
        }
        if (entityTypes.includes('company')) {
          const companyRows = await api('GET', `/api/companies${qs({ q: query, company_name: query })}`);
          if (Array.isArray(companyRows)) {
            merged.push(...companyRows.map((row) => toHybridRecordFromCompany(row as Record<string, unknown>)));
          }
        }

        if (merged.length === 0) return initial;
        return { ...(initial as Record<string, unknown>), results: merged };
      }
    case 'search_contacts':
      return api('GET', `/api/contacts${qs(normalizedArgs)}`);
    case 'get_contact':
      return api('GET', `/api/contacts/${args.contact_id}`);
    case 'add_contact':
      return api('POST', '/api/contacts', args);
    case 'delete_contact':
      return api('DELETE', `/api/contacts/${args.contact_id}`);
    case 'salesforce_search_contact':
      return api('POST', `/api/contacts/${args.contact_id}/salesforce-search`);
    case 'bulk_upload_to_salesforce':
      return api('POST', '/api/contacts/bulk-actions/salesforce-upload', {
        contact_ids: args.contact_ids,
      });
    case 'bulk_send_linkedin_requests':
      return api('POST', '/api/contacts/bulk-actions/linkedin-request', {
        contact_ids: args.contact_ids,
      });
    case 'bulk_collect_phone':
      return api('POST', '/api/contacts/bulk-actions/collect-phone', {
        contact_ids: args.contact_ids,
      });
    case 'bulk_delete_contacts':
      return api('POST', '/api/contacts/bulk-actions/delete', {
        contact_ids: args.contact_ids,
      });
    case 'export_contacts_csv':
      return api('GET', `/api/contacts/export${qs(args)}`);

    case 'search_companies':
      return api('GET', `/api/companies${qs(normalizedArgs)}`);
    case 'list_filter_values':
      return listFilterValues(normalizedArgs);
    case 'add_company':
      return api('POST', '/api/companies', args);
    case 'delete_company':
      return api('DELETE', `/api/companies/${args.company_id}`);
    case 'collect_companies_from_salesnav':
      return api('POST', '/api/companies/collect', args);
    case 'mark_company_vetted': {
      const companyId = args.company_id;
      const icpScore = args.icp_score;
      return api('POST', `/api/companies/${companyId}/mark-vetted${qs({ icp_score: icpScore })}`);
    }
    case 'get_pending_companies_count':
      return api('GET', '/api/companies/pending-count');

    case 'list_campaigns':
      return api('GET', `/api/emails/campaigns${qs(args)}`);
    case 'get_campaign':
      return api('GET', `/api/emails/campaigns/${args.campaign_id}`);
    case 'create_campaign':
      return api('POST', '/api/emails/campaigns', normalizedArgs);
    case 'activate_campaign':
      return api('POST', `/api/emails/campaigns/${args.campaign_id}/activate`);
    case 'pause_campaign':
      return api('POST', `/api/emails/campaigns/${args.campaign_id}/pause`);
    case 'enroll_contacts_in_campaign':
      return api('POST', `/api/emails/campaigns/${args.campaign_id}/enroll`, {
        contact_ids: args.contact_ids,
      });
    case 'get_campaign_contacts':
      return api(
        'GET',
        `/api/emails/campaigns/${args.campaign_id}/contacts${qs({ status: args.status })}`
      );
    case 'get_campaign_stats':
      return api('GET', `/api/emails/campaigns/${args.campaign_id}/stats`);

    case 'get_email_dashboard_metrics':
      return api('GET', `/api/emails/dashboard-metrics${qs(args)}`);
    case 'get_review_queue':
      return api('GET', '/api/emails/review-queue');
    case 'approve_email': {
      const emailId = args.email_id;
      const edits = {
        subject: args.subject,
        body: args.body,
      };
      const hasEdits = Boolean(edits.subject || edits.body);
      return api(
        'POST',
        `/api/emails/review-queue/${emailId}/approve`,
        hasEdits ? edits : undefined
      );
    }
    case 'reject_email':
      return api('POST', `/api/emails/review-queue/${args.email_id}/reject`);
    case 'approve_all_emails':
      return api('POST', '/api/emails/review-queue/approve-all', {
        email_ids: args.email_ids,
      });
    case 'send_campaign_emails':
      return api('POST', '/api/emails/send', normalizedArgs);
    case 'prepare_email_batch':
      return api('POST', '/api/emails/prepare-batch');
    case 'get_scheduled_emails':
      return api('GET', `/api/emails/scheduled-emails${qs(normalizedArgs)}`);
    case 'send_email_now':
      return api('POST', `/api/emails/scheduled-emails/${args.email_id}/send-now`);
    case 'get_active_conversations':
      return api('GET', `/api/emails/active-conversations${qs(args)}`);
    case 'get_conversation_thread':
      return api('GET', `/api/emails/conversations/${args.contact_id}/thread`);
    case 'preview_email': {
      const campaignId = args.campaign_id;
      const contactId = args.contact_id;
      const stepNumber = args.step_number;
      return api(
        'POST',
        `/api/emails/preview${qs({
          campaign_id: campaignId,
          contact_id: contactId,
          step_number: stepNumber,
        })}`
      );
    }
    case 'mark_conversation_handled':
      return api('POST', `/api/emails/conversations/${args.reply_id}/mark-handled`);

    case 'start_pipeline':
      return api('POST', `/api/pipeline/start${qs(normalizedArgs)}`);
    case 'stop_pipeline':
      return api('POST', '/api/pipeline/stop');
    case 'get_pipeline_status':
      return api('GET', '/api/pipeline/status');
    case 'run_email_discovery':
      return api('POST', `/api/pipeline/emails${qs(normalizedArgs)}`);
    case 'run_phone_discovery':
      return api('POST', `/api/pipeline/phones${qs(normalizedArgs)}`);

    case 'salesnav_person_search':
      return api('POST', '/api/salesnav/search', normalizedArgs);
    case 'salesnav_scrape_leads':
      return api('POST', '/api/salesnav/scrape-leads', normalizedArgs);
    case 'browser_health':
      return api('GET', '/api/browser/health');
    case 'browser_tabs':
      return api('GET', '/api/browser/tabs');
    case 'browser_navigate':
      return api('POST', '/api/browser/navigate', normalizedArgs);
    case 'browser_snapshot':
      return api('POST', '/api/browser/snapshot', normalizedArgs);
    case 'browser_act':
      return api('POST', '/api/browser/act', normalizedArgs);
    case 'browser_find_ref':
      return api('POST', '/api/browser/find_ref', normalizedArgs);
    case 'browser_wait':
      return api('POST', '/api/browser/wait', normalizedArgs);
    case 'browser_screenshot':
      return api('POST', '/api/browser/screenshot', normalizedArgs);
    case 'browser_extract_companies':
      return api('POST', '/api/browser/extract_companies', normalizedArgs);
    case 'browser_salesnav_search_account':
      return api('POST', '/api/browser/salesnav/search-account', normalizedArgs);

    case 'research_company':
      return api('POST', '/api/research/company', normalizedArgs);
    case 'research_person':
      return api('POST', '/api/research/person', normalizedArgs);
    case 'assess_icp_fit':
      return api('POST', '/api/research/icp-assess', normalizedArgs);

    case 'get_salesforce_auth_status':
      return api('GET', '/api/salesforce/auth-status');
    case 'trigger_salesforce_reauth':
      return api('POST', '/api/salesforce/reauth');
    case 'get_dashboard_stats':
      return api('GET', '/api/stats');

    default:
      return { error: true, message: `Unknown tool: ${toolName}` };
  }
}

function summarizeDispatch(items: ToolDispatchItem[]): string {
  if (items.length === 0) return 'No tool calls were executed.';

  const ok = items.filter((i) => i.ok);
  const failed = items.filter((i) => !i.ok);
  if (failed.length > 0) {
    const first = failed[0];
    const result = first?.result as {
      message?: string;
      detail?: unknown;
      status?: number;
      error?: unknown;
    } | undefined;
    const errorText =
      typeof result?.error === 'string'
        ? result.error
        : result?.error && typeof result.error === 'object'
          ? (
              (result.error as { message?: string; detail?: unknown }).message ||
              ((result.error as { detail?: unknown }).detail
                ? JSON.stringify((result.error as { detail?: unknown }).detail)
                : '')
            )
          : '';
    const detail =
      typeof result?.detail === 'string'
        ? result.detail
        : result?.detail
          ? JSON.stringify(result.detail)
          : '';
    const msg = result?.message || errorText || detail || 'Unknown error';
    return `Tool ${first.name} failed${result?.status ? ` (${result.status})` : ''}: ${msg}`;
  }

  if (ok.length === 1) return `Executed ${ok[0].name}.`;
  return `Executed ${ok.length} tool calls: ${ok.map((x) => x.name).join(', ')}.`;
}

export async function dispatchToolCalls(
  calls: ParsedToolCall[],
  onToolCall?: (name: string) => void
): Promise<ToolDispatchResult> {
  const allowed = new Set(TOOLS.map((t) => t.function.name));
  const stopChainOnFailure = new Set([
    'browser_health',
    'browser_tabs',
    'browser_navigate',
    'browser_snapshot',
    'browser_act',
    'browser_find_ref',
    'browser_wait',
    'browser_screenshot',
    'browser_extract_companies',
    'browser_salesnav_search_account',
  ]);
  const executed: ToolDispatchItem[] = [];
  const toolsUsed: string[] = [];
  let previousResult: unknown = null;
  const resultsByTool: Record<string, unknown> = {};

  for (const call of calls) {
    const name = call.name;
    const rawArgs = (call.args && typeof call.args === 'object' && !Array.isArray(call.args))
      ? call.args
      : {};
    const resolvedArgs = resolveTemplate(rawArgs, previousResult, resultsByTool) as Record<string, unknown>;
    const args = normalizeToolArgs(name, resolvedArgs);

    if (!allowed.has(name)) {
      executed.push({
        name,
        args,
        result: { error: true, message: `Invalid or unsupported tool call: ${name}` },
        ok: false,
      });
      continue;
    }

    toolsUsed.push(name);
    onToolCall?.(name);

    try {
      const rawResult = await executeTool(name, args);
      const result = postProcessResult(name, args, rawResult);
      const hasError = Boolean(
        result &&
        typeof result === 'object' &&
        'error' in (result as Record<string, unknown>) &&
        (result as { error?: unknown }).error
      );
      executed.push({ name, args, result, ok: !hasError });
      if (!hasError) {
        previousResult = result;
        resultsByTool[name] = result;
      } else if (stopChainOnFailure.has(name)) {
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      executed.push({
        name,
        args,
        result: { error: true, message },
        ok: false,
      });
      if (stopChainOnFailure.has(name)) {
        break;
      }
    }
  }

  const success = executed.length > 0 && executed.every((x) => x.ok);
  return {
    success,
    toolsUsed,
    executed,
    summary: summarizeDispatch(executed),
  };
}
