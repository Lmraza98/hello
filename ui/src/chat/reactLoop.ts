import type { PlannedToolCall } from './chatEngineTypes';
import type { ChatAction } from './actions';
import type { LocalChatMessage } from './models/ollamaClient';
import type { PlannerRoute } from './models/plannerBackends';
import { TOOLS } from './tools';
import { classifyQueryTier, runToolPlan, selectToolNamesForMessage } from './models/toolPlanner';
import { dispatchToolCalls } from './toolExecutor';
import { elapsedMs, nowMs } from './timing';
import { checkPlanDestructive } from './planDestructiveCheck';

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
  plannerRouteOverride?: PlannerRoute;
};

export type ReActResult = {
  answer: string;
  trace: ReActStep[];
  toolsUsed: string[];
  appActions?: ChatAction[];
  pendingConfirmation?: {
    summary: string;
    uiActions?: ChatAction[];
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
  actionAttempts: Map<string, { attempts: number; lastOk: boolean }>;
  estimatedTokens: number;
  durableMemory: Array<{ key: string; content: string }>;
};

const MEMORY_KEY = 'chat_react_memory_v1';
const MEMORY_DAILY_KEY = 'chat_react_memory_daily_v1';
const ENABLE_REACT_MEMORY =
  (process.env.NEXT_PUBLIC_CHAT_REACT_MEMORY || 'false').toLowerCase() === 'true';
const REACT_TRACE_PROMPT_MAX_CHARS = Number.parseInt(process.env.NEXT_PUBLIC_CHAT_REACT_TRACE_MAX_CHARS || '1600', 10);
const REACT_STATE_SUMMARY_MAX_CHARS = Number.parseInt(process.env.NEXT_PUBLIC_CHAT_REACT_STATE_SUMMARY_MAX_CHARS || '900', 10);

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
    actionAttempts: new Map(),
    estimatedTokens: 0,
    durableMemory: [],
  };
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
    const heavyFields = ['details', 'raw', 'html', 'content', 'payload', 'trace', 'messages', 'body'];
    const hasHeavy = heavyFields.some((k) => obj[k] != null);
    if (hasHeavy) {
      const labels = heavyFields.filter((k) => obj[k] != null).join(', ');
      return `{omitted heavy fields: ${labels}}`;
    }
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

function actionKey(call: PlannedToolCall): string {
  return JSON.stringify({ name: call.name, args: call.args || {} });
}

function deduplicateActions(proposed: PlannedToolCall[], pad: Scratchpad): PlannedToolCall[] {
  const maxAttemptsFor = (name: string): number => {
    // Browser/SalesNav automation is often flaky; allow one retry.
    if (name.startsWith('browser_') || name.startsWith('salesnav_')) return 2;
    return 1;
  };
  return proposed.filter((call) => {
    const key = actionKey(call);
    const prev = pad.actionAttempts.get(key);
    if (!prev) return true;
    if (prev.lastOk) return false;
    return prev.attempts < maxAttemptsFor(call.name);
  });
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
  const tier = classifyQueryTier(goal);
  const selected = selectToolNamesForMessage(goal, undefined, tier);
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
  return limitText(sections.join('\n\n'), REACT_STATE_SUMMARY_MAX_CHARS);
}

function summarizeActionArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  let count = 0;
  for (const [key, value] of Object.entries(args || {})) {
    if (count >= 4) {
      parts.push('...');
      break;
    }
    if (value == null) {
      parts.push(`${key}=null`);
      count += 1;
      continue;
    }
    if (typeof value === 'string') {
      parts.push(`${key}="${limitText(value, 24)}"`);
      count += 1;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
      count += 1;
      continue;
    }
    if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length}]`);
      count += 1;
      continue;
    }
    parts.push(`${key}={...}`);
    count += 1;
  }
  return parts.join(', ');
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
            const actions = step.actions
              .map((a) => `${a.name}(${summarizeActionArgs(a.args || {})})`)
              .join(', ') || 'none';
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
    'For SalesNav: interpret it as LinkedIn Sales Navigator (linkedin.com/sales). Do NOT navigate to salesnav.com.',
    'For browser tools: browser_snapshot.mode must be "role" or "ai" (prefer "role").',
    'browser_act always requires ref. Even for action="press", include the ref (usually from browser_find_ref).',
    memoryContext ? `Relevant memory:\n${memoryContext}` : 'No relevant memory loaded.',
    pageContext ? `Ambient page context (metadata only, not user intent):\n${pageContext}` : 'No page context provided.',
    `Allowed tools for this request: ${allowedToolsLine}${allowedToolsSuffix}`,
    `Conversation context:\n${limitText(conversationContext, 700)}`,
    `User goal: ${pad.goal}`,
    `Reasoning trace:\n${limitText(trace, REACT_TRACE_PROMPT_MAX_CHARS)}`,
    `State summary:\n${stateSummary}`,
    'Return ONLY strict JSON tool calls. No markdown. No prose.',
    'If enough information is gathered, return an empty action list.',
  ].join('\n\n');
}

function buildDefaultAnswer(pad: Scratchpad): string {
  if (allObservedToolsAreBrowser(pad.steps)) {
    // Avoid adding an extra question; chatEngine.ts may already include a follow-up question
    // from synthesis/dispatch formatting. Keep this as an informational fallback only.
    return 'Browser session is still open.';
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
    step.actions.forEach((a) => {
      const key = actionKey(a);
      const ok = step.observations.some((o) => o.name === a.name && o.ok);
      pad.actionAttempts.set(key, { attempts: 1, lastOk: ok });
    });
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
  let accumulatedUiActions: ChatAction[] = [];
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
      // The ReAct iteration prompt already contains rich context (goal, trace, allowed tools).
      // Running the full planner (examples + filter context) with a large toolset is slow and
      // increases failure rates. Quick mode keeps tool planning responsive.
      plan = await runToolPlan(prompt, localHistory, onReasoningEvent, [...relevantToolNames], {
        quick: true,
        ...(config.plannerRouteOverride ? { plannerRouteOverride: config.plannerRouteOverride } : {}),
      });
      plannerMs += elapsedMs(plannerStartedAt);
    } catch (err) {
      onReasoningEvent?.(`Planner failed at iteration ${i + 1}.`);
      break;
    }

    if (!plan.success) {
      onReasoningEvent?.(`Planner failed at iteration ${i + 1}: ${plan.failureReason || 'unknown'}`);
      break;
    }

    let actions = plan.plannedCalls;
    const uiActions = plan.plannedUiActions || [];
    if (uiActions.length > 0) accumulatedUiActions = uiActions;
    if (actions.length === 0 && uiActions.length === 0) {
      onReasoningEvent?.('Model returned no further actions.');
      break;
    }

    const destructive = checkPlanDestructive(uiActions, actions).requiresConfirmation;

    if (uiActions.length > 0 && actions.length === 0) {
      if (requireWriteConfirmation && destructive) {
        onReasoningEvent?.('Destructive UI-only plan detected. Awaiting confirmation.');
        return {
          answer: '',
          trace: pad.steps,
          toolsUsed: [...toolsUsedSet],
          hitLimit: false,
          memoryWrites: pad.durableMemory.length > 0 ? pad.durableMemory : undefined,
          metrics: metrics(),
          pendingConfirmation: {
            summary: `Planned UI actions:\n${uiActions.map((action, idx) => `${idx + 1}. ${JSON.stringify(action)}`).join('\n')}`,
            uiActions,
            calls: [],
            traceSnapshot: [...pad.steps],
          },
        };
      }
      onReasoningEvent?.('Non-destructive UI-only plan detected. Executing without confirmation.');
      return {
        answer: '',
        trace: pad.steps,
        toolsUsed: [...toolsUsedSet],
        hitLimit: false,
        appActions: uiActions,
        memoryWrites: pad.durableMemory.length > 0 ? pad.durableMemory : undefined,
        metrics: metrics(),
      };
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

    const actionSetKey = JSON.stringify(actions.map((a) => ({
      name: a.name,
      args: a.args || {},
      attempt: pad.actionAttempts.get(actionKey(a))?.attempts || 0,
    })));
    if (seenActionSets.has(actionSetKey)) {
      onReasoningEvent?.('Detected repeated action set. Stopping loop.');
      break;
    }
    seenActionSets.add(actionSetKey);

    const thought = plan.planRationale?.length
      ? plan.planRationale.join(' ')
      : `Planned ${actions.length} action(s).`;

    if (uiActions.length > 0 && actions.length > 0 && requireWriteConfirmation && destructive) {
      onReasoningEvent?.('Destructive mixed ui_actions + tool_calls detected. Awaiting confirmation.');
      const confirmationStep: ReActStep = {
        thought,
        actions,
        observations: [],
        reflection: 'Paused for mixed UI/tool execution confirmation.',
      };
      pad.steps.push(confirmationStep);
      const summaryParts = [
        plan.constraintWarnings?.length
          ? `Constraint coverage warnings:\n${plan.constraintWarnings.map((w, idx) => `${idx + 1}. ${w}`).join('\n')}`
          : '',
        `Reasoning notes:\n1. ${thought}`,
        `Planned UI actions:\n${uiActions.map((action, idx) => `${idx + 1}. ${JSON.stringify(action)}`).join('\n')}`,
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
          uiActions,
          calls: actions,
          traceSnapshot: [...pad.steps],
        },
      };
    }

    if (requireWriteConfirmation && checkPlanDestructive([], actions).requiresConfirmation) {
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
          ...(uiActions.length > 0 ? { uiActions } : {}),
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

    dispatched.executed.forEach((x) => {
      const key = JSON.stringify({ name: x.name, args: x.args || {} });
      const prev = pad.actionAttempts.get(key);
      const attempts = (prev?.attempts || 0) + 1;
      pad.actionAttempts.set(key, { attempts, lastOk: Boolean(x.ok) });
      toolsUsedSet.add(x.name);
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
            ...(accumulatedUiActions.length > 0 ? { appActions: accumulatedUiActions } : {}),
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
        ...(accumulatedUiActions.length > 0 ? { appActions: accumulatedUiActions } : {}),
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
    ...(accumulatedUiActions.length > 0 ? { appActions: accumulatedUiActions } : {}),
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

