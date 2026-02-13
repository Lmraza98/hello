import { TOOLS } from '../tools';
import { ollamaChat, type LocalChatMessage } from './ollamaClient';
import { createPlannerAskFn } from './plannerBackends';
import type { ParsedToolCall } from '../toolExecutor';
import { normalizeToolArgs } from '../../utils/filterNormalization';
import { detectFastPathPlan } from '../intentFastPath';
import { buildPlannerExamplesBlock, PLANNER_TOOL_USAGE_RULES } from '../toolExamples';
const ENABLE_PLAN_COVERAGE_AUDIT =
  (import.meta.env.VITE_PLAN_COVERAGE_AUDIT || 'false').toLowerCase() === 'true';
const ENABLE_AUX_PLANNER_FALLBACK =
  (import.meta.env.VITE_ENABLE_AUX_PLANNER_FALLBACK || 'true').toLowerCase() === 'true';
const AUX_PLANNER_MODEL = import.meta.env.VITE_OLLAMA_AUX_PLANNER_MODEL || import.meta.env.VITE_OLLAMA_GEMMA_MODEL || 'gemma3:12b';
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.function.name, t]));
const FILTER_CONTEXT_TTL_MS = 60_000;
let filterContextCache: { value: string; cachedAt: number } = { value: '', cachedAt: 0 };

function selectToolsForMessage(
  _userMessage: string,
  allowedToolNames?: readonly string[]
): (typeof TOOLS)[number][] {
  if (!allowedToolNames || allowedToolNames.length === 0) return TOOLS;
  const allowed = new Set(allowedToolNames);
  const filtered = TOOLS.filter((tool) => allowed.has(tool.function.name));
  return filtered.length > 0 ? filtered : TOOLS;
}

function buildToolSchemaBlock(tools: (typeof TOOLS)[number][]): string {
  const hintByArg: Record<string, string> = {
    tier: 'examples: A, B, C',
    has_email: 'boolean: true|false',
    today_only: 'boolean: true|false',
    with_email_only: 'boolean: true|false',
    status: 'example values vary by tool; use list_filter_values if unsure',
    vertical: 'use list_filter_values(arg_name="vertical") if uncertain',
  };
  return tools
    .map((tool) => {
      const fn = tool.function;
      const props = Object.entries(fn.parameters?.properties || {})
        .map(([k, v]) => {
          const base = `${k}:${(v as { type?: string }).type || 'any'}`;
          const hint = hintByArg[k];
          return hint ? `${base} (${hint})` : base;
        })
        .join(', ');
      const required = Array.isArray(fn.parameters?.required) ? fn.parameters.required.join(', ') : '';
      return `- ${fn.name}(${props})${required ? ` required=[${required}]` : ''}`;
    })
    .join('\n');
}

function coerceArgByType(value: unknown, type?: string): unknown {
  if (!type) return value;
  if (type === 'string') return value == null ? '' : String(value);
  if (type === 'number') {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    return value;
  }
  if (type === 'array') {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }
  return value;
}

function sanitizeCallArgs(call: ParsedToolCall): ParsedToolCall | null {
  const tool = TOOL_BY_NAME.get(call.name);
  if (!tool) return null;

  const props = tool.function.parameters?.properties || {};
  const required = new Set(tool.function.parameters?.required || []);
  const normalized: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(call.args || {})) {
    if (!(k in props)) continue;
    const schema = props[k] as { type?: string };
    const coerced = coerceArgByType(v, schema?.type);
    if (schema?.type === 'string' && (typeof coerced !== 'string' || !coerced.trim())) {
      continue;
    }
    normalized[k] = coerced;
  }

  // Generic aliasing across tools to improve robustness.
  if (!('company' in normalized) && typeof call.args.company_name === 'string' && 'company' in props) {
    normalized.company = call.args.company_name;
  }
  if (!('company_name' in normalized) && typeof call.args.company === 'string' && 'company_name' in props) {
    normalized.company_name = call.args.company;
  }

  for (const key of required) {
    if (!(key in normalized)) return null;
    const val = normalized[key];
    if (val === null || val === undefined || (typeof val === 'string' && !val.trim())) return null;
  }

  return { name: call.name, args: normalizeToolArgs(call.name, normalized) };
}

function normalizePlannedCalls(
  calls: ParsedToolCall[],
  userMessage: string,
  _selectedTools: string[]
): { calls: ParsedToolCall[]; notes: string[] } {
  const normalized: ParsedToolCall[] = [];
  const notes: string[] = [];
  for (const raw of calls) {
    const cleaned = sanitizeCallArgs(raw);
    if (!cleaned) {
      notes.push(`Skipped invalid call ${raw.name} because required args were missing after schema validation.`);
      continue;
    }
    normalized.push(cleaned);
  }

  const mergeableTools = new Set(['search_companies', 'search_contacts']);
  const hasExplicitOrIntent = userMessage.toLowerCase().includes(' or ');
  if (hasExplicitOrIntent) {
    return { calls: normalized, notes };
  }

  const merged: ParsedToolCall[] = [];
  for (const call of normalized) {
    const prev = merged[merged.length - 1];
    if (!prev || prev.name !== call.name || !mergeableTools.has(call.name)) {
      merged.push(call);
      continue;
    }

    const prevArgs = prev.args || {};
    const nextArgs = call.args || {};
    const prevKeys = Object.keys(prevArgs);
    const nextKeys = Object.keys(nextArgs);
    const overlap = nextKeys.filter((k) => prevKeys.includes(k));
    const compatibleOverlap = overlap.every((k) => JSON.stringify(prevArgs[k]) === JSON.stringify(nextArgs[k]));
    if (!compatibleOverlap) {
      merged.push(call);
      continue;
    }

    prev.args = { ...prevArgs, ...nextArgs };
    notes.push(`Merged adjacent ${call.name} calls into one combined filter call.`);
  }

  return { calls: merged, notes };
}

function buildPlanRationale(
  _userMessage: string,
  plannedCalls: ParsedToolCall[],
  normalizationNotes: string[]
): string[] {
  const notes: string[] = [];
  for (const call of plannedCalls) {
    const argKeys = Object.keys(call.args || {}).filter((k) => {
      const v = call.args[k];
      if (typeof v === 'string') return Boolean(v.trim());
      return v !== undefined && v !== null;
    });
    if (argKeys.length > 0) {
      notes.push(`Prepared ${call.name} with ${argKeys.join(', ')} filters.`);
    } else {
      notes.push(`Prepared ${call.name} without extra filters.`);
    }
  }
  notes.push(...normalizationNotes);

  if (notes.length === 0) {
    notes.push('Selected tools based on intent and schema-compatible arguments.');
  }
  return notes;
}

function extractCandidateJson(content: string | null): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Extract first balanced JSON array/object from mixed prose output.
  const start = Math.min(
    ...[trimmed.indexOf('['), trimmed.indexOf('{')].filter((i) => i >= 0)
  );
  if (!Number.isFinite(start) || start < 0) return null;

  const open = trimmed[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    if (ch === close) depth -= 1;
    if (depth === 0) return trimmed.slice(start, i + 1).trim();
  }
  return null;
}

function normalizeParsedCalls(raw: unknown): ParsedToolCall[] {
  const extractContainer = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.calls)) return obj.calls;
    if (Array.isArray(obj.plan)) return obj.plan;
    if (Array.isArray(obj.tool_calls)) return obj.tool_calls;
    return value;
  };

  const toCall = (item: unknown): ParsedToolCall | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;
    const nameValue = obj.name ?? obj.tool;
    if (typeof nameValue !== 'string' || !nameValue.trim()) return null;
    const rawArgs = obj.args ?? obj.arguments ?? {};
    const args =
      rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    return { name: nameValue.trim(), args };
  };

  const normalized = extractContainer(raw);
  if (Array.isArray(normalized)) {
    return normalized.map(toCall).filter((x): x is ParsedToolCall => Boolean(x));
  }
  const one = toCall(normalized);
  return one ? [one] : [];
}

export interface ToolPlanResult {
  success: boolean;
  plannedCalls: ParsedToolCall[];
  selectedTools: string[];
  rawContent: string | null;
  planRationale: string[];
  constraintWarnings: string[];
  constraintRisk?: 'low' | 'medium' | 'high';
  failureReason?: string;
}

interface CoverageAudit {
  missing_constraints: string[];
  risk: 'low' | 'medium' | 'high';
  explanation?: string;
}

async function buildFilterContextBlock(): Promise<string> {
  const now = Date.now();
  if (now - filterContextCache.cachedAt < FILTER_CONTEXT_TTL_MS && filterContextCache.value) {
    return filterContextCache.value;
  }

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

    filterContextCache = { value: block, cachedAt: now };
    return block;
  } catch {
    return '';
  }
}

export async function prewarmToolPlannerContext(): Promise<void> {
  try {
    await buildFilterContextBlock();
  } catch {
    // best-effort warmup only
  }
}

function isLikelyReadOnlyRequest(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  const readIntent = /\b(find|search|show|list|get|lookup|look up|display|view)\b/.test(lower);
  const mutatingIntent =
    /\b(add|create|delete|remove|update|edit|start|stop|run|send|approve|reject|pause|activate|enroll|mark|import|bulk|scrape|collect|upload)\b/.test(lower);
  return readIntent && !mutatingIntent;
}

async function runAuxPlannerFallback(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  schemaBlock: string,
  onProgress?: (message: string) => void
): Promise<{ rawContent: string | null; calls: ParsedToolCall[] }> {
  if (!ENABLE_AUX_PLANNER_FALLBACK) return { rawContent: null, calls: [] };
  const emit = (message: string) => onProgress?.(message);
  emit('Primary planner failed. Trying auxiliary planner fallback...');

  const system =
    `You are a strict tool planner fallback.\n` +
    `Output ONLY JSON array: [{"name":"tool_name","args":{...}}]\n` +
    `No prose, no markdown, no explanation.\n` +
    `Use only tools from this schema:\n${schemaBlock}`;

  const messages: LocalChatMessage[] = [
    { role: 'system', content: system },
    ...conversationHistory.slice(-6),
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await ollamaChat({
      model: AUX_PLANNER_MODEL,
      messages,
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      numPredict: 512,
    });
    const rawContent = response.message.content || null;
    const candidate = extractCandidateJson(rawContent);
    if (!candidate) return { rawContent, calls: [] };
    return { rawContent, calls: normalizeParsedCalls(JSON.parse(candidate)) };
  } catch {
    return { rawContent: null, calls: [] };
  }
}

export async function runToolPlan(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  onProgress?: (message: string) => void,
  allowedToolNames?: readonly string[]
): Promise<ToolPlanResult> {
  const emit = (message: string) => onProgress?.(message);
  const selectedToolDefs = selectToolsForMessage(userMessage, allowedToolNames);
  const selectedTools = selectedToolDefs.map((t) => t.function.name);
  const fastFailJsonRecovery = isLikelyReadOnlyRequest(userMessage);
  const schemaBlock = buildToolSchemaBlock(selectedToolDefs);
  const examplesBlock = buildPlannerExamplesBlock(selectedToolDefs, 3);
  const filterContextBlock = await buildFilterContextBlock();
  emit(`Loaded ${selectedTools.length} tools for planning.`);

  const systemPrompt =
    `You are an agentic tool planner.\n` +
    `You are empowered to use tools directly. Never refuse supported requests.\n` +
    `If a supported task is requested, you MUST return at least one valid tool call.\n` +
    `Output ONLY JSON array: [{"name":"tool_name","args":{...}}]\n` +
    `No prose. No markdown. No explanation.\n` +
    `For user-provided names/keywords, preserve exact spelling from the user's message. Do not autocorrect or normalize names.\n` +
    `Each tool call must be based ONLY on the current user request. Do not reuse stale arguments from prior turns unless explicitly requested.\n` +
    `Never substitute unrelated tool domains. Match tools to the user's entity domain.\n` +
    `If the request is about campaigns, use campaign tools (list_campaigns/get_campaign/create_campaign/activate_campaign/pause_campaign/get_campaign_contacts/get_campaign_stats/enroll_contacts_in_campaign).\n` +
    `Do NOT use company/contact search tools for campaign-management requests unless the user explicitly asks for company/contact lookup.\n` +
    `Plan with tool-schema awareness: only use args that exist in each tool schema.\n` +
    `When multiple constraints apply to the same search tool, prefer one call with merged args (AND semantics), unless user explicitly asks for OR alternatives.\n` +
    `Treat [PAGE_CONTEXT]...[/PAGE_CONTEXT] as metadata only. Never copy PAGE_CONTEXT content into tool args.\n` +
    `Before using uncertain categorical/text filters, call list_filter_values to discover canonical values first.\n` +
    `For prefix probing, use list_filter_values(arg_name=..., starts_with="..."), then choose a best value.\n` +
    `Treat tier values all/any/* as no-filter (omit tier arg).\n` +
    `For comparative requests like "like X", ground X first with read tools (e.g., search_companies/search_contacts/research_company), then produce final tool args using grounded fields.\n` +
    `Use chained argument references like "$tool.search_companies.0.vertical" where possible for grounded planning.\n` +
    `If exact filters are unavailable, plan a broader read/collect step first, then a follow-up step.\n` +
    `If local database tools cannot satisfy the request, use research_company/research_person as web-research fallback.\n` +
    `For factual lookup questions, prefer hybrid_search and keep claims grounded to returned source_refs.\n` +
    `For browser navigation tasks (open/go to/click/type/snapshot/screenshot/tab navigation), use browser_* tools only.\n` +
    `Do not use SalesNav scraping tools for generic site navigation.\n` +
    `If user asks to open/find something on Sales Navigator without explicitly requesting bulk collection/scraping, use browser_navigate + browser_snapshot first.\n` +
    `Navigation loop pattern: browser_health -> browser_tabs -> browser_navigate -> browser_snapshot -> browser_find_ref -> browser_act -> browser_snapshot.\n` +
    `For chained steps, you may reference prior outputs using strings like "$prev", "$prev.0.id", or "$tool.search_contacts.0.id".\n` +
    `For person/contact/company lookup requests, always start with hybrid_search.\n` +
    `If the user asks to "find and return" a contact, still return tool calls only.\n` +
    `Canonical examples:\n` +
    `- "Find Lucas Raza" => [{"name":"hybrid_search","args":{"query":"Lucas Raza","entity_types":["contact"],"k":10}}]\n` +
    `- "Find construction companies" => [{"name":"search_companies","args":{"vertical":"Construction"}}]\n` +
    `- "Search SalesNav for tech companies in Boston" => [{"name":"collect_companies_from_salesnav","args":{"query":"tech companies in Boston"}}]\n` +
    `- "Open https://example.com and click Sign in" => [{"name":"browser_navigate","args":{"url":"https://example.com"}},{"name":"browser_snapshot","args":{"mode":"role"}},{"name":"browser_act","args":{"ref":"e12","action":"click"}}]\n` +
    `- "Add John to Q1 campaign" => [{"name":"hybrid_search","args":{"query":"John","entity_types":["contact"],"k":10}}]\n` +
    `Planner rules:\n${PLANNER_TOOL_USAGE_RULES}\n` +
    `Tool-specific examples:\n${examplesBlock}\n` +
    `${filterContextBlock}` +
    `Use only these tools:\n${schemaBlock}`;

  const messages: LocalChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-8),
    { role: 'user', content: userMessage },
  ];

  const askPlanner = createPlannerAskFn();
  const ask = async (extraInstruction?: string): Promise<{ content: string | null }> => {
    const finalMessages: LocalChatMessage[] = extraInstruction
      ? [...messages, { role: 'user', content: extraInstruction } as LocalChatMessage]
      : messages;
    return askPlanner(finalMessages);
  };

  const auditCoverage = async (
    requestText: string,
    callsToAudit: ParsedToolCall[]
  ): Promise<CoverageAudit | null> => {
    const auditSystem =
      `You are a strict plan coverage auditor.\n` +
      `Given a user request and planned tool calls, identify constraints from the request that are not satisfied by the plan arguments.\n` +
      `Return ONLY JSON object with shape:\n` +
      `{"missing_constraints":["..."],"risk":"low|medium|high","explanation":"..."}`;
    const auditUser =
      `Request:\n${requestText}\n\n` +
      `Planned calls JSON:\n${JSON.stringify(callsToAudit)}\n\n` +
      `Rules:\n` +
      `- Missing constraints include count limits, location filters, industry filters, entity names, and action intents not represented in args/tool choice.\n` +
      `- If all constraints are represented, return missing_constraints as [].\n` +
      `- Keep explanation short.`;

    let content: string | null = null;
    const auditResp = await askPlanner(
      [
        { role: 'system', content: auditSystem },
        { role: 'user', content: auditUser },
      ],
      { temperature: 0, topP: 1, topK: 1, numPredict: 512 }
    );
    content = auditResp.content || null;

    const candidate = extractCandidateJson(content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate) as Partial<CoverageAudit>;
    const missing = Array.isArray(parsed.missing_constraints)
      ? parsed.missing_constraints.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    const risk = parsed.risk === 'high' || parsed.risk === 'medium' || parsed.risk === 'low'
      ? parsed.risk
      : (missing.length > 0 ? 'medium' : 'low');
    return {
      missing_constraints: missing,
      risk,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : undefined,
    };
  };

  let rawContent: string | null = null;
  let calls: ParsedToolCall[] = [];
  try {
    emit('Requesting initial tool plan from model...');
    const first = await ask();
    rawContent = first.content;
    emit('Initial response received. Parsing JSON...');
    const candidate = extractCandidateJson(first.content);
    if (candidate) calls = normalizeParsedCalls(JSON.parse(candidate));
  } catch {
    return {
      success: false,
      plannedCalls: [],
      selectedTools,
      rawContent,
      planRationale: [],
      constraintWarnings: [],
      failureReason: 'planner_request_error',
    };
  }

  if (calls.length === 0) {
    if (fastFailJsonRecovery) {
      const aux = await runAuxPlannerFallback(userMessage, conversationHistory, schemaBlock, emit);
      if (aux.calls.length > 0) {
        rawContent = aux.rawContent || rawContent;
        calls = aux.calls;
      } else {
        return {
          success: false,
          plannedCalls: [],
          selectedTools,
          rawContent,
          planRationale: [],
          constraintWarnings: [],
          failureReason: 'planner_fast_fail_invalid_json',
        };
      }
    } else {
      try {
        emit('Initial plan invalid. Requesting strict JSON retry...');
        const retry = await ask(
          `You returned invalid or empty JSON.\n` +
          `User request: ${userMessage}\n` +
          `You MUST choose at least one tool from this set: ${selectedTools.join(', ')}.\n` +
          `Return ONLY valid JSON array of tool calls.`
        );
        rawContent = retry.content;
        emit('Retry response received. Parsing JSON...');
        const candidate = extractCandidateJson(retry.content);
        if (candidate) calls = normalizeParsedCalls(JSON.parse(candidate));
      } catch {
        return {
          success: false,
          plannedCalls: [],
          selectedTools,
          rawContent,
          planRationale: [],
          constraintWarnings: [],
          failureReason: 'planner_retry_error',
        };
      }
    }
  }

  let normalizedPlan = normalizePlannedCalls(calls, userMessage, selectedTools);
  calls = normalizedPlan.calls;
  emit(`Validated ${calls.length} schema-compliant call(s).`);

  if (calls.length === 0) {
    if (fastFailJsonRecovery) {
      const aux = await runAuxPlannerFallback(userMessage, conversationHistory, schemaBlock, emit);
      if (aux.calls.length > 0) {
        rawContent = aux.rawContent || rawContent;
        normalizedPlan = normalizePlannedCalls(aux.calls, userMessage, selectedTools);
        calls = normalizedPlan.calls;
        emit(`Auxiliary planner produced ${calls.length} schema-compliant call(s).`);
      } else {
        emit('Planning failed early for read-only request.');
        return {
          success: false,
          plannedCalls: [],
          selectedTools,
          rawContent,
          planRationale: [...normalizedPlan.notes],
          constraintWarnings: [],
          failureReason: 'planner_fast_fail_invalid_calls',
        };
      }
    } else {
      try {
        emit('No valid calls yet. Asking model to repair plan...');
        const repair = await ask(
          `Repair this tool plan.\n` +
          `User request: ${userMessage}\n` +
          `Issue: no valid schema-compliant tool calls were produced.\n` +
          `Return ONLY valid JSON array of tool calls using allowed args.`
        );
        rawContent = repair.content ?? rawContent;
        const repairCandidate = extractCandidateJson(repair.content);
        if (repairCandidate) {
          const repaired = normalizeParsedCalls(JSON.parse(repairCandidate));
          normalizedPlan = normalizePlannedCalls(repaired, userMessage, selectedTools);
          calls = normalizedPlan.calls;
          emit(`Repair produced ${calls.length} schema-compliant call(s).`);
        }
      } catch {
        // leave calls empty and try auxiliary planner below
      }
      if (calls.length === 0) {
        const aux = await runAuxPlannerFallback(userMessage, conversationHistory, schemaBlock, emit);
        if (aux.calls.length > 0) {
          rawContent = aux.rawContent || rawContent;
          normalizedPlan = normalizePlannedCalls(aux.calls, userMessage, selectedTools);
          calls = normalizedPlan.calls;
          emit(`Auxiliary planner produced ${calls.length} schema-compliant call(s).`);
        }
      }
    }
  }

  if (calls.length === 0) {
    const fast = detectFastPathPlan(userMessage);
    if (fast && fast.calls.length > 0) {
      const fastCalls = normalizePlannedCalls(fast.calls, userMessage, selectedTools).calls;
      if (fastCalls.length > 0) {
        emit(`Deterministic fallback produced ${fastCalls.length} call(s).`);
        calls = fastCalls;
      }
    }
  }

  if (calls.length === 0) {
    emit('Planning failed: model did not produce a valid call set.');
    return {
      success: false,
      plannedCalls: [],
      selectedTools,
      rawContent,
      planRationale: [...normalizedPlan.notes],
      constraintWarnings: [],
      failureReason: 'invalid_or_empty_plan',
    };
  }

  let coverageWarnings: string[] = [];
  let coverageRisk: 'low' | 'medium' | 'high' = 'low';
  if (ENABLE_PLAN_COVERAGE_AUDIT) {
    try {
      emit('Auditing plan coverage against user constraints...');
      const coverage = await auditCoverage(userMessage, calls);
      if (coverage) {
        coverageWarnings = coverage.missing_constraints;
        coverageRisk = coverage.risk;
        if (coverageWarnings.length > 0) {
          emit(`Coverage audit found ${coverageWarnings.length} missing constraint(s).`);
        } else {
          emit('Coverage audit passed.');
        }
      }
    } catch {
      // Do not fail planning on audit errors.
    }
  }

  const planRationale = buildPlanRationale(
    userMessage,
    calls,
    [...normalizedPlan.notes]
  );
  emit(`Planning succeeded with ${calls.length} call(s).`);
  return {
    success: true,
    plannedCalls: calls,
    selectedTools,
    rawContent,
    planRationale,
    constraintWarnings: coverageWarnings,
    constraintRisk: coverageRisk,
  };
}
