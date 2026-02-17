import type { ChatPhase } from './chatEngineTypes';
import type { ModelRoute } from './router';
import type { ReActResult, ReActStep } from './reactLoop';
import { TOOL_BRAIN_MODEL, TOOL_BRAIN_NAME } from './models/toolBrainConfig';
import { sanitizeDebugResult } from './runtimeGuards';

export interface ChatEngineDebugMeta {
  rawUserMessage?: string;
  intentText?: string;
  pageContext?: string | null;
}

export interface ChatEngineDebugTrace {
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
  synthesisMs?: number;
  synthesisModelUsed?: ModelRoute;
  synthesized?: boolean;
  synthesisPromptChars?: number;
}

export function estimateChars(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

export function buildReActDebugTrace(
  result: ReActResult,
  modelSwitches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>,
  executedCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown }>,
  includeHeavy = false,
  meta?: ChatEngineDebugMeta
): ChatEngineDebugTrace {
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

  const base: ChatEngineDebugTrace = {
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
    executedCalls: executedCalls.map((call) => ({
      ...call,
      result: sanitizeDebugResult(call.result),
    })),
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
