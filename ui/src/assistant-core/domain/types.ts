/**
 * Core domain types for the assistant system.
 *
 * These types are intentionally decoupled from the chat engine's internal
 * types so that skills, the router, and the executor can be tested and
 * evolved independently.
 */

// ── Intent ──────────────────────────────────────────────────

export type IntentKind = 'conversational' | 'single' | 'multi';

// ── Tool Calls ──────────────────────────────────────────────
// Single source of truth lives in chat/toolExecutor/types.ts.
// Re-export here so assistant-core consumers don't need a direct dependency.

import type { PlannedToolCall as _PlannedToolCall, ToolDispatchItem as _ToolDispatchItem } from '../../chat/toolExecutor/types';

export type PlannedToolCall = _PlannedToolCall;
export type ExecutedToolCall = _ToolDispatchItem;

// ── Skill Definition ────────────────────────────────────────

export type SkillExtractField = {
  name: string;
  description: string;
  type?: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: unknown;
};

export type ConfirmationPolicy = 'ask_every' | 'ask_writes' | 'auto';

export type SkillDefinition = {
  /** Unique skill identifier (directory name / slug). */
  id: string;
  name: string;
  description: string;
  version: number;
  tags: string[];
  /** Patterns that activate this skill.  Matched against user message. */
  triggerPatterns: string[];
  /** Tools this skill is allowed to call.  Enforced at execution time. */
  allowedTools: string[];
  /** Fields to extract from the user message before execution. */
  extractFields: SkillExtractField[];
  /** Confirmation policy for write operations. */
  confirmationPolicy: ConfirmationPolicy;
  /** Raw markdown body from the SKILL.md (procedure description). */
  body: string;
};

// ── Skill Match ─────────────────────────────────────────────

export type SkillMatch = {
  skill: SkillDefinition;
  /** 0–1 confidence score. */
  confidence: number;
  /** Which trigger pattern(s) matched. */
  matchedPatterns: string[];
};

// ── Execution Plan ──────────────────────────────────────────

export type PlanStep = {
  id: string;
  toolCall: PlannedToolCall;
  /** If true, require user confirmation before executing. */
  requiresConfirmation: boolean;
  /** Human-readable description of what this step does. */
  description: string;
};

export type ExecutionPlan = {
  skillId: string;
  steps: PlanStep[];
  /** Extracted parameters from the user message. */
  extractedParams: Record<string, unknown>;
};

// ── Execution Events (telemetry) ────────────────────────────

export type ExecutionEvent =
  | { type: 'skill_matched'; skillId: string; confidence: number; timestamp: number }
  | { type: 'plan_created'; skillId: string; stepCount: number; timestamp: number }
  | { type: 'step_started'; stepId: string; toolName: string; timestamp: number }
  | { type: 'step_completed'; stepId: string; toolName: string; ok: boolean; durationMs: number; timestamp: number }
  | { type: 'step_failed'; stepId: string; toolName: string; error: string; timestamp: number }
  | { type: 'confirmation_requested'; stepId: string; summary: string; timestamp: number }
  | { type: 'confirmation_received'; stepId: string; approved: boolean; timestamp: number }
  | { type: 'execution_completed'; skillId: string; success: boolean; totalMs: number; timestamp: number };

// ── Skill Handler ───────────────────────────────────────────

/**
 * A skill handler takes extracted params and produces an execution plan.
 * The plan is then executed by the skill executor (which handles
 * confirmation gates, tool dispatch, and error recovery).
 */
export type SkillHandler = (params: {
  extractedParams: Record<string, unknown>;
  sessionContext: Record<string, unknown>;
  userMessage: string;
}) => Promise<ExecutionPlan> | ExecutionPlan;

// ── Active Work Item ────────────────────────────────────────
// Typed union representing in-progress work that spans multiple
// user turns (skill confirmations, param collection, react plans).
// Stored on ChatSessionState.activeWorkItem.

type WorkItemBase = {
  createdAt: number;
  expiresAt: number;
  correlationId: string;
};

export type ActiveWorkItem =
  | (WorkItemBase & {
      kind: 'param_collection';
      skillId: string;
      goal: string;
      collected: Record<string, unknown>;
      missing: SkillExtractField[];
    })
  | (WorkItemBase & {
      kind: 'skill_plan';
      skillId: string;
      plan: ExecutionPlan;
      nextStepIndex: number;
      completedResults: Record<string, unknown>;
      /** Step IDs that have already been executed (idempotency guard). */
      executedStepIds: string[];
      summary: string;
    })
  | (WorkItemBase & {
      kind: 'react_plan';
      goal: string;
      completedSteps: Array<{ stepId: string; toolResults: Array<{ name: string; ok: boolean; result?: unknown }> }>;
      remainingStepIntents: string[];
    })
  | (WorkItemBase & {
      kind: 'browser_skill_learn';
      originalToolCall: { name: string; args: Record<string, unknown> };
      skillDraft: string;
      skillId: string;
      summary: string;
    });

/** Default TTL for work items: 5 minutes. */
export const WORK_ITEM_TTL_MS = 5 * 60 * 1000;

/** Generate a correlation ID (fallback for environments without crypto.randomUUID). */
export function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Check if a work item has expired. */
export function isWorkItemExpired(item: ActiveWorkItem): boolean {
  return Date.now() > item.expiresAt;
}
