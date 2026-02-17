/**
 * Canonical tool-call types.
 *
 * `PlannedToolCall`  – a tool call before execution (name + args).
 * `ParsedToolCall`   – legacy alias kept for backward compatibility.
 * `ToolDispatchItem`  – a tool call after execution (adds result/ok/duration).
 * `ToolDispatchResult` – aggregate result of dispatching one or more tool calls.
 */

export type PlannedToolCall = {
  name: string;
  args: Record<string, unknown>;
};

/** @deprecated Use `PlannedToolCall` instead. */
export type ParsedToolCall = PlannedToolCall;

export type ToolDispatchItem = PlannedToolCall & {
  result: unknown;
  ok: boolean;
  durationMs?: number;
};

export type ToolDispatchResult = {
  success: boolean;
  toolsUsed: string[];
  executed: ToolDispatchItem[];
  summary: string;
};
