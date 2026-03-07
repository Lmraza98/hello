/**
 * Shared pipeline types for the chat engine refactor.
 *
 * This file intentionally hosts the public `ChatEngineOptions` and `ChatEngineResult`
 * types that were historically declared in `chatEngine.ts`, so that both the
 * pipeline implementation and the thin orchestrator can depend on the same
 * definitions without import cycles.
 */

import type { ChatMessage } from '../../types/chat';
import type {
  ChatCompletionMessageParam,
  ChatPhase,
  PendingTaskPlan,
  PlannedToolCall,
  TaskStep,
} from '../chatEngineTypes';
import type { ModelRoute } from '../router';
import type { ReActConfig, ReActStep } from '../reactLoop';
import type { compactPlannerHistoryByTurns } from '../runtimeGuards';
import type { ChatSessionState } from '../sessionState';
import type { ChatAction } from '../actions';
import type { PlannerRoute } from '../models/plannerBackends';

export interface ChatEngineOptions {
  conversationHistory?: ChatCompletionMessageParam[];
  onToolCall?: (toolName: string) => void;
  onPlannerEvent?: (message: string) => void;
  onAssistantToken?: (token: string) => void;
  onModelSwitch?: (from: ModelRoute, to: ModelRoute, reason: string) => void;
  forceModel?: ModelRoute;
  chatModelOverride?: string;
  chatModelProviderOverride?: 'ollama' | 'openai' | 'openrouter';
  plannerModelOverride?: string;
  plannerRouteOverride?: PlannerRoute;
  phase?: ChatPhase;
  requireToolConfirmation?: boolean;
  confirmedToolCalls?: PlannedToolCall[];
  pendingPlanSummary?: string;
  pendingTaskPlan?: PendingTaskPlan;
  confirmedUiActions?: ChatAction[];
  _reactTrace?: ReActStep[];
  debug?: boolean;
  debugHeavy?: boolean;
  sessionState?: ChatSessionState;
  _skipTaskDecomposition?: boolean;
}

export type ChatEngineTimings = {
  totalMs: number;
  routeMs?: number;
  reactMs?: number;
  plannerMs?: number;
  dispatchMs?: number;
  fallbackMs?: number;
  formatMs?: number;
  debugMs?: number;
  synthesisMs?: number;
};

export type ChatEngineSizeMetrics = {
  historyChars: number;
  localHistoryChars: number;
  promptChars: number;
};

export interface ChatEngineResult {
  response: string;
  updatedHistory: ChatCompletionMessageParam[];
  messages: ChatMessage[];
  modelUsed: ModelRoute;
  toolsUsed: string[];
  fallbackUsed: boolean;
  sessionState?: ChatSessionState;
  appActions?: ChatAction[];
  confirmation?: {
    required: boolean;
    summary: string;
    uiActions?: ChatAction[];
    calls: PlannedToolCall[];
    traceSnapshot?: ReActStep[];
    pendingTaskPlan?: PendingTaskPlan;
  };
  clarificationQuestion?: string;
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
    executedCalls?: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown; durationMs?: number }>;
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
    synthesisMs?: number;
    synthesisModelUsed?: ModelRoute;
    synthesized?: boolean;
    synthesisPromptChars?: number;
    sizes?: {
      historyChars: number;
      localHistoryChars: number;
      promptChars: number;
    };
  };
}

export interface MessageMeta {
  rawUserMessage: string;
  intentText: string;
  pageContext: string | null;
}

export type StepResult = ChatEngineResult | null;

export type PipelineContext = {
  userMessage: string;
  history: ChatCompletionMessageParam[];
  localHistory: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string | null }>;
  phase: ChatPhase;

  options: ChatEngineOptions;
  sessionState?: ChatSessionState;

  intentText: string;
  pageContext: string | null;
  normalizedMessage: string;

  includeDebugTrace: boolean;
  includeHeavyDebug: boolean;

  timings: ChatEngineTimings;
  sizeMetrics?: ChatEngineSizeMetrics;

  plannerHistory: ReturnType<typeof compactPlannerHistoryByTurns>;
  reactConfig: ReActConfig;
  meta: MessageMeta;

  // Lazily computed selection, used for debug trace
  getSelectedToolsForMessage: () => string[];

  // Mutated/derived during steps
  intentKind?: 'conversational' | 'single' | 'multi';
  plannerMessage?: string;
  resolvedMessage?: string;
  sessionContext?: string;

  modelFastPathAttempted?: boolean;
  modelFastPathSucceeded?: boolean;
  modelFastPathFailed?: boolean;

  activeTaskHandled?: boolean;
  activeTaskResult?: StepResult;

  // Step-specific misc storage
  stepData?: Record<string, unknown>;
  taskDecompositionSteps?: TaskStep[];
};
