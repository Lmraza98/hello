import type { ChatMessage } from '../../types/chat';
import { textMsg } from '../../services/messageHelpers';
import { executeTool } from '../toolExecutor';
import { TOOLS } from '../tools';
import type { ToolCall } from '../chatEngineTypes';
import { ollamaChat, type LocalChatMessage, type LocalToolCall } from './ollamaClient';
import { TOOL_BRAIN_MODEL, TOOL_BRAIN_NAME } from './toolBrainConfig';

const MODEL = TOOL_BRAIN_MODEL;
const IS_DEVSTRAL_BRAIN = /devstral/i.test(TOOL_BRAIN_MODEL) || TOOL_BRAIN_NAME === 'qwen3';

const SYSTEM_PROMPT =
  `You are the tool-calling brain for a sales automation assistant.
Your job is to route intent, choose the right tool, and execute multi-step tool plans when needed.

Classify each request into one of: research, draft, follow_up, objection, enrichment, status, mutate, or unknown.
Think through the plan internally, then emit only function calls that advance the request.

Return only function calls when tools are needed.
For CRM lookups (find/search contact/person/lead/company) in our database, call resolve_entity or hybrid_search first.
For uploaded document/file questions, call ask_documents first (optionally search_documents to locate files).
For ask_documents, do NOT invent document_ids or filenames.
Only set document_ids when the user explicitly provides a doc reference or prior tool output returned concrete IDs.
If the reference is ambiguous, omit document_ids and search broadly.

If the user explicitly mentions live browser work (e.g. "on SalesNav", "on Sales Navigator", "on LinkedIn", provides a URL, or says navigate/click/type/screenshot),
then treat it as LIVE BROWSER AUTOMATION. Do NOT use search_contacts/search_companies/hybrid_search/resolve_entity for that.
For live browser work, prefer the generic skill-driven workflow tools:
- browser_search_and_extract
- browser_list_sub_items
If a workflow tool cannot express the request, fall back to the LeadPilot-style primitives:
- browser_health, browser_tabs, browser_navigate, browser_snapshot, browser_find_ref, browser_act, browser_wait, browser_screenshot.
Always base claims on observed page data from browser_snapshot (or structured outputs from the browser workflow tools).
Do not call auth/status/integration tools unless the user explicitly asks about auth, login, connection, token, or status.
Never claim an action happened unless you emitted a function call for it.`;

const START_FUNCTION_CALL = '<start_function_call>';
const END_FUNCTION_CALL = '<end_function_call>';
const ESCAPE_TOKEN = '<escape>';
const START_FUNCTION_RESPONSE = '<start_function_response>';
const ALLOWED_TOOL_NAMES = new Set(TOOLS.map((tool) => tool.function.name));
const TOOL_SHORTLIST_SIZE = 6;
const FUNCTIONGEMMA_HISTORY_TURNS = Number.parseInt(
  import.meta.env.VITE_FUNCTIONGEMMA_HISTORY_TURNS || '0',
  10
);
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'with', 'from', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'can', 'could',
  'would', 'should', 'please', 'me', 'my', 'we', 'you', 'your', 'our', 'this', 'that',
]);
const READ_VERBS = new Set(['find', 'search', 'lookup', 'look', 'show', 'get', 'list', 'who', 'what']);
const ACTION_VERBS = new Set([
  'add', 'create', 'delete', 'remove', 'start', 'stop', 'run', 'approve', 'reject', 'send', 'collect',
  'mark', 'trigger', 'enroll', 'pause', 'activate', 'upload', 'export',
]);

type ToolDomain = 'contact' | 'company' | 'campaign' | 'pipeline' | 'salesforce' | 'salesnav' | 'research' | 'stats' | 'document' | 'generic';

function convertToolsForOllama(tools: (typeof TOOLS)[number][]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

function buildToolSchemaBlock(tools: (typeof TOOLS)[number][]): string {
  return tools
    .map((tool) => {
      const fn = tool.function;
      const props = Object.entries(fn.parameters?.properties || {})
        .map(([k, v]) => `${k}:${(v as { type?: string }).type || 'any'}`)
        .join(', ');
      const required = Array.isArray(fn.parameters?.required) ? fn.parameters.required.join(', ') : '';
      return `- ${fn.name}(${props})${required ? ` required=[${required}]` : ''}`;
    })
    .join('\n');
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/sales\s*navigator/g, 'salesnav navigator')
    .replace(/salesnavigator/g, 'salesnav navigator')
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .split(/\s+/)
    .flatMap((token) => token.split('_'))
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function inferMessageDomains(tokens: Set<string>): Set<ToolDomain> {
  const domains = new Set<ToolDomain>();
  const has = (t: string) => tokens.has(t);

  if (has('contact') || has('contacts') || has('person') || has('people') || has('lead') || has('leads')) {
    domains.add('contact');
  }
  if (has('company') || has('companies')) domains.add('company');
  if (has('campaign') || has('email') || has('emails') || has('outreach')) domains.add('campaign');
  if (has('pipeline')) domains.add('pipeline');
  if (has('salesforce')) domains.add('salesforce');
  if (has('salesnav') || has('navigator') || has('linkedin')) domains.add('salesnav');
  if (has('research') || has('assess') || has('icp')) domains.add('research');
  if (has('stats') || has('metrics') || has('dashboard') || has('status')) domains.add('stats');
  if (has('document') || has('documents') || has('doc') || has('pdf') || has('docx') || has('file') || has('files')) domains.add('document');

  return domains;
}

function inferToolDomain(toolName: string): ToolDomain {
  const t = toolName.toLowerCase();
  if (t.includes('contact')) return 'contact';
  if (t.includes('company') || t.includes('companies')) return 'company';
  if (t.includes('campaign') || t.includes('email') || t.includes('conversation')) return 'campaign';
  if (t.includes('pipeline')) return 'pipeline';
  if (t.includes('salesforce')) return 'salesforce';
  if (t.includes('salesnav') || t.includes('linkedin')) return 'salesnav';
  if (t.includes('research') || t.includes('icp')) return 'research';
  if (t.includes('stats') || t.includes('dashboard') || t.includes('status')) return 'stats';
  if (t.includes('document')) return 'document';
  if (t.includes('ask_documents')) return 'document';
  if (t.includes('search_documents')) return 'document';
  return 'generic';
}

function toolSearchText(tool: (typeof TOOLS)[number]): string {
  const name = tool.function.name;
  const desc = tool.function.description || '';
  const params = Object.keys(tool.function.parameters?.properties || {}).join(' ');
  return `${name} ${desc} ${params}`;
}

function selectToolsForMessage(userMessage: string): (typeof TOOLS)[number][] {
  const tokenArray = tokenize(userMessage);
  const msgTokens = new Set(tokenArray);
  const msg = userMessage.toLowerCase();
  const hasNumericId = /\b\d{2,}\b/.test(userMessage);
  const mentionsId = /\b(id|contact id|company id|campaign id|reply id|email id)\b/i.test(userMessage);
  const hasReadVerb = tokenArray.some((t) => READ_VERBS.has(t));
  const hasActionVerb = tokenArray.some((t) => ACTION_VERBS.has(t));
  const messageDomains = inferMessageDomains(msgTokens);
  const salesNavCompanySearchIntent =
    /\b(sales\s*navigator|salesnav|linkedin)\b/i.test(msg) &&
    /\b(find|search|show|get)\b/i.test(msg) &&
    !/\b(scrape|decision maker|decision-makers|leads?\s+from)\b/i.test(msg);
  const liveBrowserIntent =
    /https?:\/\//i.test(msg) ||
    /\b(on\s+salesnav|on\s+sales\s*navigator|on\s+linkedin)\b/i.test(msg) ||
    /\b(browser|tab|screenshot|snapshot|navigate|open|go to|click|type|fill|scroll)\b/i.test(msg);
  const hasExplicitCompaniesInput =
    /\b(companies?|company list|these companies|selected companies)\b/i.test(msg);
  if (msgTokens.size === 0) return TOOLS;

  const scored = TOOLS.map((tool) => {
    const toolTokens = tokenize(toolSearchText(tool));
    const toolDomain = inferToolDomain(tool.function.name);
    const toolNameLower = tool.function.name.toLowerCase();
    let score = 0;
    for (const t of toolTokens) {
      if (msgTokens.has(t)) score += 1;
    }
    // Boost exact name token hits.
    const nameTokens = tool.function.name.split('_');
    for (const nt of nameTokens) {
      if (msgTokens.has(nt)) score += 2;
    }

    // Domain alignment: heavily prefer tools matching message domain.
    if (messageDomains.size > 0) {
      if (messageDomains.has(toolDomain)) {
        score += 4;
      } else if (toolDomain !== 'generic') {
        score -= 12;
      }
    }

    // For read-style requests, penalize mutating/operational tools.
    if (hasReadVerb && !hasActionVerb) {
      const likelyActionTool =
        /^(add_|create_|delete_|remove_|start_|stop_|run_|approve_|reject_|send_|collect_|mark_|trigger_|enroll_|pause_|activate_|upload_|export_|bulk_)/.test(
          toolNameLower
        );
      if (likelyActionTool) score -= 100;

      const likelyReadTool = /^(search_|get_|list_|preview_)/.test(toolNameLower);
      if (likelyReadTool) score += 6;
    }

    // Generic schema-aware gating:
    // if a tool requires any *_id parameter and user didn't provide ID signal, heavily penalize it.
    const required = tool.function.parameters?.required || [];
    const requiresIdParam = required.some((r) => /(^|_)id$/i.test(r));
    if (requiresIdParam && !hasNumericId && !mentionsId) {
      score -= 100;
    }
    const requiresCompaniesParam = required.some((r) => r === 'companies');
    if (requiresCompaniesParam && !hasExplicitCompaniesInput) {
      score -= 120;
    }

    // Intent boosts for campaign workflows to reduce no-call failures.
    if (/\bcreate\b.*\bcampaign\b|\bnew\b.*\bcampaign\b/.test(msg)) {
      if (toolNameLower === 'create_campaign') score += 200;
      if (toolNameLower === 'list_campaigns') score += 30;
    }
    if (/\badd\b.*\bto\b.*\bcampaign\b|\benroll\b/.test(msg)) {
      if (toolNameLower === 'enroll_contacts_in_campaign') score += 150;
      if (toolNameLower === 'hybrid_search') score += 80;
      if (toolNameLower === 'resolve_entity') score += 90;
      if (toolNameLower === 'list_campaigns') score += 80;
    }
    if (/\blist\b.*\bcampaign\b|\bshow\b.*\bcampaign\b/.test(msg)) {
      if (toolNameLower === 'list_campaigns') score += 150;
    }
    if (/\bsalesforce\b.*\bemail\b|\bemail\b.*\bsalesforce\b/.test(msg)) {
      if (toolNameLower === 'hybrid_search') score += 60;
      if (toolNameLower === 'get_review_queue') score += 40;
      if (toolNameLower === 'get_scheduled_emails') score += 40;
    }
    // SalesNav routing: only prefer collection when the user explicitly asks to collect/scrape.
    if (salesNavCompanySearchIntent) {
      const wantsCollect = /\b(collect|scrape|harvest|bulk|discover|ingest)\b/.test(msg);
      // Prefer the generic skill-driven workflow for interactive SalesNav searches.
      if (toolNameLower === 'browser_search_and_extract') score += wantsCollect ? -40 : 260;
      if (toolNameLower === 'collect_companies_from_salesnav') score += wantsCollect ? 220 : -120;
      if (toolNameLower === 'salesnav_scrape_leads' && !hasExplicitCompaniesInput) score -= 220;
      if (toolNameLower === 'salesnav_person_search') score -= 120;
    }

    // If the user explicitly asked to do this on SalesNav/LinkedIn (live browser),
    // strongly bias toward LeadPilot browser primitives and away from local DB search tools.
    if (liveBrowserIntent && messageDomains.has('salesnav')) {
      if (toolNameLower.startsWith('browser_')) score += 220;
      if (toolNameLower === 'browser_search_and_extract') score += 200;
      if (toolNameLower === 'browser_list_sub_items') score += 180;
      // Prefer generic workflows over legacy SalesNav-specific adapters.
      if (
        toolNameLower === 'salesnav_search_account' ||
        toolNameLower === 'salesnav_list_employees' ||
        toolNameLower === 'salesnav_extract_leads' ||
        toolNameLower === 'salesnav_person_search'
      ) {
        score -= 180;
      }
      if (toolNameLower === 'collect_companies_from_salesnav') score -= 80;
      if (toolNameLower === 'search_contacts') score -= 250;
      if (toolNameLower === 'search_companies') score -= 250;
      if (toolNameLower === 'hybrid_search') score -= 250;
      if (toolNameLower === 'resolve_entity') score -= 250;
    }

    return { tool, score };
  });

  const positive = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (positive.length === 0) {
    // Safe default shortlist to avoid exposing unrelated high-risk tools.
  const safeCore = ['resolve_entity', 'hybrid_search', 'search_contacts', 'search_companies', 'list_campaigns', 'get_dashboard_stats'];
  const docSafeCore = ['ask_documents', 'search_documents', 'get_document_summary', 'list_company_documents'];
  if (/\b(document|documents|doc|docx|pdf|file|files|attachment|uploaded)\b/i.test(userMessage)) {
    return TOOLS.filter((tool) => docSafeCore.includes(tool.function.name));
  }
  return TOOLS.filter((tool) => safeCore.includes(tool.function.name));
  }
  return positive.slice(0, TOOL_SHORTLIST_SIZE).map((s) => s.tool);
}

function getFunctionGemmaHistory(history: LocalChatMessage[]): LocalChatMessage[] {
  // Default to single-turn routing to avoid context contamination for small function-calling models.
  if (!Number.isFinite(FUNCTIONGEMMA_HISTORY_TURNS) || FUNCTIONGEMMA_HISTORY_TURNS <= 0) {
    return [];
  }
  return history.filter((m) => m.role === 'user').slice(-FUNCTIONGEMMA_HISTORY_TURNS);
}

function parseToolArgs(raw: LocalToolCall['function']['arguments']): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

type ParsedFunctionCall = {
  name: string;
  args: Record<string, unknown>;
};
export type { ParsedFunctionCall };

type ExecutedToolCall = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
};

function parseEscapedString(input: string, index: number): { value: string; nextIndex: number } {
  const start = index + ESCAPE_TOKEN.length;
  const end = input.indexOf(ESCAPE_TOKEN, start);
  if (end < 0) return { value: input.slice(start), nextIndex: input.length };
  return { value: input.slice(start, end), nextIndex: end + ESCAPE_TOKEN.length };
}

function skipWhitespace(input: string, index: number): number {
  let i = index;
  while (i < input.length && /\s/.test(input[i] || '')) i += 1;
  return i;
}

function parsePrimitive(token: string): unknown {
  const trimmed = token.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseValue(input: string, index: number): { value: unknown; nextIndex: number } {
  let i = skipWhitespace(input, index);
  if (input.startsWith(ESCAPE_TOKEN, i)) return parseEscapedString(input, i);
  const ch = input[i];
  if (ch === '{') return parseObject(input, i);
  if (ch === '[') return parseArray(input, i);

  const start = i;
  while (i < input.length && ![',', '}', ']'].includes(input[i] || '')) i += 1;
  return { value: parsePrimitive(input.slice(start, i)), nextIndex: i };
}

function parseArray(input: string, index: number): { value: unknown[]; nextIndex: number } {
  const items: unknown[] = [];
  let i = index + 1;

  while (i < input.length) {
    i = skipWhitespace(input, i);
    if (input[i] === ']') return { value: items, nextIndex: i + 1 };

    const parsed = parseValue(input, i);
    items.push(parsed.value);
    i = skipWhitespace(input, parsed.nextIndex);

    if (input[i] === ',') i += 1;
  }
  return { value: items, nextIndex: i };
}

function parseObject(input: string, index: number): { value: Record<string, unknown>; nextIndex: number } {
  const obj: Record<string, unknown> = {};
  let i = index + 1;

  while (i < input.length) {
    i = skipWhitespace(input, i);
    if (input[i] === '}') return { value: obj, nextIndex: i + 1 };

    const keyStart = i;
    while (i < input.length && input[i] !== ':' && input[i] !== '}') i += 1;
    const key = input.slice(keyStart, i).trim();
    if (!key || input[i] !== ':') return { value: obj, nextIndex: i };

    i += 1;
    const parsed = parseValue(input, i);
    obj[key] = parsed.value;
    i = skipWhitespace(input, parsed.nextIndex);
    if (input[i] === ',') i += 1;
  }
  return { value: obj, nextIndex: i };
}

function extractFunctionGemmaCalls(content: string | null): ParsedFunctionCall[] {
  if (!content) return [];

  const calls: ParsedFunctionCall[] = [];
  const pattern = new RegExp(`${START_FUNCTION_CALL}([\\s\\S]*?)${END_FUNCTION_CALL}`, 'g');
  for (const match of content.matchAll(pattern)) {
    const block = (match[1] || '').trim();
    if (!block.startsWith('call:')) continue;

    const afterPrefix = block.slice('call:'.length).trim();
    const openBraceIdx = afterPrefix.indexOf('{');
    if (openBraceIdx < 0) {
      const name = afterPrefix.trim();
      if (name) calls.push({ name, args: {} });
      continue;
    }

    const name = afterPrefix.slice(0, openBraceIdx).trim();
    const argText = afterPrefix.slice(openBraceIdx).trim();
    if (!name) continue;

    try {
      calls.push({ name, args: parseObject(argText, 0).value });
    } catch {
      calls.push({ name, args: {} });
    }
  }
  return calls;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractJsonBlocks(content: string): string[] {
  const blocks: string[] = [];

  const fenced = [...content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const m of fenced) {
    const candidate = (m[1] || '').trim();
    if (candidate.startsWith('{') || candidate.startsWith('[')) {
      blocks.push(candidate);
    }
  }

  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    blocks.push(trimmed);
  }

  return blocks;
}

function normalizeCandidateCall(obj: Record<string, unknown>): ParsedFunctionCall | null {
  const directName = typeof obj.name === 'string' ? obj.name : null;
  const directTool = typeof obj.tool === 'string' ? obj.tool : null;
  const fn =
    obj.function && typeof obj.function === 'object' && !Array.isArray(obj.function)
      ? (obj.function as Record<string, unknown>)
      : null;
  const fnName = fn && typeof fn.name === 'string' ? fn.name : null;
  const name = directName || directTool || fnName;
  if (!name) return null;

  const rawArgs =
    obj.arguments ??
    obj.args ??
    (fn ? fn.arguments : undefined) ??
    {};
  let args: Record<string, unknown> = {};
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  } else if (typeof rawArgs === 'string') {
    args = tryParseJsonObject(rawArgs) || {};
  }
  return { name, args };
}

function extractJsonStyleCalls(content: string | null): ParsedFunctionCall[] {
  if (!content) return [];
  const calls: ParsedFunctionCall[] = [];

  for (const block of extractJsonBlocks(content)) {
    let parsedAny: unknown = null;
    try {
      parsedAny = JSON.parse(block);
    } catch {
      parsedAny = null;
    }
    if (!parsedAny) continue;

    if (Array.isArray(parsedAny)) {
      for (const item of parsedAny) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const call = normalizeCandidateCall(item as Record<string, unknown>);
        if (call) calls.push(call);
      }
      continue;
    }

    if (typeof parsedAny === 'object' && !Array.isArray(parsedAny)) {
      const obj = parsedAny as Record<string, unknown>;

      const toolCalls =
        obj.tool_calls && Array.isArray(obj.tool_calls)
          ? obj.tool_calls
          : null;
      if (toolCalls) {
        for (const tc of toolCalls) {
          if (!tc || typeof tc !== 'object' || Array.isArray(tc)) continue;
          const call = normalizeCandidateCall(tc as Record<string, unknown>);
          if (call) calls.push(call);
        }
      }

      const direct = normalizeCandidateCall(obj);
      if (direct) calls.push(direct);
    }
  }

  return calls;
}

function isSafeToolCall(name: string, args: Record<string, unknown>): boolean {
  if (!ALLOWED_TOOL_NAMES.has(name)) return false;
  if (Object.prototype.hasOwnProperty.call(args, '__proto__')) return false;
  if (Object.prototype.hasOwnProperty.call(args, 'constructor')) return false;
  if (Object.prototype.hasOwnProperty.call(args, 'prototype')) return false;
  return true;
}

function formatContactLine(contact: Record<string, unknown>): string {
  const name = String(contact.name || 'Unknown');
  const title = contact.title ? ` - ${String(contact.title)}` : '';
  const company = contact.company_name ? ` @ ${String(contact.company_name)}` : '';
  const email = contact.email ? ` - ${String(contact.email)}` : '';
  return `${name}${title}${company}${email}`;
}

function summarizeToolOutcome(executed: ExecutedToolCall[]): string {
  if (executed.length === 0) return '';

  for (const call of [...executed].reverse()) {
    if (call.name !== 'search_contacts') continue;
    if (Array.isArray(call.result)) {
      const contacts = call.result as Record<string, unknown>[];
      if (contacts.length === 0) return 'I searched contacts and found no matches.';
      const top = contacts.slice(0, 5).map(formatContactLine);
      const header = contacts.length === 1 ? 'I found 1 matching contact:' : `I found ${contacts.length} matching contacts:`;
      return `${header}\n${top.map((line) => `- ${line}`).join('\n')}`;
    }
    if (typeof call.result === 'object' && call.result !== null && 'error' in (call.result as Record<string, unknown>)) {
      const msg = (call.result as { message?: string }).message || 'Unknown error';
      return `Contact search failed: ${msg}`;
    }
  }

  for (const call of [...executed].reverse()) {
    if (call.name !== 'search_companies') continue;
    if (Array.isArray(call.result)) {
      const companies = call.result as Record<string, unknown>[];
      if (companies.length === 0) return 'I searched companies and found no matches.';
      const top = companies.slice(0, 5).map((company) => String(company.company_name || 'Unknown company'));
      const header =
        companies.length === 1
          ? 'I found 1 matching company:'
          : `I found ${companies.length} matching companies:`;
      return `${header}\n${top.map((line) => `- ${line}`).join('\n')}`;
    }
  }

  const failures = executed.filter(
    (c) => typeof c.result === 'object' && c.result !== null && 'error' in c.result && Boolean((c.result as { error?: unknown }).error)
  ).length;
  const firstError = executed.find(
    (c) => typeof c.result === 'object' && c.result !== null && 'error' in c.result && Boolean((c.result as { error?: unknown }).error)
  );
  if (firstError && typeof firstError.result === 'object' && firstError.result !== null) {
    const err = firstError.result as { message?: string; detail?: unknown; status?: number };
    const detailText =
      typeof err.detail === 'string'
        ? err.detail
        : err.detail
          ? JSON.stringify(err.detail)
          : '';
    const msg = err.message || detailText;
    if (msg) {
      return `Tool ${firstError.name} failed${err.status ? ` (${err.status})` : ''}: ${msg}`;
    }
  }
  if (failures === 0) {
    if (executed.length === 1) return `Executed ${executed[0].name}.`;
    return `Executed ${executed.length} tool calls: ${executed.map((e) => e.name).join(', ')}.`;
  }
  if (failures === executed.length) return 'Tool execution failed.';
  return `Executed ${executed.length} tool calls with ${failures} failure(s).`;
}

export interface FunctionGemmaResult {
  response: string;
  messages: ChatMessage[];
  toolsUsed: string[];
  success: boolean;
  diagnostics?: {
    selectedTools: string[];
    rawContent: string | null;
    nativeToolCalls: ToolCall[];
    tokenToolCalls: ParsedFunctionCall[];
    parsedCalls?: ParsedFunctionCall[];
    failureReason?: string;
  };
}

interface RunFunctionGemmaOptions {
  executeTools?: boolean;
  forcedCalls?: ParsedFunctionCall[];
}

export async function runFunctionGemma(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  onToolCall?: (name: string) => void,
  options: RunFunctionGemmaOptions = {}
): Promise<FunctionGemmaResult> {
  const executeTools = options.executeTools ?? true;
  const selectedToolDefs = selectToolsForMessage(userMessage);
  const selectedTools = selectedToolDefs.map((tool) => tool.function.name);
  const ollamaTools = convertToolsForOllama(selectedToolDefs);
  const toolsUsed: string[] = [];
  const toolSchemaBlock = buildToolSchemaBlock(selectedToolDefs);

  const jsonModeInstruction =
    `You must output ONLY JSON.\n` +
    `If one step is enough, output: {"tool":"<tool_name>","args":{...}}\n` +
    `If multiple steps are required, output: [{"tool":"...","args":{...}}, ...]\n` +
    `Use only these tools:\n${toolSchemaBlock}\n` +
    `Do not include prose, markdown, or explanations.`;

  const baseMessages: LocalChatMessage[] = [
    { role: 'system', content: IS_DEVSTRAL_BRAIN ? `${SYSTEM_PROMPT}\n\n${jsonModeInstruction}` : SYSTEM_PROMPT },
    ...getFunctionGemmaHistory(conversationHistory),
    { role: 'user', content: userMessage },
  ];

  const runOnce = async (messages: LocalChatMessage[]) =>
    ollamaChat({
      model: MODEL,
      messages,
      ...(IS_DEVSTRAL_BRAIN ? {} : { tools: ollamaTools }),
      temperature: 0.0,
      ...(IS_DEVSTRAL_BRAIN ? {} : { stop: [START_FUNCTION_RESPONSE] }),
    });

  let rawContent: string | null = null;
  let nativeToolCalls: ToolCall[] = [];
  let tokenCalls: ParsedFunctionCall[] = [];
  let allCalls: ParsedFunctionCall[] = options.forcedCalls || [];

  if (!options.forcedCalls) {
    let result;
    try {
      result = await runOnce(baseMessages);
    } catch {
      return {
        response: '',
        messages: [],
        toolsUsed,
        success: false,
        diagnostics: {
          selectedTools,
          rawContent: null,
          nativeToolCalls: [],
          tokenToolCalls: [],
          parsedCalls: [],
          failureReason: 'ollama_error',
        },
      };
    }

    rawContent = result.message.content;
    nativeToolCalls = (result.message.tool_calls || []) as ToolCall[];
    const nativeCalls = nativeToolCalls.map((tc) => ({
      name: tc.function.name,
      args: parseToolArgs(tc.function.arguments),
    }));
    tokenCalls = extractFunctionGemmaCalls(result.message.content);
    let jsonCalls = extractJsonStyleCalls(result.message.content);
    allCalls = nativeCalls.length > 0 ? nativeCalls : tokenCalls.length > 0 ? tokenCalls : jsonCalls;

    // One retry with stricter instruction, still model-driven (no manual tool substitution).
    if (allCalls.length === 0) {
      const retryMessages: LocalChatMessage[] = [
        {
          role: 'system',
          content: IS_DEVSTRAL_BRAIN
            ? `${SYSTEM_PROMPT}\n\n${jsonModeInstruction}`
            : SYSTEM_PROMPT,
        },
        ...getFunctionGemmaHistory(conversationHistory),
        {
          role: 'user',
          content:
            IS_DEVSTRAL_BRAIN
              ? `${userMessage}\n\nReturn valid JSON only. Do not return empty output.`
              : `${userMessage}\n\nReturn a function call only. If this is live browser work (SalesNav/LinkedIn/URL/navigate/click/type), use browser_* tools. If this is a contact/company lookup in our database, call resolve_entity or hybrid_search. If this is campaign creation, call create_campaign. If this is adding someone to a campaign, call hybrid_search or list_campaigns first to gather IDs.`,
        },
      ];

      try {
        const retryResult = await runOnce(retryMessages);
        const retryNativeToolCalls = (retryResult.message.tool_calls || []) as ToolCall[];
        const retryNativeCalls = retryNativeToolCalls.map((tc) => ({
          name: tc.function.name,
          args: parseToolArgs(tc.function.arguments),
        }));
        tokenCalls = extractFunctionGemmaCalls(retryResult.message.content);
        jsonCalls = extractJsonStyleCalls(retryResult.message.content);
        allCalls = retryNativeCalls.length > 0 ? retryNativeCalls : tokenCalls.length > 0 ? tokenCalls : jsonCalls;
        rawContent = retryResult.message.content;
        nativeToolCalls = retryNativeToolCalls;
      } catch {
        // keep first pass failure diagnostics
      }
    }
  }

  if (allCalls.length === 0) {
    return {
      response: '',
      messages: [],
      toolsUsed,
      success: false,
      diagnostics: {
        selectedTools,
        rawContent,
        nativeToolCalls,
        tokenToolCalls: tokenCalls,
        parsedCalls: [],
        failureReason: 'no_tool_calls_after_retry',
      },
    };
  }

  if (!executeTools) {
    return {
      response: '',
      messages: [],
      toolsUsed: [],
      success: true,
      diagnostics: {
        selectedTools,
        rawContent,
        nativeToolCalls,
        tokenToolCalls: tokenCalls,
        parsedCalls: allCalls,
      },
    };
  }

  const executedCalls: ExecutedToolCall[] = [];
  for (const call of allCalls) {
    const toolName = call.name;
    if (!isSafeToolCall(toolName, call.args)) {
      executedCalls.push({
        name: toolName,
        args: call.args,
        result: { error: true, message: `Invalid or unsupported tool call: ${toolName}` },
      });
      continue;
    }

    toolsUsed.push(toolName);
    onToolCall?.(toolName);

    // For person lookup, a wrong company filter can hide valid matches.
    // If name+company returns empty, retry once with name-only.
    if (toolName === 'search_contacts') {
      const rawName = typeof call.args.name === 'string' ? call.args.name.trim() : '';
      const hasCompany = typeof call.args.company === 'string' && call.args.company.trim().length > 0;
      if (rawName) {
        try {
          const primary = await executeTool(toolName, call.args);
          executedCalls.push({ name: toolName, args: call.args, result: primary });

          if (hasCompany && Array.isArray(primary) && primary.length === 0) {
            const relaxedArgs: Record<string, unknown> = { name: rawName };
            const relaxed = await executeTool(toolName, relaxedArgs);
            executedCalls.push({ name: toolName, args: relaxedArgs, result: relaxed });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          executedCalls.push({ name: toolName, args: call.args, result: { error: true, message } });
        }
        continue;
      }
    }

    try {
      const toolResult = await executeTool(toolName, call.args);
      executedCalls.push({ name: toolName, args: call.args, result: toolResult });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      executedCalls.push({ name: toolName, args: call.args, result: { error: true, message } });
    }
  }

  const response = summarizeToolOutcome(executedCalls);
  return {
    response,
    messages: [textMsg(response || 'Done.')],
    toolsUsed,
    success: true,
    diagnostics: {
      selectedTools,
      rawContent,
      nativeToolCalls,
      tokenToolCalls: tokenCalls,
      parsedCalls: allCalls,
    },
  };
}
