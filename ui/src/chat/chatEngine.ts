import type { ChatMessage } from '../types/chat';
import { statusMsg, textMsg } from '../services/workflows/helpers';
import { dispatchToolCalls, executeTool } from './toolExecutor';
import type { ChatCompletionMessageParam, ChatPhase, PlannedToolCall } from './chatEngineTypes';
import { routeMessage, type ModelRoute } from './router';
import { TOOL_BRAIN_MODEL, TOOL_BRAIN_NAME } from './models/toolBrainConfig';
import { recordToolFailure } from './finetuneCapture';
import { runReActLoop, resumeReActLoop, type ReActResult, type ReActStep, type ReActConfig } from './reactLoop';
import { extractUserIntentText, extractPageContext, applyRefinementRules } from './messageParsing';
import { formatDispatchMessages } from './dispatchFormatter';
import { getOllamaReadyFast, toLocalHistory } from './ollamaStatus';
import { runWithFallback } from './fallbackPipeline';
import { detectFastPathPlan, selectToolsForIntent } from './intentFastPath';
import { elapsedMs, nowMs } from './timing';

export interface ChatEngineOptions {
  conversationHistory?: ChatCompletionMessageParam[];
  onToolCall?: (toolName: string) => void;
  onPlannerEvent?: (message: string) => void;
  onModelSwitch?: (from: ModelRoute, to: ModelRoute, reason: string) => void;
  forceModel?: ModelRoute;
  phase?: ChatPhase;
  requireToolConfirmation?: boolean;
  confirmedToolCalls?: PlannedToolCall[];
  pendingPlanSummary?: string;
  _reactTrace?: ReActStep[];
  debug?: boolean;
  debugHeavy?: boolean;
}

export interface ChatEngineResult {
  response: string;
  updatedHistory: ChatCompletionMessageParam[];
  messages: ChatMessage[];
  modelUsed: ModelRoute;
  toolsUsed: string[];
  fallbackUsed: boolean;
  confirmation?: {
    required: boolean;
    summary: string;
    calls: PlannedToolCall[];
    traceSnapshot?: ReActStep[];
  };
  debugTrace?: {
    route: ModelRoute;
    routeReason: string;
    modelUsed: ModelRoute;
    toolBrainName: string;
    toolBrainModel: string;
    success: boolean;
    failureReason?: string;
    selectedTools: string[];
    nativeToolCalls: number;
    tokenToolCalls: number;
    toolsUsed: string[];
    fallbackUsed: boolean;
    modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>;
    phase: ChatPhase;
    plannedSummary?: string;
    executionTrace?: string[];
    executedCalls?: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown }>;
    reactTrace?: Array<{
      step: number;
      thought: string;
      actions: string[];
      observations: string[];
      reflection?: string;
    }>;
    reactTraceRaw?: ReActStep[];
    rawUserMessage?: string;
    intentText?: string;
    pageContext?: string;
    timings?: ChatEngineTimings;
    sizes?: {
      historyChars: number;
      localHistoryChars: number;
      promptChars: number;
    };
  };
}

interface MessageMeta {
  rawUserMessage: string;
  intentText: string;
  pageContext: string | null;
}

type ChatEngineTimings = {
  totalMs: number;
  routeMs?: number;
  reactMs?: number;
  plannerMs?: number;
  dispatchMs?: number;
  fallbackMs?: number;
  formatMs?: number;
  debugMs?: number;
};

type ChatEngineSizeMetrics = {
  historyChars: number;
  localHistoryChars: number;
  promptChars: number;
};

const CONFIRMED_READ_ONLY_FASTLANE_TOOLS = new Set<string>([
  'resolve_entity',
  'hybrid_search',
  'search_contacts',
  'get_contact',
  'search_companies',
  'list_filter_values',
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
]);

function shouldRequireToolConfirmation(calls: PlannedToolCall[], options: ChatEngineOptions): boolean {
  if (options.requireToolConfirmation === false) return false;
  const hasWriteCall = calls.some((call) => !CONFIRMED_READ_ONLY_FASTLANE_TOOLS.has(call.name));
  if (!hasWriteCall) return false;
  return options.requireToolConfirmation ?? true;
}

const ENABLE_CHAT_ENGINE_DEBUG_TRACE = (
  import.meta.env.VITE_CHAT_DEBUG ||
  import.meta.env.VITE_DEBUG_CHAT_ENGINE ||
  'false'
).toLowerCase() === 'true';
const ENABLE_CHAT_ENGINE_HEAVY_DEBUG_TRACE =
  (import.meta.env.VITE_CHAT_DEBUG_HEAVY || 'false').toLowerCase() === 'true';

function estimateChars(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function hasOpenBrowserSessionSignal(history: ChatCompletionMessageParam[]): boolean {
  const tail = history.slice(-6);
  return tail.some((m) => {
    if (m.role !== 'assistant' || typeof m.content !== 'string') return false;
    const lower = m.content.toLowerCase();
    return (
      lower.includes('browser session is still open') ||
      lower.includes('kept the session open') ||
      lower.includes('sales navigator navigation')
    );
  });
}

function isBrowserFollowUpIntent(message: string): boolean {
  const lower = message.toLowerCase();
  const strong = [
    'click',
    'open it',
    'on sales navigator',
    'in sales navigator',
    'who works there',
    'employees',
    'people at',
    'list contacts',
    'that company',
    'this company',
    'collect information',
    'dig into this',
  ];
  return strong.some((x) => lower.includes(x));
}

function buildReActDebugTrace(
  result: ReActResult,
  modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>,
  executedCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown }>,
  includeHeavy = false,
  meta?: MessageMeta
): NonNullable<ChatEngineResult['debugTrace']> {
  const debugArgsCache = new WeakMap<Record<string, unknown>, string>();
  const stringifyArgs = (args: Record<string, unknown>): string => {
    const cached = debugArgsCache.get(args);
    if (cached) return cached;
    const built = Object.entries(args)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ');
    debugArgsCache.set(args, built);
    return built;
  };
  const base: NonNullable<ChatEngineResult['debugTrace']> = {
    route: 'qwen3',
    routeReason: 'react_loop',
    modelUsed: 'qwen3',
    toolBrainName: TOOL_BRAIN_NAME,
    toolBrainModel: TOOL_BRAIN_MODEL,
    success: !result.hitLimit,
    selectedTools: [],
    nativeToolCalls: 0,
    tokenToolCalls: result.trace.reduce((sum, step) => sum + step.actions.length, 0),
    toolsUsed: result.toolsUsed,
    fallbackUsed: false,
    modelSwitches,
    phase: 'executing',
    executionTrace: executedCalls.map((call, idx) =>
      `${idx + 1}. ${call.name}(${stringifyArgs(call.args || {})}) -> ${call.ok ? 'ok' : 'failed'}`
    ),
    executedCalls,
    rawUserMessage: meta?.rawUserMessage,
    intentText: meta?.intentText,
    pageContext: meta?.pageContext || undefined,
  };

  if (!includeHeavy) return base;

  return {
    ...base,
    reactTrace: result.trace.map((step, i) => ({
      step: i + 1,
      thought: step.thought,
      actions: step.actions.map((a) => `${a.name}(${Object.keys(a.args || {}).join(',')})`),
      observations: step.observations.map((o) => `${o.name}: ${o.ok ? 'ok' : 'failed'}`),
      reflection: step.reflection,
    })),
    reactTraceRaw: result.trace,
  };
}

function reactResultToChatResult(
  result: ReActResult,
  userMessage: string,
  history: ChatCompletionMessageParam[],
  modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>,
  includeDebugTrace = false,
  includeHeavyDebug = false,
  timings?: ChatEngineTimings,
  meta?: MessageMeta
): ChatEngineResult {
  const updatedHistory: ChatCompletionMessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: result.answer || 'Executed ReAct loop.' },
  ];

  const lastObservedStep = [...result.trace].reverse().find((s) => s.observations.length > 0);
  const executed = (lastObservedStep?.observations || []).map((o) => ({
    name: o.name,
    args: o.args,
    result: o.result,
    ok: o.ok,
  }));

  const firstFailure = executed.find((x) => !x.ok);
  const failureMessage = (() => {
    if (!firstFailure || !firstFailure.result || typeof firstFailure.result !== 'object') return '';
    const obj = firstFailure.result as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message;
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error;
    if (obj.detail != null) return typeof obj.detail === 'string' ? obj.detail : JSON.stringify(obj.detail);
    return '';
  })();

  const dispatchedLike = {
    success: executed.length > 0 && executed.every((x) => x.ok),
    toolsUsed: result.toolsUsed,
    executed,
    summary:
      result.answer ||
      (firstFailure
        ? `Tool ${firstFailure.name} failed${failureMessage ? `: ${failureMessage}` : '.'}`
        : executed.length > 0
          ? 'Executed tool calls.'
          : 'No tool calls executed.'),
  };

  const formatStartedAt = nowMs();
  const richMessages = executed.length > 0
    ? formatDispatchMessages(dispatchedLike as Awaited<ReturnType<typeof dispatchToolCalls>>)
    : [];
  if (timings) {
    timings.formatMs = elapsedMs(formatStartedAt);
    timings.dispatchMs = (timings.dispatchMs || 0) + (result.metrics?.dispatchMs || 0);
    timings.plannerMs = (timings.plannerMs || 0) + (result.metrics?.plannerMs || 0);
  }
  const messages = [
    ...(result.answer?.trim() ? [textMsg(result.answer.trim())] : []),
    ...richMessages,
  ];

  let debugTrace: ChatEngineResult['debugTrace'];
  if (includeDebugTrace) {
    const debugStartedAt = nowMs();
    debugTrace = buildReActDebugTrace(result, modelSwitches, executed, includeHeavyDebug, meta);
    if (timings) {
      timings.debugMs = elapsedMs(debugStartedAt);
    }
  }

  if (result.pendingConfirmation) {
    return {
      response: '',
      updatedHistory,
      messages: messages.length > 0 ? messages : [textMsg('I prepared the next step. Confirm to continue.')],
      modelUsed: 'qwen3',
      toolsUsed: result.toolsUsed,
      fallbackUsed: false,
      confirmation: {
        required: true,
        summary: result.pendingConfirmation.summary,
        calls: result.pendingConfirmation.calls,
        traceSnapshot: result.pendingConfirmation.traceSnapshot || result.trace,
      },
      ...(debugTrace ? { debugTrace } : {}),
    };
  }

  const grounded = enforceHybridGrounding(
    result.answer || 'I completed the requested actions.',
    messages.length > 0 ? messages : [textMsg('I completed the requested actions.')],
    executed.map((call) => ({ name: call.name, result: call.result }))
  );

  return {
    response: grounded.response,
    updatedHistory,
    messages: grounded.messages,
    modelUsed: 'qwen3',
    toolsUsed: result.toolsUsed,
    fallbackUsed: false,
    ...(debugTrace ? { debugTrace } : {}),
  };
}

function buildReActConfig(
  options: ChatEngineOptions,
  pageContext?: string | null
): ReActConfig {
  return {
    maxIterations: 3,
    maxToolCalls: 10,
    iterationTimeoutMs: 30_000,
    contextTokenBudget: 6_000,
    onToolCall: options.onToolCall,
    onReasoningEvent: options.onPlannerEvent,
    requireWriteConfirmation: options.requireToolConfirmation ?? true,
    memoryDir: import.meta.env.VITE_CHAT_MEMORY_DIR || 'crm-assistant',
    pageContext: pageContext || undefined,
  };
}

function formatToolCallArgs(args: Record<string, unknown>): string {
  return Object.entries(args || {})
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ');
}

function buildPlanSummary(calls: PlannedToolCall[]): string {
  return (
    'Planned actions:\n' +
    calls
      .map((call, idx) => `${idx + 1}. ${call.name}(${formatToolCallArgs(call.args || {})})`)
      .join('\n')
  );
}

function hasSourceRefs(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const refs = (value as { source_refs?: unknown }).source_refs;
  return Array.isArray(refs) && refs.length > 0;
}

function hybridSearchHasEvidence(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const items = (result as { results?: unknown[] }).results;
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => hasSourceRefs(item));
}

function enforceHybridGrounding(
  response: string,
  messages: ChatMessage[],
  executedCalls: Array<{ name: string; result?: unknown }>
): { response: string; messages: ChatMessage[] } {
  const usedHybrid = executedCalls.some((call) => call.name === 'hybrid_search');
  if (!usedHybrid) return { response, messages };
  const hasEvidence = executedCalls
    .filter((call) => call.name === 'hybrid_search')
    .some((call) => hybridSearchHasEvidence(call.result));
  const deterministicFallbackFound = executedCalls.some((call) => {
    if (!['search_contacts', 'search_companies', 'resolve_entity'].includes(call.name)) return false;
    if (Array.isArray(call.result)) return call.result.length > 0;
    if (call.result && typeof call.result === 'object') {
      const obj = call.result as { results?: unknown[]; id?: unknown };
      if (Array.isArray(obj.results)) return obj.results.length > 0;
      return obj.id != null;
    }
    return false;
  });
  if (hasEvidence || deterministicFallbackFound) return { response, messages };

  const groundedFailure = 'I cannot verify that from local sources yet. Try refining the query or broadening filters so I can cite evidence references.';
  return { response: groundedFailure, messages: [textMsg(groundedFailure)] };
}

function extractHybridSearchResultsCount(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const list = (result as { results?: unknown[] }).results;
  return Array.isArray(list) ? list.length : 0;
}

function isCompanyLookupText(message: string): boolean {
  const lower = message.toLowerCase();
  return ['company', 'companies', 'tier', 'vertical', 'industry', 'domain'].some((token) => lower.includes(token));
}

async function withHybridZeroFallback(
  message: string,
  dispatched: Awaited<ReturnType<typeof dispatchToolCalls>>,
  onToolCall?: (toolName: string) => void
): Promise<Awaited<ReturnType<typeof dispatchToolCalls>>> {
  const hybridCall = dispatched.executed.find((item) => item.name === 'hybrid_search' && item.ok);
  if (!hybridCall) return dispatched;
  if (extractHybridSearchResultsCount(hybridCall.result) > 0) return dispatched;

  const fallbackCall: PlannedToolCall = isCompanyLookupText(message)
    ? { name: 'search_companies', args: { q: message } }
    : { name: 'search_contacts', args: { name: message } };
  const fallback = await dispatchToolCalls([fallbackCall], onToolCall);
  return {
    ...fallback,
    executed: [...dispatched.executed, ...fallback.executed],
    toolsUsed: [...dispatched.toolsUsed, ...fallback.toolsUsed],
    summary: fallback.summary || dispatched.summary,
    success: dispatched.success || fallback.success,
  };
}

async function handleToolRoute(
  userMessage: string,
  history: ChatCompletionMessageParam[],
  options: ChatEngineOptions,
  localHistory: ReturnType<typeof toLocalHistory>,
  reactConfig: ReActConfig,
  includeDebugTrace: boolean,
  includeHeavyDebug: boolean,
  timings: ChatEngineTimings,
  meta: MessageMeta
): Promise<ChatEngineResult> {
  const modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }> = [];

  if (options.confirmedToolCalls?.length) {
    const allReadOnly = options.confirmedToolCalls.every((call) =>
      CONFIRMED_READ_ONLY_FASTLANE_TOOLS.has(call.name)
    );
    if (allReadOnly) {
      const dispatchStartedAt = nowMs();
      const dispatched = await dispatchToolCalls(options.confirmedToolCalls, options.onToolCall);
      timings.dispatchMs = (timings.dispatchMs || 0) + elapsedMs(dispatchStartedAt);
      const assistantText = dispatched.summary || 'Executed confirmed actions.';
      const formatStartedAt = nowMs();
      const grounded = enforceHybridGrounding(
        assistantText,
        [textMsg(assistantText), ...formatDispatchMessages(dispatched)],
        dispatched.executed.map((x) => ({ name: x.name, result: x.result }))
      );
      timings.formatMs = (timings.formatMs || 0) + elapsedMs(formatStartedAt);
      const updatedHistory: ChatCompletionMessageParam[] = [
        ...history,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: grounded.response },
      ];
      return {
        response: grounded.response,
        updatedHistory,
        messages: grounded.messages,
        modelUsed: 'qwen3',
        toolsUsed: dispatched.toolsUsed,
        fallbackUsed: false,
        ...(includeDebugTrace ? { debugTrace: {
          route: 'qwen3',
          routeReason: 'confirmed_read_only_fastlane',
          modelUsed: 'qwen3',
          toolBrainName: TOOL_BRAIN_NAME,
          toolBrainModel: TOOL_BRAIN_MODEL,
          success: dispatched.success,
          selectedTools: [...new Set(options.confirmedToolCalls.map((x) => x.name))],
          nativeToolCalls: 0,
          tokenToolCalls: options.confirmedToolCalls.length,
          toolsUsed: dispatched.toolsUsed,
          fallbackUsed: false,
          modelSwitches,
          phase: 'executing',
          executedCalls: dispatched.executed.map((x) => ({ name: x.name, args: x.args, ok: x.ok, result: x.result })),
          rawUserMessage: meta.rawUserMessage,
          intentText: meta.intentText,
          pageContext: meta.pageContext || undefined,
        } } : {}),
      };
    }

    const result = await resumeReActLoop(
      userMessage,
      options.confirmedToolCalls,
      options._reactTrace || [],
      localHistory,
      reactConfig
    );
    return reactResultToChatResult(result, userMessage, history, modelSwitches, includeDebugTrace, includeHeavyDebug, timings, meta);
  }

  const result = await runReActLoop(
    userMessage,
    localHistory,
    reactConfig
  );
  return reactResultToChatResult(result, userMessage, history, modelSwitches, includeDebugTrace, includeHeavyDebug, timings, meta);
}

export async function processMessage(
  userMessage: string,
  options: ChatEngineOptions = {}
): Promise<ChatEngineResult> {
  const emitPlannerEvent = (msg: string) => options.onPlannerEvent?.(msg);
  const startedAt = nowMs();
  const timings: ChatEngineTimings = { totalMs: 0 };
  let sizeMetrics: ChatEngineSizeMetrics | undefined;
  const phase: ChatPhase = options.phase || 'planning';
  const history = options.conversationHistory || [];
  const intentText = extractUserIntentText(userMessage);
  const pageContext = extractPageContext(userMessage);
  const baseMessage = intentText.trim() || userMessage.trim();
  const normalizedMessage = phase === 'refining' ? applyRefinementRules(baseMessage) : baseMessage;
  const finalize = (result: ChatEngineResult): ChatEngineResult => {
    timings.totalMs = elapsedMs(startedAt);
    if (!result.debugTrace) return result;
    return {
      ...result,
      debugTrace: {
        ...result.debugTrace,
        timings: { ...timings },
        ...(sizeMetrics ? { sizes: sizeMetrics } : {}),
      },
    };
  };
  const done = (result: ChatEngineResult): ChatEngineResult => finalize(result);
  const localHistory = toLocalHistory(history);
  const historyChars = history.reduce((sum, message) => sum + estimateChars((message as { content?: unknown }).content), 0);
  const localHistoryChars = localHistory.reduce((sum, message) => sum + estimateChars(message.content), 0);
  const reactConfig = buildReActConfig(options, pageContext);
  const includeDebugTrace = options.debug ?? ENABLE_CHAT_ENGINE_DEBUG_TRACE;
  const includeHeavyDebug = includeDebugTrace && (options.debugHeavy ?? ENABLE_CHAT_ENGINE_HEAVY_DEBUG_TRACE);
  const meta: MessageMeta = { rawUserMessage: userMessage, intentText, pageContext };
  const selectedToolsForMessageCache: { value: string[] | null } = { value: null };
  const getSelectedToolsForMessage = (): string[] => {
    if (!selectedToolsForMessageCache.value) {
      selectedToolsForMessageCache.value = selectToolsForIntent(normalizedMessage);
    }
    return selectedToolsForMessageCache.value;
  };

  sizeMetrics = {
    historyChars,
    localHistoryChars,
    promptChars: normalizedMessage.length + localHistoryChars,
  };
  const browserFollowUp =
    hasOpenBrowserSessionSignal(history) &&
    isBrowserFollowUpIntent(normalizedMessage);

  if (browserFollowUp && !(options.confirmedToolCalls?.length)) {
    const followupFastPlan = detectFastPathPlan(normalizedMessage);
    if (followupFastPlan && followupFastPlan.calls.length > 0) {
      emitPlannerEvent(`Fast path matched: ${followupFastPlan.reason}.`);
      const updatedHistory: ChatCompletionMessageParam[] = [
        ...history,
        { role: 'user', content: normalizedMessage },
      ];
      if (shouldRequireToolConfirmation(followupFastPlan.calls, options)) {
        const summary = buildPlanSummary(followupFastPlan.calls);
        return done({
          response: '',
          updatedHistory,
          messages: [textMsg('Fast plan ready for confirmation.')],
          modelUsed: 'qwen3',
          toolsUsed: [],
          fallbackUsed: false,
          confirmation: {
            required: true,
            summary,
            calls: followupFastPlan.calls,
          },
          ...(includeDebugTrace ? { debugTrace: {
            route: 'qwen3',
            routeReason: 'fast_path_browser_followup',
            modelUsed: 'qwen3',
            toolBrainName: TOOL_BRAIN_NAME,
            toolBrainModel: TOOL_BRAIN_MODEL,
            success: true,
            selectedTools: getSelectedToolsForMessage(),
            nativeToolCalls: 0,
            tokenToolCalls: 0,
            toolsUsed: [],
            fallbackUsed: false,
            modelSwitches: [],
            phase,
            rawUserMessage: userMessage,
            intentText: normalizedMessage,
            pageContext: pageContext || undefined,
          } } : {}),
        });
      }
      const dispatchStartedAt = nowMs();
      const initialDispatched = await dispatchToolCalls(followupFastPlan.calls, options.onToolCall);
      const dispatched = await withHybridZeroFallback(normalizedMessage, initialDispatched, options.onToolCall);
      timings.dispatchMs = (timings.dispatchMs || 0) + elapsedMs(dispatchStartedAt);
      const assistantText = dispatched.summary || 'Executed fast path actions.';
      const formatStartedAt = nowMs();
      const grounded = enforceHybridGrounding(
        assistantText,
        [textMsg(assistantText), ...formatDispatchMessages(dispatched)],
        dispatched.executed.map((x) => ({ name: x.name, result: x.result }))
      );
      timings.formatMs = (timings.formatMs || 0) + elapsedMs(formatStartedAt);
      return done({
        response: grounded.response,
        updatedHistory: [
          ...updatedHistory,
          { role: 'assistant', content: grounded.response },
        ],
        messages: grounded.messages,
        modelUsed: 'qwen3',
        toolsUsed: dispatched.toolsUsed,
        fallbackUsed: false,
        ...(includeDebugTrace ? { debugTrace: {
          route: 'qwen3',
          routeReason: 'fast_path_browser_followup',
          modelUsed: 'qwen3',
          toolBrainName: TOOL_BRAIN_NAME,
          toolBrainModel: TOOL_BRAIN_MODEL,
          success: dispatched.success,
          selectedTools: getSelectedToolsForMessage(),
          nativeToolCalls: 0,
          tokenToolCalls: followupFastPlan.calls.length,
          toolsUsed: dispatched.toolsUsed,
          fallbackUsed: false,
          modelSwitches: [],
          phase,
          executedCalls: dispatched.executed.map((x) => ({ name: x.name, args: x.args, ok: x.ok, result: x.result })),
          rawUserMessage: userMessage,
          intentText: normalizedMessage,
          pageContext: pageContext || undefined,
        } } : {}),
      });
    }
    emitPlannerEvent('Browser follow-up detected. Enforcing tool-grounded ReAct path.');
    const reactStartedAt = nowMs();
    const result = await handleToolRoute(
      `${normalizedMessage}\n\nUse browser tools against the live page session. Do not invent results; only report observed data.`,
      history,
      options,
      localHistory,
      reactConfig,
      includeDebugTrace,
      includeHeavyDebug,
      timings,
      {
        ...meta,
        intentText: normalizedMessage,
      }
    );
    timings.reactMs = elapsedMs(reactStartedAt);
    return done(result);
  }

  if (!options.forceModel && phase === 'planning' && !(options.confirmedToolCalls?.length)) {
    const fastPlan = detectFastPathPlan(normalizedMessage);
    if (fastPlan && fastPlan.calls.length > 0) {
      emitPlannerEvent(`Fast path matched: ${fastPlan.reason}.`);
      const updatedHistory: ChatCompletionMessageParam[] = [
        ...history,
        { role: 'user', content: normalizedMessage },
      ];

      if (shouldRequireToolConfirmation(fastPlan.calls, options)) {
        const summary = buildPlanSummary(fastPlan.calls);
        return done({
          response: '',
          updatedHistory,
          messages: [textMsg('Fast plan ready for confirmation.')],
          modelUsed: 'qwen3',
          toolsUsed: [],
          fallbackUsed: false,
          confirmation: {
            required: true,
            summary,
            calls: fastPlan.calls,
          },
          ...(includeDebugTrace ? { debugTrace: {
            route: 'qwen3',
            routeReason: 'fast_path_intent',
            modelUsed: 'qwen3',
            toolBrainName: TOOL_BRAIN_NAME,
            toolBrainModel: TOOL_BRAIN_MODEL,
            success: true,
            selectedTools: getSelectedToolsForMessage(),
            nativeToolCalls: 0,
            tokenToolCalls: 0,
            toolsUsed: [],
            fallbackUsed: false,
            modelSwitches: [],
            phase,
            rawUserMessage: userMessage,
            intentText: normalizedMessage,
            pageContext: pageContext || undefined,
            sizes: sizeMetrics,
          } } : {}),
        });
      }

      const dispatchStartedAt = nowMs();
      const initialDispatched = await dispatchToolCalls(fastPlan.calls, options.onToolCall);
      const dispatched = await withHybridZeroFallback(normalizedMessage, initialDispatched, options.onToolCall);
      timings.dispatchMs = (timings.dispatchMs || 0) + elapsedMs(dispatchStartedAt);
      const assistantText = dispatched.summary || 'Executed fast path actions.';
      const formatStartedAt = nowMs();
      const grounded = enforceHybridGrounding(
        assistantText,
        [textMsg(assistantText), ...formatDispatchMessages(dispatched)],
        dispatched.executed.map((x) => ({ name: x.name, result: x.result }))
      );
      timings.formatMs = (timings.formatMs || 0) + elapsedMs(formatStartedAt);
      return done({
        response: grounded.response,
        updatedHistory: [
          ...updatedHistory,
          { role: 'assistant', content: grounded.response },
        ],
        messages: grounded.messages,
        modelUsed: 'qwen3',
        toolsUsed: dispatched.toolsUsed,
        fallbackUsed: false,
        ...(includeDebugTrace ? { debugTrace: {
          route: 'qwen3',
          routeReason: 'fast_path_intent',
          modelUsed: 'qwen3',
          toolBrainName: TOOL_BRAIN_NAME,
          toolBrainModel: TOOL_BRAIN_MODEL,
          success: dispatched.success,
          selectedTools: getSelectedToolsForMessage(),
          nativeToolCalls: 0,
          tokenToolCalls: fastPlan.calls.length,
          toolsUsed: dispatched.toolsUsed,
          fallbackUsed: false,
          modelSwitches: [],
          phase,
          executedCalls: dispatched.executed.map((x) => ({ name: x.name, args: x.args, ok: x.ok, result: x.result })),
          rawUserMessage: userMessage,
          intentText: normalizedMessage,
          pageContext: pageContext || undefined,
          sizes: sizeMetrics,
        } } : {}),
      });
    }
  }

  let route: ModelRoute;
  let routeReason: string;

  const routeStartedAt = nowMs();
  if (options.forceModel) {
    route = options.forceModel;
    routeReason = 'forced';
  } else if (!getOllamaReadyFast()) {
    route = 'openai';
    routeReason = 'ollama_unavailable';
  } else {
    const decision = routeMessage(normalizedMessage);
    route = decision.model;
    routeReason = decision.reason;
  }
  timings.routeMs = elapsedMs(routeStartedAt);
  emitPlannerEvent(`Route selected: ${routeReason} (${route}).`);

  if (options.confirmedToolCalls?.length) {
    const reactStartedAt = nowMs();
    const result = await handleToolRoute(normalizedMessage, history, options, localHistory, reactConfig, includeDebugTrace, includeHeavyDebug, timings, {
      ...meta,
      intentText: normalizedMessage,
    });
    timings.reactMs = elapsedMs(reactStartedAt);
    return done(result);
  }

  if (route === 'qwen3' || phase === 'refining') {
    emitPlannerEvent('Analyzing request and running ReAct loop...');
    try {
      const reactStartedAt = nowMs();
      const result = await handleToolRoute(normalizedMessage, history, options, localHistory, reactConfig, includeDebugTrace, includeHeavyDebug, timings, {
        ...meta,
        intentText: normalizedMessage,
      });
      timings.reactMs = elapsedMs(reactStartedAt);
      return done(result);
    } catch (err) {
      const failureReason = err instanceof Error ? err.message : 'react_loop_error';
      recordToolFailure({
        planner_model: TOOL_BRAIN_MODEL,
        user_message: normalizedMessage,
        conversation_tail: localHistory.slice(-4).map((m) => ({ role: m.role, content: m.content })),
        route_reason: routeReason,
        selected_tools: [],
        executed_tools: [],
        raw_content: '',
        native_tool_calls: [],
        token_tool_calls: [],
        failure_reason: failureReason,
        outcome: 'failed',
        recovered_by_gemma: false,
      });
      options.onModelSwitch?.('qwen3', 'gemma', 'react_loop_error');
      route = 'gemma';
      routeReason = 'react_loop_error_fallback';
    }
  }

  const fallbackStartedAt = nowMs();
  const fallbackResult = await runWithFallback(
    route,
    normalizedMessage,
    localHistory,
    history,
    options.onToolCall,
    options.onModelSwitch
  );
  timings.fallbackMs = elapsedMs(fallbackStartedAt);

  const updatedHistory: ChatCompletionMessageParam[] = [
    ...history,
    { role: 'user', content: normalizedMessage },
    { role: 'assistant', content: fallbackResult.response },
  ];

  return done({
    response: fallbackResult.response,
    updatedHistory,
    messages: fallbackResult.messages,
    modelUsed: fallbackResult.modelUsed,
    toolsUsed: fallbackResult.toolsUsed,
    fallbackUsed: fallbackResult.fallbackUsed,
    ...(includeDebugTrace ? { debugTrace: {
      route,
      routeReason,
      modelUsed: fallbackResult.modelUsed,
      toolBrainName: TOOL_BRAIN_NAME,
      toolBrainModel: TOOL_BRAIN_MODEL,
      success: fallbackResult.success,
      selectedTools: [],
      nativeToolCalls: 0,
      tokenToolCalls: 0,
      toolsUsed: fallbackResult.toolsUsed,
      fallbackUsed: fallbackResult.fallbackUsed,
      modelSwitches: fallbackResult.switches,
      phase,
      rawUserMessage: userMessage,
      intentText: normalizedMessage,
      pageContext: pageContext || undefined,
      sizes: sizeMetrics,
    } } : {}),
  });
}

export async function processAction(
  actionValue: string,
  conversationHistory: ChatCompletionMessageParam[] = []
): Promise<ChatEngineResult> {
  if (actionValue.startsWith('contact_action:')) {
    const [, action, rawContactId] = actionValue.split(':');
    const contactId = Number.parseInt(rawContactId || '', 10);

    const contextActions = new Set(['add_to_database', 'add_to_campaign', 'send_email', 'search_salesnav']);
    if (contextActions.has(action)) {
      return processMessage(`Execute action "${action}" for contact ID ${contactId}`, {
        conversationHistory,
        phase: 'planning',
      });
    }

    const directActionTool: Record<string, string> = {
      sync_salesforce: 'salesforce_search_contact',
      delete_contact: 'delete_contact',
    };
    const toolName = directActionTool[action];

    if (!toolName) {
      return {
        response: 'Unknown action.',
        updatedHistory: conversationHistory,
        messages: [textMsg('That action is not available.')],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
      };
    }

    try {
      await executeTool(toolName, { contact_id: contactId });
      return {
        response: 'Action completed.',
        updatedHistory: conversationHistory,
        messages: [statusMsg(`${action} completed for contact #${contactId}`, 'success')],
        modelUsed: 'qwen3',
        toolsUsed: [toolName],
        fallbackUsed: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        response: 'Action failed.',
        updatedHistory: conversationHistory,
        messages: [statusMsg(`Action failed: ${message}`, 'error')],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
      };
    }
  }

  if (actionValue.startsWith('section:')) {
    return {
      response: '',
      updatedHistory: conversationHistory,
      messages: [],
      modelUsed: 'qwen3',
      toolsUsed: [],
      fallbackUsed: false,
    };
  }

  return {
    response: 'Unknown action.',
    updatedHistory: conversationHistory,
    messages: [textMsg('That action is not available.')],
    modelUsed: 'qwen3',
    toolsUsed: [],
    fallbackUsed: false,
  };
}

export type { ChatCompletionMessageParam } from './chatEngineTypes';
