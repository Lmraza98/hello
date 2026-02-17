/**
 * Adapter layer between the chat engine pipeline and the ReAct loop/tool execution.
 *
 * This module primarily moves logic out of `chatEngine.ts` with minimal changes.
 */

import type { ChatCompletionMessageParam } from '../chatEngineTypes';
import type { ChatSessionState } from '../sessionState';
import { runReActLoop, resumeReActLoop, type ReActConfig, type ReActResult } from '../reactLoop';
import type { ModelRoute } from '../router';
import { CONFIRMED_READ_ONLY_FASTLANE_TOOLS } from '../chatEnginePolicy';
import type { compactPlannerHistoryByTurns } from '../runtimeGuards';
import { buildDispatchBackedResult, buildExecutedToolBackedResult } from './responseBuilder';
import type { ChatEngineOptions, ChatEngineResult, ChatEngineTimings, MessageMeta, PipelineContext } from './pipelineTypes';

export function buildReActConfig(
  options: ChatEngineOptions,
  pageContext?: string | null,
  sessionContext?: string
): ReActConfig {
  return {
    maxIterations: 3,
    maxToolCalls: 10,
    iterationTimeoutMs: 30_000,
    contextTokenBudget: 6_000,
    onToolCall: options.onToolCall,
    onReasoningEvent: options.onPlannerEvent,
    requireWriteConfirmation: options.requireToolConfirmation ?? true,
    ...(sessionContext ? { memoryContext: sessionContext } : {}),
    memoryDir: import.meta.env.VITE_CHAT_MEMORY_DIR || 'crm-assistant',
    pageContext: pageContext || undefined,
  };
}

export async function reactResultToChatResult(
  result: ReActResult,
  userMessage: string,
  history: ChatCompletionMessageParam[],
  modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>,
  includeDebugTrace = false,
  includeHeavyDebug = false,
  timings?: ChatEngineTimings,
  meta?: MessageMeta,
  previousSessionState?: ChatSessionState
): Promise<ChatEngineResult> {
  const lastObservedStep = [...result.trace].reverse().find((s) => s.observations.length > 0);
  const executed = (lastObservedStep?.observations || []).map((o) => ({
    name: o.name,
    args: o.args,
    result: o.result,
    ok: o.ok,
  }));
  if (timings) {
    timings.dispatchMs = (timings.dispatchMs || 0) + (result.metrics?.dispatchMs || 0);
    timings.plannerMs = (timings.plannerMs || 0) + (result.metrics?.plannerMs || 0);
  }
  return await buildExecutedToolBackedResult({
    executedCalls: executed,
    toolsUsed: result.toolsUsed,
    userMessage,
    history,
    meta,
    previousSessionState,
    timings,
    includeDebugTrace,
    includeHeavyDebug,
    modelSwitches,
    resultAnswer: result.answer,
    resultTrace: result.trace,
    hitLimit: result.hitLimit,
    pendingConfirmation: result.pendingConfirmation
      ? {
          summary: result.pendingConfirmation.summary,
          ...(result.pendingConfirmation.uiActions ? { uiActions: result.pendingConfirmation.uiActions } : {}),
          calls: result.pendingConfirmation.calls,
          traceSnapshot: result.pendingConfirmation.traceSnapshot,
        }
      : undefined,
    appActions: result.appActions,
  });
}

export async function handleToolRoute(params: {
  ctx: PipelineContext;
  userMessage: string;
  history: ChatCompletionMessageParam[];
  options: ChatEngineOptions;
  plannerHistory: ReturnType<typeof compactPlannerHistoryByTurns>;
  reactConfig: ReActConfig;
  includeDebugTrace: boolean;
  includeHeavyDebug: boolean;
  timings: ChatEngineTimings;
  meta: MessageMeta;
  previousSessionState?: ChatSessionState;
}): Promise<ChatEngineResult> {
  const {
    ctx,
    userMessage,
    history,
    options,
    plannerHistory,
    reactConfig,
    includeDebugTrace,
    includeHeavyDebug,
    timings,
    meta,
    previousSessionState,
  } = params;

  const modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }> = [];

  if (options.confirmedToolCalls?.length) {
    const allReadOnly = options.confirmedToolCalls.every((call) =>
      CONFIRMED_READ_ONLY_FASTLANE_TOOLS.has(call.name)
    );
    if (allReadOnly) {
      return await buildDispatchBackedResult({
        ctx: { ...ctx, includeDebugTrace, includeHeavyDebug, timings },
        calls: options.confirmedToolCalls,
        routeReason: 'confirmed_read_only_fastlane',
        selectedTools: [...new Set(options.confirmedToolCalls.map((x) => x.name))],
        allowSkipSynthesis: true,
        previousSessionState,
        phaseOverride: 'executing',
        userMessageForHistory: userMessage,
        metaOverride: meta,
        defaultResponse: 'Executed confirmed actions.',
      });
    }

    const result = await resumeReActLoop(
      userMessage,
      options.confirmedToolCalls,
      options._reactTrace || [],
      plannerHistory,
      reactConfig
    );
    return await reactResultToChatResult(result, userMessage, history, modelSwitches, includeDebugTrace, includeHeavyDebug, timings, meta, previousSessionState);
  }

  const result = await runReActLoop(
    userMessage,
    plannerHistory,
    reactConfig
  );
  return await reactResultToChatResult(result, userMessage, history, modelSwitches, includeDebugTrace, includeHeavyDebug, timings, meta, previousSessionState);
}

