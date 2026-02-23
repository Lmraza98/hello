/**
 * Dispatch-backed response builder used by fast-path and confirmed read-only lanes.
 *
 * Phase 2A: direct extraction of the existing dispatchPlanAndBuildResult pipeline.
 */

import type { ChatMessage } from '../../types/chat';
import { textMsg } from '../../services/messageHelpers';
import type { ChatCompletionMessageParam, ChatPhase, PlannedToolCall } from '../chatEngineTypes';
import type { ChatAction } from '../actions';
import type { ModelRoute } from '../router';
import { dispatchToolCalls } from '../toolExecutor';
import { formatDispatchMessages } from '../dispatchFormatter';
import { enforceHybridGrounding } from '../chatGrounding';
import { nowMs, elapsedMs } from '../timing';
import { synthesizeAnswer } from '../chatSynthesis';
import { buildReActDebugTrace } from '../chatEngineDebug';
import { checkPlanDestructive } from '../planDestructiveCheck';
import {
  extractBrowserSessionFromObservations,
  extractBrowserTasksFromObservations,
  extractEntitiesFromObservations,
  mergeSessionState,
  type ChatSessionState,
} from '../sessionState';
import { TOOL_BRAIN_MODEL, TOOL_BRAIN_NAME } from '../models/toolBrainConfig';
import { buildMixedPlanSummary, CONFIRMED_READ_ONLY_FASTLANE_TOOLS, shouldRequireToolConfirmation } from '../chatEnginePolicy';
import type { ChatEngineResult, ChatEngineSizeMetrics, ChatEngineTimings, MessageMeta, PipelineContext } from './pipelineTypes';
import type { ReActStep } from '../reactLoop';

type ToolDispatchResult = Awaited<ReturnType<typeof dispatchToolCalls>>;

type DebugExecutedCall = Array<{
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  durationMs?: number;
}>;

export function dedupeConsecutiveTextMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.type === 'text' &&
      message.type === 'text' &&
      prev.content.trim() === message.content.trim()
    ) {
      continue;
    }
    out.push(message);
  }
  return out;
}

export function replaceLastAssistantMessage(history: ChatCompletionMessageParam[], content: string): ChatCompletionMessageParam[] {
  const next = [...history];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant') {
      next[i] = { role: 'assistant', content };
      return next;
    }
  }
  return [...next, { role: 'assistant', content }];
}

export function isGenericDispatchSummary(summary: string | undefined): boolean {
  const s = (summary || '').trim().toLowerCase();
  return s.startsWith('executed ') || s.startsWith('tool ');
}

export function shouldSkipSynthesisForDispatch(dispatched: ToolDispatchResult): boolean {
  if (dispatched.executed.length !== 1) return false;
  const only = dispatched.executed[0];
  if (!only?.ok) return false;
  if (!CONFIRMED_READ_ONLY_FASTLANE_TOOLS.has(only.name)) return false;
  if (!dispatched.summary) return false;
  if (isGenericDispatchSummary(dispatched.summary)) return false;
  return true;
}

export function mergeSessionFromDispatch(previous: ChatSessionState | undefined, dispatched: ToolDispatchResult): ChatSessionState | undefined {
  const observations = dispatched.executed.map((x) => ({ name: x.name, ok: x.ok, result: x.result }));
  const browserUpdate = extractBrowserSessionFromObservations(observations);
  return mergeSessionState(
    previous,
    extractEntitiesFromObservations(observations),
    browserUpdate,
    extractBrowserTasksFromObservations(observations)
  );
}

export function appendBrowserSessionNoteIfActive(dispatched: ToolDispatchResult, assistantText: string): string {
  const browserSessionActive = dispatched.executed.some((call) => {
    if (!call.ok) return false;
    if (!(call.name.startsWith('browser_') || call.name.startsWith('salesnav_'))) return false;
    const result = call.result;
    if (!result || typeof result !== 'object') return false;
    const obj = result as Record<string, unknown>;
    const tabId = obj.tab_id ?? obj.tabId ?? obj.active_tab_id ?? obj.activeTabId;
    return typeof tabId === 'string' && tabId.startsWith('tab-');
  });
  const pendingTaskIds = dispatched.executed
    .map((call) => (call && typeof call.result === 'object' && call.result ? (call.result as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .filter((row) => String(row.status || '').toLowerCase() === 'pending' && typeof row.task_id === 'string')
    .map((row) => String(row.task_id))
    .filter(Boolean);
  const hasSessionNote = assistantText.toLowerCase().includes('browser session is still open');
  const hasTaskNote = assistantText.toLowerCase().includes('long task running in background');
  let out = assistantText;
  if (browserSessionActive && !hasSessionNote) {
    out = `${out}\n\nBrowser session is still open.`;
  }
  if (pendingTaskIds.length > 0 && !hasTaskNote) {
    out = `${out}\n\nLong task running in background. Check status with task_id=${pendingTaskIds[0]}.`;
  }
  return out;
}

export async function synthesizeDispatchResponse(params: {
  userMessage: string;
  normalizedMessage: string;
  intentText: string;
  pageContext: string | null;
  previousSessionState?: ChatSessionState;
  dispatched: ToolDispatchResult;
  defaultResponse: string;
  allowSkip: boolean;
}): Promise<{
  assistantText: string;
  synthesized: { response: string; modelUsed: ModelRoute; promptChars: number; synthesized: boolean };
}> {
  const {
    userMessage,
    normalizedMessage,
    intentText,
    pageContext,
    previousSessionState,
    dispatched,
    defaultResponse,
    allowSkip,
  } = params;

  const skip = allowSkip && shouldSkipSynthesisForDispatch(dispatched);
  let synthesized = {
    response: defaultResponse,
    modelUsed: 'qwen3' as ModelRoute,
    promptChars: 0,
    synthesized: false,
  };
  if (!skip) {
    try {
      synthesized = await synthesizeAnswer({
        userMessage,
        normalizedMessage,
        intentText,
        pageContext,
        sessionState: previousSessionState,
        executedCalls: dispatched.executed.map((x) => ({
          name: x.name,
          args: x.args || {},
          ok: x.ok,
          result: x.result,
          durationMs: x.durationMs,
        })),
        fallbackResponse: defaultResponse,
      });
    } catch {
      // Keep fallback response if synthesis fails unexpectedly.
    }
  }

  const assistantText = synthesized.response || defaultResponse;
  return { assistantText, synthesized };
}

export function baseDebugTrace(_ctx: PipelineContext, fields: {
  route: ModelRoute;
  routeReason: string;
  modelUsed: ModelRoute;
  success: boolean;
  selectedTools: string[];
  nativeToolCalls: number;
  tokenToolCalls: number;
  toolsUsed: string[];
  fallbackUsed: boolean;
  modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>;
  phase: ChatPhase;
  executedCalls?: DebugExecutedCall;
  rawUserMessage?: string;
  intentText?: string;
  pageContext?: string | null;
  synthesisMs?: number;
  synthesisModelUsed?: ModelRoute;
  synthesized?: boolean;
  synthesisPromptChars?: number;
  plannedSummary?: string;
  failureReason?: string;
}): NonNullable<ChatEngineResult['debugTrace']> {
  return {
    route: fields.route,
    routeReason: fields.routeReason,
    modelUsed: fields.modelUsed,
    toolBrainName: TOOL_BRAIN_NAME,
    toolBrainModel: TOOL_BRAIN_MODEL,
    success: fields.success,
    ...(fields.failureReason ? { failureReason: fields.failureReason } : {}),
    selectedTools: fields.selectedTools,
    nativeToolCalls: fields.nativeToolCalls,
    tokenToolCalls: fields.tokenToolCalls,
    toolsUsed: fields.toolsUsed,
    fallbackUsed: fields.fallbackUsed,
    modelSwitches: fields.modelSwitches,
    phase: fields.phase,
    ...(fields.plannedSummary ? { plannedSummary: fields.plannedSummary } : {}),
    ...(fields.executedCalls ? { executedCalls: fields.executedCalls } : {}),
    rawUserMessage: fields.rawUserMessage,
    intentText: fields.intentText,
    pageContext: fields.pageContext || undefined,
    ...(fields.synthesisMs != null ? { synthesisMs: fields.synthesisMs } : {}),
    ...(fields.synthesisModelUsed ? { synthesisModelUsed: fields.synthesisModelUsed } : {}),
    ...(fields.synthesized != null ? { synthesized: fields.synthesized } : {}),
    ...(fields.synthesisPromptChars != null ? { synthesisPromptChars: fields.synthesisPromptChars } : {}),
  };
}

export function attachTimingsAndSizes(
  debugTrace: NonNullable<ChatEngineResult['debugTrace']>,
  timings: ChatEngineTimings,
  sizeMetrics?: ChatEngineSizeMetrics
): NonNullable<ChatEngineResult['debugTrace']> {
  return {
    ...debugTrace,
    timings: { ...timings },
    ...(sizeMetrics ? { sizes: sizeMetrics } : {}),
  };
}

export async function dispatchAndBuildArtifacts(params: {
  ctx: PipelineContext;
  calls: PlannedToolCall[];
  routeReason: string;
  selectedTools?: string[];
  allowSkipSynthesis: boolean;
  previousSessionState?: ChatSessionState;
  phaseOverride?: ChatPhase;
  userMessageForHistory?: string;
  metaOverride?: MessageMeta;
  defaultResponse?: string;
  postProcessAssistantText?: (assistantText: string, dispatched: ToolDispatchResult) => string;
}): Promise<{
  updatedHistoryPrefix: ChatCompletionMessageParam[];
  dispatched: ToolDispatchResult;
  synthesized: { response: string; modelUsed: ModelRoute; promptChars: number; synthesized: boolean };
  assistantText: string;
  grounded: { response: string; messages: ChatMessage[] };
  nextSessionState: ChatSessionState | undefined;
  selectedToolsForTrace: string[];
}> {
  const {
    ctx,
    calls,
    selectedTools,
    allowSkipSynthesis,
    previousSessionState,
    userMessageForHistory,
    metaOverride,
    defaultResponse,
    postProcessAssistantText,
  } = params;

  const selectedToolsForTrace = selectedTools && selectedTools.length > 0
    ? selectedTools
    : ctx.getSelectedToolsForMessage();

  const historyUserMessage = userMessageForHistory ?? ctx.plannerMessage ?? ctx.normalizedMessage;
  const updatedHistoryPrefix: ChatCompletionMessageParam[] = [
    ...ctx.history,
    { role: 'user', content: historyUserMessage },
  ];

  const dispatchStartedAt = nowMs();
  const dispatched = await dispatchToolCalls(calls, ctx.options.onToolCall);
  const nextSessionState = mergeSessionFromDispatch(previousSessionState, dispatched);
  ctx.timings.dispatchMs = (ctx.timings.dispatchMs || 0) + elapsedMs(dispatchStartedAt);

  const fallbackText = dispatched.summary || defaultResponse || 'Executed actions.';
  const synthesisStartedAt = nowMs();
  const meta = metaOverride || ctx.meta;
  const { assistantText: synthesizedText, synthesized } = await synthesizeDispatchResponse({
    userMessage: meta.rawUserMessage || ctx.userMessage,
    normalizedMessage: meta.intentText,
    intentText: meta.intentText,
    pageContext: meta.pageContext,
    previousSessionState,
    dispatched,
    defaultResponse: fallbackText,
    allowSkip: allowSkipSynthesis,
  });
  ctx.timings.synthesisMs = (ctx.timings.synthesisMs || 0) + elapsedMs(synthesisStartedAt);

  const assistantTextRaw = synthesizedText;
  const assistantText = postProcessAssistantText ? postProcessAssistantText(assistantTextRaw, dispatched) : assistantTextRaw;

  const formatStartedAt = nowMs();
  const combinedMessages = dedupeConsecutiveTextMessages([
    textMsg(assistantText),
    ...formatDispatchMessages(dispatched),
  ]);
  const grounded = enforceHybridGrounding(
    assistantText,
    combinedMessages,
    dispatched.executed.map((x) => ({ name: x.name, result: x.result }))
  );
  ctx.timings.formatMs = (ctx.timings.formatMs || 0) + elapsedMs(formatStartedAt);

  return {
    updatedHistoryPrefix,
    dispatched,
    synthesized,
    assistantText,
    grounded,
    nextSessionState,
    selectedToolsForTrace,
  };
}

export async function buildDispatchBackedResult(params: {
  ctx: PipelineContext;
  calls: PlannedToolCall[];
  uiActions?: ChatAction[];
  routeReason: string;
  selectedTools?: string[];
  allowSkipSynthesis: boolean;
  previousSessionState?: ChatSessionState;
  phaseOverride?: ChatPhase;
  userMessageForHistory?: string;
  metaOverride?: MessageMeta;
  defaultResponse?: string;
  appendAssistantToHistory?: boolean;
  postProcessAssistantText?: (assistantText: string, dispatched: ToolDispatchResult) => string;
}): Promise<ChatEngineResult> {
  const {
    ctx,
    calls,
    uiActions = [],
    routeReason,
    selectedTools,
    allowSkipSynthesis,
    previousSessionState,
    phaseOverride,
    userMessageForHistory,
    metaOverride,
    defaultResponse,
    appendAssistantToHistory,
    postProcessAssistantText,
  } = params;

  const phase: ChatPhase = phaseOverride || ctx.phase;
  const selectedToolsForTraceInitial = selectedTools && selectedTools.length > 0
    ? selectedTools
    : ctx.getSelectedToolsForMessage();

  const historyUserMessage = userMessageForHistory ?? ctx.plannerMessage ?? ctx.normalizedMessage;
  const updatedHistoryPrefix: ChatCompletionMessageParam[] = [
    ...ctx.history,
    { role: 'user', content: historyUserMessage },
  ];

  const hasToolCalls = calls.length > 0;
  const hasUiActions = uiActions.length > 0;
  const destructiveCheck = checkPlanDestructive(uiActions, calls);
  const shouldConfirm = ctx.options.requireToolConfirmation === false
    ? false
    : (destructiveCheck.requiresConfirmation || shouldRequireToolConfirmation(calls, ctx.options.requireToolConfirmation));

  if (shouldConfirm) {
    const summary = buildMixedPlanSummary(uiActions, calls);
    const result: ChatEngineResult = {
      response: '',
      updatedHistory: updatedHistoryPrefix,
      messages: [textMsg('Fast plan ready for confirmation.')],
      modelUsed: 'qwen3',
      toolsUsed: [],
      fallbackUsed: false,
      confirmation: {
        required: true,
        summary,
        ...(hasUiActions ? { uiActions } : {}),
        calls,
      },
      ...(ctx.sessionState ? { sessionState: ctx.sessionState } : {}),
    };

    if (ctx.includeDebugTrace) {
      result.debugTrace = baseDebugTrace(ctx, {
        route: 'qwen3',
        routeReason,
        modelUsed: 'qwen3',
        success: true,
        selectedTools: selectedToolsForTraceInitial,
        nativeToolCalls: 0,
        tokenToolCalls: 0,
        toolsUsed: [],
        fallbackUsed: false,
        modelSwitches: [],
        phase,
        rawUserMessage: ctx.userMessage,
        intentText: ctx.resolvedMessage ?? ctx.normalizedMessage,
        pageContext: ctx.pageContext,
      });
    }
    return result;
  }

  if (hasUiActions && !hasToolCalls) {
    const summary = buildMixedPlanSummary(uiActions, calls);
    const result: ChatEngineResult = {
      response: 'Planned UI actions.',
      updatedHistory: [
        ...updatedHistoryPrefix,
        { role: 'assistant', content: 'Planned UI actions.' },
      ],
      messages: [textMsg('Planned UI actions.')],
      modelUsed: 'qwen3',
      toolsUsed: [],
      fallbackUsed: false,
      appActions: uiActions,
      ...(ctx.sessionState ? { sessionState: ctx.sessionState } : {}),
    };
    if (ctx.includeDebugTrace) {
      result.debugTrace = baseDebugTrace(ctx, {
        route: 'qwen3',
        routeReason,
        modelUsed: 'qwen3',
        success: true,
        selectedTools: selectedToolsForTraceInitial,
        nativeToolCalls: 0,
        tokenToolCalls: 0,
        toolsUsed: [],
        fallbackUsed: false,
        modelSwitches: [],
        phase,
        plannedSummary: summary,
        rawUserMessage: ctx.userMessage,
        intentText: ctx.resolvedMessage ?? ctx.normalizedMessage,
        pageContext: ctx.pageContext,
      });
    }
    return result;
  }

  const meta = metaOverride || ctx.meta;
  const {
    updatedHistoryPrefix: builtHistoryPrefix,
    dispatched,
    synthesized,
    grounded,
    nextSessionState,
    selectedToolsForTrace: selectedToolsForTraceBuilt,
  } = await dispatchAndBuildArtifacts({
    ctx,
    calls,
    routeReason,
    selectedTools,
    allowSkipSynthesis,
    previousSessionState,
    phaseOverride,
    userMessageForHistory,
    metaOverride,
    defaultResponse,
    postProcessAssistantText,
  });

  const updatedHistory: ChatCompletionMessageParam[] =
    appendAssistantToHistory === false
      ? builtHistoryPrefix
      : [
          ...builtHistoryPrefix,
          { role: 'assistant', content: grounded.response },
        ];

  const result: ChatEngineResult = {
    response: grounded.response,
    updatedHistory,
    messages: grounded.messages,
    modelUsed: 'qwen3',
    toolsUsed: dispatched.toolsUsed,
    fallbackUsed: false,
    sessionState: nextSessionState,
  };

  if (ctx.includeDebugTrace) {
    result.debugTrace = baseDebugTrace(ctx, {
      route: 'qwen3',
      routeReason,
      modelUsed: 'qwen3',
      success: dispatched.success,
      selectedTools: selectedToolsForTraceBuilt,
      nativeToolCalls: 0,
      tokenToolCalls: calls.length,
      toolsUsed: dispatched.toolsUsed,
      fallbackUsed: false,
      modelSwitches: [],
      phase,
      executedCalls: dispatched.executed.map((x) => ({ name: x.name, args: x.args, ok: x.ok, result: x.result, durationMs: x.durationMs })),
      rawUserMessage: meta.rawUserMessage,
      intentText: meta.intentText,
      pageContext: meta.pageContext || undefined,
      synthesisMs: ctx.timings.synthesisMs,
      synthesisModelUsed: synthesized.modelUsed,
      synthesized: synthesized.synthesized,
      synthesisPromptChars: synthesized.promptChars,
    });
  }

  return result;
}

export async function buildExecutedToolBackedResult(params: {
  executedCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown }>;
  toolsUsed: string[];
  userMessage: string;
  history: ChatCompletionMessageParam[];
  meta?: MessageMeta;
  previousSessionState?: ChatSessionState;
  timings?: ChatEngineTimings;
  includeDebugTrace: boolean;
  includeHeavyDebug: boolean;
  modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>;
  resultAnswer?: string;
  resultTrace: ReActStep[];
  hitLimit: boolean;
  pendingConfirmation?: {
    summary: string;
    uiActions?: ChatAction[];
    calls: PlannedToolCall[];
    traceSnapshot?: ReActStep[];
  };
  appActions?: ChatAction[];
}): Promise<ChatEngineResult> {
  const {
    executedCalls,
    toolsUsed,
    userMessage,
    history,
    meta,
    previousSessionState,
    timings,
    includeDebugTrace,
    includeHeavyDebug,
    modelSwitches,
    resultAnswer,
    resultTrace,
    hitLimit,
    pendingConfirmation,
    appActions,
  } = params;

  const firstFailure = executedCalls.find((x) => !x.ok);
  const failureMessage = (() => {
    if (!firstFailure || !firstFailure.result || typeof firstFailure.result !== 'object') return '';
    const obj = firstFailure.result as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message;
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error;
    if (obj.detail != null) return typeof obj.detail === 'string' ? obj.detail : JSON.stringify(obj.detail);
    return '';
  })();

  const dispatchedLike = {
    success: executedCalls.length > 0 && executedCalls.every((x) => x.ok),
    toolsUsed,
    executed: executedCalls,
    summary:
      resultAnswer ||
      (firstFailure
        ? `Tool ${firstFailure.name} failed${failureMessage ? `: ${failureMessage}` : '.'}`
        : executedCalls.length > 0
          ? 'Executed tool calls.'
          : 'No tool calls executed.'),
  };

  if (pendingConfirmation) {
    const pendingHistory: ChatCompletionMessageParam[] = [
      ...history,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: resultAnswer || '' },
    ];
    return {
      response: '',
      updatedHistory: pendingHistory,
      messages: [textMsg('I prepared the next step. Confirm to continue.')],
      modelUsed: 'qwen3',
      toolsUsed,
      fallbackUsed: false,
      confirmation: {
        required: true,
        summary: pendingConfirmation.summary,
        ...(pendingConfirmation.uiActions ? { uiActions: pendingConfirmation.uiActions } : {}),
        calls: pendingConfirmation.calls,
        traceSnapshot: pendingConfirmation.traceSnapshot || resultTrace,
      },
      ...(includeDebugTrace ? { debugTrace: {
        route: 'qwen3',
        routeReason: 'react_loop',
        modelUsed: 'qwen3',
        toolBrainName: TOOL_BRAIN_NAME,
        toolBrainModel: TOOL_BRAIN_MODEL,
        success: !hitLimit,
        selectedTools: [],
        nativeToolCalls: 0,
        tokenToolCalls: resultTrace.reduce((sum, step) => sum + step.actions.length, 0),
        toolsUsed,
        fallbackUsed: false,
        modelSwitches,
        phase: 'executing',
        rawUserMessage: meta?.rawUserMessage,
        intentText: meta?.intentText,
        pageContext: meta?.pageContext || undefined,
        synthesized: false,
      } } : {}),
    };
  }

  const synthesisStartedAt = nowMs();
  let synthesized = {
    response: resultAnswer || dispatchedLike.summary,
    modelUsed: 'qwen3' as ModelRoute,
    promptChars: 0,
    synthesized: false,
  };
  try {
    synthesized = await synthesizeAnswer({
      userMessage: meta?.rawUserMessage || userMessage,
      normalizedMessage: meta?.intentText,
      intentText: meta?.intentText,
      pageContext: meta?.pageContext,
      sessionState: previousSessionState,
      executedCalls: executedCalls.map((call) => ({
        name: call.name,
        args: call.args || {},
        ok: call.ok,
        result: call.result,
        durationMs: undefined,
      })),
      fallbackResponse: resultAnswer || dispatchedLike.summary,
    });
  } catch {
    // Keep fallback text if synthesis fails unexpectedly.
  }
  if (timings) {
    timings.synthesisMs = (timings.synthesisMs || 0) + elapsedMs(synthesisStartedAt);
  }

  const formatStartedAt = nowMs();
  const richMessages = executedCalls.length > 0
    ? formatDispatchMessages(dispatchedLike as Awaited<ReturnType<typeof import('../toolExecutor').dispatchToolCalls>>)
    : [];
  if (timings) {
    timings.formatMs = elapsedMs(formatStartedAt);
  }
  const messages = dedupeConsecutiveTextMessages([
    ...(synthesized.response.trim() ? [textMsg(synthesized.response.trim())] : []),
    ...richMessages,
  ]);

  let debugTrace: ChatEngineResult['debugTrace'];
  if (includeDebugTrace) {
    const debugStartedAt = nowMs();
    debugTrace = buildReActDebugTrace(
      {
        answer: resultAnswer || '',
        trace: resultTrace,
        toolsUsed,
        hitLimit,
      } as any,
      modelSwitches,
      executedCalls.map((x) => ({ name: x.name, args: x.args, result: x.result, ok: x.ok })),
      includeHeavyDebug,
      meta
    );
    debugTrace.synthesisMs = timings?.synthesisMs;
    debugTrace.synthesisModelUsed = synthesized.modelUsed;
    debugTrace.synthesized = synthesized.synthesized;
    debugTrace.synthesisPromptChars = synthesized.promptChars;
    if (timings) {
      timings.debugMs = elapsedMs(debugStartedAt);
    }
  }

  const grounded = enforceHybridGrounding(
    synthesized.response || 'I completed the requested actions.',
    messages.length > 0 ? messages : [textMsg('I completed the requested actions.')],
    executedCalls.map((call) => ({ name: call.name, result: call.result }))
  );
  const nextSessionState = mergeSessionState(
    previousSessionState,
    extractEntitiesFromObservations(executedCalls),
    extractBrowserSessionFromObservations(executedCalls),
    extractBrowserTasksFromObservations(executedCalls)
  );
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
    toolsUsed,
    fallbackUsed: false,
    ...(appActions && appActions.length > 0 ? { appActions } : {}),
    sessionState: nextSessionState,
    ...(debugTrace ? { debugTrace } : {}),
  };
}
