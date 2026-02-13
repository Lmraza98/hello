import type { PlannedToolCall } from './chatEngineTypes';
import type { LocalChatMessage } from './models/ollamaClient';
import { TOOLS } from './tools';
import { runToolPlan } from './models/toolPlanner';
import { dispatchToolCalls } from './toolExecutor';
import { selectToolsForIntent } from './intentFastPath';
import { elapsedMs, nowMs } from './timing';

export type ReActObservation = {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
};

export type ReActStep = {
  thought: string;
  actions: PlannedToolCall[];
  observations: ReActObservation[];
  reflection?: string;
};

export type ReActConfig = {
  maxIterations?: number;
  maxToolCalls?: number;
  iterationTimeoutMs?: number;
  contextTokenBudget?: number;
  onToolCall?: (toolName: string) => void;
  onReasoningEvent?: (message: string) => void;
  requireWriteConfirmation?: boolean;
  memoryContext?: string;
  memoryDir?: string;
  pageContext?: string;
};

export type ReActResult = {
  answer: string;
  trace: ReActStep[];
  toolsUsed: string[];
  pendingConfirmation?: {
    summary: string;
    calls: PlannedToolCall[];
    traceSnapshot?: ReActStep[];
  };
  hitLimit: boolean;
  memoryWrites?: Array<{ key: string; content: string }>;
  metrics?: {
    plannerMs: number;
    dispatchMs: number;
  };
};

type Scratchpad = {
  goal: string;
  steps: ReActStep[];
  totalToolCalls: number;
  findings: Map<string, string>;
  triedActions: Set<string>;
  estimatedTokens: number;
  durableMemory: Array<{ key: string; content: string }>;
};

const SAFE_READ_TOOL_NAMES = new Set<string>([
  'list_filter_values',
  'search_contacts',
  'get_contact',
  'search_companies',
  'get_pending_companies_count',
  'list_campaigns',
  'get_campaign',
  'get_campaign_contacts',
  'get_campaign_stats',
  'get_email_dashboard_metrics',
  'get_review_queue',
  'get_scheduled_emails',
  'get_active_conversations',
  'get_conversation_thread',
  'preview_email',
  'get_pipeline_status',
  'get_salesforce_auth_status',
  'get_dashboard_stats',
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

const MEMORY_KEY = 'chat_react_memory_v1';
const MEMORY_DAILY_KEY = 'chat_react_memory_daily_v1';
const ENABLE_REACT_MEMORY =
  (import.meta.env.VITE_CHAT_REACT_MEMORY || 'false').toLowerCase() === 'true';

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function isBrowserTool(name: string): boolean {
  return name.startsWith('browser_');
}

function shouldStopAfterBrowserClick(goal: string, observations: ReActObservation[]): boolean {
  const lowerGoal = goal.toLowerCase();
  const clickIntent = /\bclick\b/.test(lowerGoal);
  if (!clickIntent) return false;
  return observations.some((o) => {
    if (o.name !== 'browser_act' || !o.ok) return false;
    const action = String(o.args?.action || '').toLowerCase();
    if (action !== 'click') return false;
    if (!o.result || typeof o.result !== 'object') return false;
    const url = String((o.result as Record<string, unknown>).url || '');
    if (!url) return true;
    return !url.includes('/sales/search/');
  });
}

function allObservedToolsAreBrowser(steps: ReActStep[]): boolean {
  const obs = steps.flatMap((s) => s.observations);
  if (obs.length === 0) return false;
  return obs.every((o) => isBrowserTool(o.name));
}

function memoryKey(base: string, namespace: string): string {
  const safe = namespace.trim() ? namespace.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_') : 'default';
  return `${base}:${safe}`;
}

function createScratchpad(goal: string): Scratchpad {
  return {
    goal,
    steps: [],
    totalToolCalls: 0,
    findings: new Map(),
    triedActions: new Set(),
    estimatedTokens: 0,
    durableMemory: [],
  };
}

function summarizeExtractedCompanies(observations: ReActObservation[]): string | null {
  const extractObs = observations.find((o) => o.name === 'browser_extract_companies' && o.ok);
  if (!extractObs || !extractObs.result || typeof extractObs.result !== 'object') return null;
  const obj = extractObs.result as Record<string, unknown>;
  const companies = Array.isArray(obj.companies) ? (obj.companies as Array<Record<string, unknown>>) : [];
  if (companies.length === 0) return null;
  const top = companies
    .slice(0, 3)
    .map((c) => String(c?.name || '').trim())
    .filter((x) => x.length > 0);
  if (top.length === 0) return null;
  return `I found these top account matches: ${top.join(', ')}. The browser session is still open. What do you want to do next?`;
}

function compactJSON(value: unknown, maxLen = 480): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return value.slice(0, maxLen);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const preview = value.slice(0, 3).map((v) => compactJSON(v, 120));
    const suffix = value.length > 3 ? `, ... (${value.length} total)` : '';
    return `[${preview.join(', ')}${suffix}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = ['name', 'company_name', 'person', 'company', 'title', 'email', 'industry', 'vertical', 'location', 'answer', 'error'];
    const picked: string[] = [];
    for (const k of keys) {
      if (obj[k] != null) picked.push(`${k}: ${compactJSON(obj[k], 90)}`);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) picked.push(`${k}: [${v.length} items]`);
    }
    if (picked.length > 0) return `{${picked.join(', ')}}`;
    const raw = JSON.stringify(obj);
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}...` : raw;
  }
  return String(value).slice(0, maxLen);
}

function summarizeResult(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} row(s)`;
  if (!value || typeof value !== 'object') return value == null ? 'empty' : typeof value;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.items)) return `${obj.items.length} item(s)`;
  if (Array.isArray(obj.results)) return `${obj.results.length} result(s)`;
  if (Array.isArray(obj.companies)) return `${obj.companies.length} company(s)`;
  if (Array.isArray(obj.profiles)) return `${obj.profiles.length} profile(s)`;
  if (obj.error) return 'error';
  return 'object';
}

function isEmptyLike(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.items)) return obj.items.length === 0;
  if (Array.isArray(obj.results)) return obj.results.length === 0;
  if (Array.isArray(obj.companies)) return obj.companies.length === 0;
  if (Array.isArray(obj.profiles)) return obj.profiles.length === 0;
  return false;
}

function isWriteCall(call: PlannedToolCall): boolean {
  return !SAFE_READ_TOOL_NAMES.has(call.name);
}

function actionKey(call: PlannedToolCall): string {
  return JSON.stringify({ name: call.name, args: call.args || {} });
}

function deduplicateActions(proposed: PlannedToolCall[], pad: Scratchpad): PlannedToolCall[] {
  return proposed.filter((call) => !pad.triedActions.has(actionKey(call)));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compactSteps(steps: ReActStep[]): ReActStep[] {
  const recentLimit = 2;
  if (steps.length <= recentLimit) return steps;
  const older = steps.slice(0, -recentLimit).map((step) => ({
    thought: step.thought.length > 140 ? `${step.thought.slice(0, 140)}...` : step.thought,
    actions: step.actions,
    observations: step.observations.map((o) => ({
      ...o,
      result: summarizeResult(o.result),
    })),
    reflection: step.reflection && step.reflection.length > 180 ? `${step.reflection.slice(0, 180)}...` : step.reflection,
  }));
  return [...older, ...steps.slice(-recentLimit)];
}

function getMemory(namespace: string): Array<{ key: string; content: string }> {
  if (!ENABLE_REACT_MEMORY || !hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(memoryKey(MEMORY_KEY, namespace));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMemory(entries: Array<{ key: string; content: string }>, namespace: string): void {
  if (!ENABLE_REACT_MEMORY || !hasLocalStorage()) return;
  try {
    localStorage.setItem(memoryKey(MEMORY_KEY, namespace), JSON.stringify(entries.slice(-500)));
  } catch {
    // ignore
  }
}

function recallMemory(query: string, limit = 5, namespace = 'default'): string {
  const qWords = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2);
  if (qWords.length === 0) return '';

  const scored = getMemory(namespace)
    .map((entry) => {
      const text = `${entry.key} ${entry.content}`.toLowerCase();
      const score = qWords.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => `- ${x.entry.key}: ${x.entry.content}`)
    .join('\n');

  return scored;
}

function appendDaily(entries: Array<{ key: string; content: string }>, namespace: string): void {
  if (entries.length === 0) return;
  if (!ENABLE_REACT_MEMORY || !hasLocalStorage()) return;
  try {
    const raw = localStorage.getItem(memoryKey(MEMORY_DAILY_KEY, namespace));
    const existing = raw ? (JSON.parse(raw) as Array<{ ts: string; key: string; content: string }>) : [];
    const now = new Date().toISOString();
    const merged = [...existing, ...entries.map((e) => ({ ts: now, ...e }))].slice(-1000);
    localStorage.setItem(memoryKey(MEMORY_DAILY_KEY, namespace), JSON.stringify(merged));
  } catch {
    // ignore
  }
}

function persistMemoryWrites(entries: Array<{ key: string; content: string }>, namespace: string): void {
  if (entries.length === 0) return;
  if (!ENABLE_REACT_MEMORY || !hasLocalStorage()) return;
  const current = getMemory(namespace);
  const byKey = new Map(current.map((e) => [e.key.toLowerCase(), e] as const));
  for (const entry of entries) {
    byKey.set(entry.key.toLowerCase(), entry);
  }
  saveMemory([...byKey.values()], namespace);
  appendDaily(entries, namespace);
}

function selectRelevantToolNames(goal: string): Set<string> {
  const selected = selectToolsForIntent(goal);
  return new Set(selected);
}

function formatToolPlanSummary(calls: PlannedToolCall[]): string {
  if (calls.length === 0) return 'No tool calls proposed.';
  const steps = calls.map((call, idx) => {
    const args = Object.entries(call.args || {})
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    return `${idx + 1}. ${call.name}${args ? `(${args})` : '()'}`;
  });
  return `Planned actions:\n${steps.join('\n')}`;
}

function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function buildStateSummary(pad: Scratchpad): string {
  const findingLines = [...pad.findings.entries()]
    .slice(0, 8)
    .map(([key, value]) => `- ${key}: ${value}`);
  const recentSteps = pad.steps
    .slice(-2)
    .map((step, idx) => {
      const actionNames = step.actions.map((a) => a.name).join(', ') || 'none';
      const ok = step.observations.filter((o) => o.ok).length;
      const failed = step.observations.filter((o) => !o.ok).length;
      return `${idx + 1}. actions=[${actionNames}] ok=${ok} failed=${failed}`;
    });

  const sections = [
    `Total steps: ${pad.steps.length}`,
    `Total tool calls: ${pad.totalToolCalls}`,
    `Recent step stats:\n${recentSteps.length > 0 ? recentSteps.join('\n') : 'none'}`,
    `Top findings:\n${findingLines.length > 0 ? findingLines.join('\n') : 'none'}`,
  ];
  return limitText(sections.join('\n\n'), 1200);
}

function buildIterationPrompt(
  pad: Scratchpad,
  conversationContext: string,
  memoryContext: string,
  relevantToolNames: Set<string>,
  pageContext?: string
): string {
  const display = compactSteps(pad.steps).slice(-2);
  const trace =
    display.length === 0
      ? 'No actions taken yet.'
      : display
          .map((step, i) => {
            const actions = step.actions.map((a) => `${a.name}(${JSON.stringify(a.args || {})})`).join(', ') || 'none';
            const obs = step.observations.map((o) => `${o.name}: ${o.ok ? 'ok' : 'failed'} => ${compactJSON(o.result, 180)}`).join('\n');
            return `Step ${i + 1}\nThought: ${step.thought}\nActions: ${actions}\nObservations:\n${obs || 'none'}\nReflection: ${step.reflection || ''}`;
          })
          .join('\n\n');

  const stateSummary = buildStateSummary(pad);

  const sortedTools = [...relevantToolNames].sort();
  const allowedToolsLine = sortedTools.slice(0, 20).join(', ');
  const allowedToolsSuffix =
    sortedTools.length > 20 ? `, ... (+${sortedTools.length - 20} more)` : '';

  return [
    'You are a sales CRM assistant using a ReAct loop.',
    'Think step-by-step, choose tool calls, observe results, and adapt.',
    'You have the required tools. Do not refuse supported requests.',
    'Use only the current user goal for new tool arguments unless the user explicitly references prior results.',
    memoryContext ? `Relevant memory:\n${memoryContext}` : 'No relevant memory loaded.',
    pageContext ? `Ambient page context (metadata only, not user intent):\n${pageContext}` : 'No page context provided.',
    `Allowed tools for this request: ${allowedToolsLine}${allowedToolsSuffix}`,
    `Conversation context:\n${limitText(conversationContext, 700)}`,
    `User goal: ${pad.goal}`,
    `Reasoning trace:\n${trace}`,
    `State summary:\n${stateSummary}`,
    'Return ONLY strict JSON tool calls. No markdown. No prose.',
    'If enough information is gathered, return an empty action list.',
  ].join('\n\n');
}

function buildDefaultAnswer(pad: Scratchpad): string {
  if (allObservedToolsAreBrowser(pad.steps)) {
    return 'I completed the browser navigation and kept the session open. What do you want to do next?';
  }
  if (pad.findings.size > 0) {
    const lines = [...pad.findings.entries()].slice(0, 6).map(([k, v]) => `- ${k}: ${v}`);
    return `Here is what I found:\n${lines.join('\n')}`;
  }
  const obs = pad.steps.flatMap((s) => s.observations);
  if (obs.length === 0) return 'I could not find a valid next action.';
  const failures = obs.filter((o) => !o.ok).length;
  if (failures > 0) return `I ran tools but hit errors in ${failures} step(s).`;
  return 'I completed the requested actions.';
}

function updateFindingsFromObservations(pad: Scratchpad, observations: ReActObservation[]): void {
  for (const obs of observations) {
    if (!obs.ok || obs.result == null || typeof obs.result !== 'object') continue;
    const obj = obs.result as Record<string, unknown>;
    const scalars: Array<[string, unknown]> = [
      ['company', obj.company],
      ['person', obj.person],
      ['name', obj.name],
      ['industry', obj.industry],
      ['vertical', obj.vertical],
      ['location', obj.location],
      ['answer', obj.answer],
      ['summary', obj.summary],
    ];
    for (const [key, value] of scalars) {
      if (typeof value === 'string' && value.trim()) {
        pad.findings.set(`${obs.name}.${key}`, value.trim().slice(0, 260));
      }
    }
    if (Array.isArray(obj.results) && obj.results.length > 0) {
      pad.findings.set(`${obs.name}.results`, `${obj.results.length} results`);
    }
    if (Array.isArray(obj.items) && obj.items.length > 0) {
      pad.findings.set(`${obs.name}.items`, `${obj.items.length} items`);
    }
    if (Array.isArray(obj.companies) && obj.companies.length > 0) {
      pad.findings.set(`${obs.name}.companies`, `${obj.companies.length} companies`);
      if (obs.name === 'browser_extract_companies') {
        const top = (obj.companies as Array<Record<string, unknown>>)
          .slice(0, 3)
          .map((x) => String(x?.name || '').trim())
          .filter((x) => x.length > 0);
        if (top.length > 0) {
          pad.findings.set('browser_extract_companies.top_names', top.join(', '));
        }
      }
    }
  }
}

function buildReflection(observations: ReActObservation[]): string {
  const ok = observations.filter((o) => o.ok).length;
  const failed = observations.filter((o) => !o.ok).length;
  const hasData = observations.some((o) => o.ok && !isEmptyLike(o.result));
  if (failed > 0) return `Observed ${failed} failed call(s). Adjust arguments or pick an alternative tool.`;
  if (hasData) return `Observed usable data from ${ok} successful call(s).`;
  return 'Observed mostly empty data. Try a structurally different retrieval step.';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function runLoopCore(
  userMessage: string,
  localHistory: LocalChatMessage[],
  config: ReActConfig,
  seedTrace: ReActStep[] = [],
  remainingIterations?: number
): Promise<ReActResult> {
  const maxIterations = remainingIterations ?? config.maxIterations ?? 3;
  const maxToolCalls = config.maxToolCalls ?? 10;
  const iterationTimeoutMs = config.iterationTimeoutMs ?? 30_000;
  const contextTokenBudget = config.contextTokenBudget ?? 6_000;
  const onReasoningEvent = config.onReasoningEvent;
  const onToolCall = config.onToolCall;
  const requireWriteConfirmation = config.requireWriteConfirmation ?? true;
  const memoryNamespace = config.memoryDir || 'default';

  const pad = createScratchpad(userMessage);
  pad.steps = [...seedTrace];
  for (const step of seedTrace) {
    step.actions.forEach((a) => pad.triedActions.add(actionKey(a)));
    pad.totalToolCalls += step.actions.length;
    updateFindingsFromObservations(pad, step.observations);
  }

  const relevantToolNames = selectRelevantToolNames(userMessage);
  onReasoningEvent?.(`Selected ${relevantToolNames.size}/${TOOLS.length} relevant tools.`);

  const memoryContext = config.memoryContext || recallMemory(userMessage, 5, memoryNamespace);
  const pageContext = config.pageContext?.trim() || '';
  if (memoryContext) {
    onReasoningEvent?.('Loaded relevant memories from previous sessions.');
  }

  const recentHistory = localHistory.slice(-6);
  const conversationContext =
    recentHistory.length === 0
      ? 'No prior conversation.'
      : recentHistory
          .map((m) => `${m.role}: ${(m.content || '').slice(0, 320)}`)
          .join('\n');

  const toolsUsedSet = new Set<string>(seedTrace.flatMap((s) => s.actions.map((a) => a.name)));
  const seenActionSets = new Set<string>(
    seedTrace.map((s) => JSON.stringify(s.actions.map((a) => ({ name: a.name, args: a.args || {} }))))
  );
  let plannerMs = 0;
  let dispatchMs = 0;
  const metrics = () => ({ plannerMs, dispatchMs });

  for (let i = 0; i < maxIterations; i++) {
    onReasoningEvent?.(`ReAct iteration ${i + 1}/${maxIterations}: planning next actions...`);

    const prompt = buildIterationPrompt(pad, conversationContext, memoryContext, relevantToolNames, pageContext);
    pad.estimatedTokens = estimateTokens(prompt);
    if (pad.estimatedTokens > contextTokenBudget) {
      onReasoningEvent?.('Context nearing budget. Compacting older observations...');
      if (pad.findings.size > 0) {
        const entries = [...pad.findings.entries()].map(([key, content]) => ({ key, content }));
        appendDaily(entries, memoryNamespace);
        onReasoningEvent?.('Flushed findings to daily memory log before compaction.');
      }
    }

    let plan;
    try {
      // Do not timeout-race planner calls. If a timeout wins, the underlying
      // planner still emits events and can finish, producing contradictory logs.
      const plannerStartedAt = nowMs();
      plan = await runToolPlan(prompt, localHistory, onReasoningEvent, [...relevantToolNames]);
      plannerMs += elapsedMs(plannerStartedAt);
    } catch (err) {
      onReasoningEvent?.(`Planner failed at step ${i + 1}.`);
      break;
    }

    if (!plan.success) {
      onReasoningEvent?.(`Planner failed at step ${i + 1}: ${plan.failureReason || 'unknown'}`);
      break;
    }

    let actions = plan.plannedCalls;
    if (actions.length === 0) {
      onReasoningEvent?.('Model returned no further actions.');
      break;
    }

    actions = actions.filter((a) => relevantToolNames.has(a.name));
    if (actions.length === 0) {
      onReasoningEvent?.('Planned actions were outside current relevant tool set.');
      break;
    }

    actions = deduplicateActions(actions, pad);
    if (actions.length === 0) {
      onReasoningEvent?.('All proposed actions already tried.');
      break;
    }

    const actionSetKey = JSON.stringify(actions.map((a) => ({ name: a.name, args: a.args || {} })));
    if (seenActionSets.has(actionSetKey)) {
      onReasoningEvent?.('Detected repeated action set. Stopping loop.');
      break;
    }
    seenActionSets.add(actionSetKey);

    const thought = plan.planRationale?.length
      ? plan.planRationale.join(' ')
      : `Planned ${actions.length} action(s).`;

    if (requireWriteConfirmation && actions.some(isWriteCall)) {
      onReasoningEvent?.('Write operation detected. Awaiting confirmation.');
      const confirmationStep: ReActStep = {
        thought,
        actions,
        observations: [],
        reflection: 'Paused for write confirmation.',
      };
      pad.steps.push(confirmationStep);

      const summaryParts = [
        plan.constraintWarnings?.length
          ? `Constraint coverage warnings:\n${plan.constraintWarnings.map((w, idx) => `${idx + 1}. ${w}`).join('\n')}`
          : '',
        `Reasoning notes:\n1. ${thought}`,
        formatToolPlanSummary(actions),
      ].filter(Boolean);

      return {
        answer: '',
        trace: pad.steps,
        toolsUsed: [...toolsUsedSet],
        hitLimit: false,
        memoryWrites: pad.durableMemory.length > 0 ? pad.durableMemory : undefined,
        metrics: metrics(),
        pendingConfirmation: {
          summary: summaryParts.join('\n\n'),
          calls: actions,
          traceSnapshot: [...pad.steps],
        },
      };
    }

    const budgetRemaining = maxToolCalls - pad.totalToolCalls;
    const cappedActions = actions.slice(0, Math.max(1, budgetRemaining));
    pad.totalToolCalls += cappedActions.length;

    if (pad.totalToolCalls > maxToolCalls) {
      onReasoningEvent?.(`Tool call budget exceeded (${maxToolCalls}).`);
      break;
    }

    onReasoningEvent?.(`Executing ${cappedActions.length} tool call(s): ${cappedActions.map((a) => a.name).join(', ')}`);

    let dispatched;
    try {
      const dispatchStartedAt = nowMs();
      dispatched = await withTimeout(dispatchToolCalls(cappedActions, onToolCall), iterationTimeoutMs, `react-exec-${i + 1}`);
      dispatchMs += elapsedMs(dispatchStartedAt);
    } catch {
      pad.steps.push({
        thought,
        actions: cappedActions,
        observations: cappedActions.map((a) => ({ name: a.name, args: a.args || {}, ok: false, result: 'Execution timed out.' })),
        reflection: 'Tool execution timed out.',
      });
      break;
    }

    const observations: ReActObservation[] = dispatched.executed.map((x) => ({
      name: x.name,
      args: x.args,
      ok: x.ok,
      result: x.result,
    }));

    cappedActions.forEach((a) => {
      pad.triedActions.add(actionKey(a));
      toolsUsedSet.add(a.name);
    });

    updateFindingsFromObservations(pad, observations);
    const reflection = buildReflection(observations);

    pad.steps.push({
      thought,
      actions: cappedActions,
      observations,
      reflection,
    });

    const hasErrors = observations.some((o) => !o.ok);
    const hasUsefulData = observations.some((o) => o.ok && !isEmptyLike(o.result));

    if (hasErrors) {
      onReasoningEvent?.('Observed tool errors. Continuing to adapt...');
      continue;
    }

    if (hasUsefulData) {
      const allBrowser = observations.length > 0 && observations.every((o) => isBrowserTool(o.name));
      if (allBrowser) {
        if (shouldStopAfterBrowserClick(userMessage, observations)) {
          return {
            answer: 'Done. I clicked it and kept the browser session open. What should I do next?',
            trace: pad.steps,
            toolsUsed: [...toolsUsedSet],
            hitLimit: false,
            memoryWrites: pad.durableMemory.length > 0 ? pad.durableMemory : undefined,
            metrics: metrics(),
          };
        }
        onReasoningEvent?.('Observed browser state. Continuing navigation loop...');
        continue;
      }
      onReasoningEvent?.('Observed useful data. Returning for rendering/next-step.');
      return {
        answer: '',
        trace: pad.steps,
        toolsUsed: [...toolsUsedSet],
        hitLimit: false,
        memoryWrites: pad.durableMemory.length > 0 ? pad.durableMemory : undefined,
        metrics: metrics(),
      };
    }
  }

  const synthesized = buildDefaultAnswer(pad);
  const derivedMemory = [...pad.findings.entries()]
    .slice(0, 6)
    .map(([key, content]) => ({ key, content }));
  if (derivedMemory.length > 0) {
    persistMemoryWrites(derivedMemory, memoryNamespace);
    pad.durableMemory.push(...derivedMemory);
  }

  return {
    answer: synthesized,
    trace: pad.steps,
    toolsUsed: [...new Set(pad.steps.flatMap((s) => s.actions.map((a) => a.name)))],
    hitLimit: true,
    memoryWrites: pad.durableMemory.length > 0 ? pad.durableMemory : undefined,
    metrics: metrics(),
  };
}

export async function runReActLoop(
  userMessage: string,
  localHistory: LocalChatMessage[],
  config: ReActConfig
): Promise<ReActResult> {
  return runLoopCore(userMessage, localHistory, config);
}

export async function resumeReActLoop(
  userMessage: string,
  confirmedCalls: PlannedToolCall[],
  previousTrace: ReActStep[],
  localHistory: LocalChatMessage[],
  config: ReActConfig
): Promise<ReActResult> {
  const dispatchStartedAt = nowMs();
  const dispatched = await withTimeout(
    dispatchToolCalls(confirmedCalls, config.onToolCall),
    config.iterationTimeoutMs ?? 30_000,
    'react-resume-exec'
  );
  const dispatchMs = elapsedMs(dispatchStartedAt);

  const resumeStep: ReActStep = {
    thought: 'Executing user-confirmed actions.',
    actions: confirmedCalls,
    observations: dispatched.executed.map((x) => ({
      name: x.name,
      args: x.args,
      ok: x.ok,
      result: x.result,
    })),
    reflection: dispatched.success ? 'Confirmed actions succeeded.' : 'Some confirmed actions failed.',
  };

  const seedTrace = [...previousTrace, resumeStep];
  const extractedSummary = summarizeExtractedCompanies(resumeStep.observations);
  if (extractedSummary) {
    return {
      answer: extractedSummary,
      trace: seedTrace,
      toolsUsed: [...new Set(seedTrace.flatMap((s) => s.actions.map((a) => a.name)))],
      hitLimit: false,
      metrics: { plannerMs: 0, dispatchMs },
    };
  }
  const useful = resumeStep.observations.some((o) => o.ok && !isEmptyLike(o.result));
  const errors = resumeStep.observations.some((o) => !o.ok);

  if (errors) {
    return {
      answer: '',
      trace: seedTrace,
      toolsUsed: [...new Set(seedTrace.flatMap((s) => s.actions.map((a) => a.name)))],
      hitLimit: false,
      metrics: { plannerMs: 0, dispatchMs },
    };
  }

  if (useful) {
    const allBrowser = resumeStep.observations.length > 0 && resumeStep.observations.every((o) => isBrowserTool(o.name));
    if (!allBrowser) {
      return {
        answer: '',
        trace: seedTrace,
        toolsUsed: [...new Set(seedTrace.flatMap((s) => s.actions.map((a) => a.name)))],
        hitLimit: false,
        metrics: { plannerMs: 0, dispatchMs },
      };
    }
  }

  const resumed = await runLoopCore(
    userMessage,
    localHistory,
    config,
    seedTrace,
    Math.max((config.maxIterations ?? 3) - 1, 1)
  );
  return {
    ...resumed,
    metrics: {
      plannerMs: (resumed.metrics?.plannerMs || 0),
      dispatchMs: dispatchMs + (resumed.metrics?.dispatchMs || 0),
    },
  };
}
