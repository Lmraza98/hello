/**
 * Compatibility exports for dispatch response helpers.
 *
 * Phase 2A keeps this module stable while the implementation lives in
 * `responseBuilder.ts`.
 */

import type { ChatPhase, PlannedToolCall } from '../chatEngineTypes';
import type { ChatSessionState } from '../sessionState';
import type { ChatEngineResult, MessageMeta, PipelineContext } from './pipelineTypes';
import { buildDispatchBackedResult } from './responseBuilder';

export {
  dedupeConsecutiveTextMessages,
  replaceLastAssistantMessage,
  isGenericDispatchSummary,
  shouldSkipSynthesisForDispatch,
  mergeSessionFromDispatch,
  appendBrowserSessionNoteIfActive,
  synthesizeDispatchResponse,
  baseDebugTrace,
  attachTimingsAndSizes,
} from './responseBuilder';

type ToolDispatchResult = Awaited<ReturnType<typeof import('../toolExecutor').dispatchToolCalls>>;

export async function dispatchPlanAndBuildResult(params: {
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
  appendAssistantToHistory?: boolean;
  postProcessAssistantText?: (assistantText: string, dispatched: ToolDispatchResult) => string;
}): Promise<ChatEngineResult> {
  return buildDispatchBackedResult(params);
}
