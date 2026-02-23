/**
 * RecipeRouter: deterministic routing for known skills.
 *
 * Before the LLM planner runs, the RecipeRouter checks if a registered skill
 * matches the user message.  If a confident match is found:
 *
 *   1. Extract parameters using a cheap LLM call (extraction only, not planning)
 *   2. Build a deterministic execution plan from the skill handler
 *   3. Execute the plan step-by-step with confirmation gates for write operations
 *   4. Synthesize a human-readable response from tool results
 *
 * If no skill matches, returns null — the caller falls through to the existing
 * LLM planning pipeline.
 */

import type {
  ExecutionPlan,
  ExecutedToolCall,
  ExecutionEvent,
  SkillDefinition,
} from '../domain/types';
import { matchMessage, getHandler } from '../skills/registry';
import { ollamaChat } from '../../chat/models/ollamaClient';
import type { ChatMessage } from '../../types/chat';
import { textMsg } from '../../services/messageHelpers';
import { validateAndNormalizeParams } from '../skills/paramSchema';

const EXTRACTION_MODEL =
  import.meta.env.VITE_PLANNER_BACKEND ||
  import.meta.env.VITE_TOOL_BRAIN ||
  'gemma3:12b';

export type RecipeResult = {
  /** True if a skill handled the message. */
  handled: boolean;
  /** Human-readable response text. */
  response: string;
  /** Chat messages for the UI. */
  messages: ChatMessage[];
  /** Tool calls that were executed. */
  executedCalls: ExecutedToolCall[];
  /** The execution plan that was followed. */
  plan?: ExecutionPlan;
  /** Telemetry events. */
  events: ExecutionEvent[];
  /** If a step requires confirmation, this is set. */
  pendingConfirmation?: {
    plan: ExecutionPlan;
    nextStepIndex: number;
    completedResults: Record<string, unknown>;
    /** Step IDs already executed (idempotency — skip on resume). */
    executedStepIds: string[];
    summary: string;
  };
};

const PROSPECT_SKILL_ID = 'prospect-companies-and-draft-emails';
const PROSPECT_DISCOVERY_CONTACT_STEP = 'discover_contacts_local';
const PROSPECT_ESCALATE_STEP = 'escalate_salesnav_background';
const PROSPECT_CAMPAIGN_STEP_IDS = new Set([
  'create_campaign',
  'enroll_contacts',
  'prepare_drafts',
  'approve_campaign_queue',
  'schedule_campaign',
  'verify_schedule',
]);

/**
 * Try to route a message through a registered skill.
 * Returns null if no skill matches (caller should fall through to LLM planner).
 *
 * @param message  The raw user intent text — must NOT contain injected context
 *                 like [SESSION_ENTITIES], [RESOLVED_ENTITY], or step results.
 *                 Trigger pattern matching runs against this string, so it must
 *                 reflect only what the user actually said.
 */
export async function trySkillRoute(
  message: string,
  options: {
    onEvent?: (event: ExecutionEvent) => void;
    onToolCall?: (toolName: string) => void;
    executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    sessionContext?: Record<string, unknown>;
  }
): Promise<RecipeResult | null> {
  const match = matchMessage(message);
  if (!match) return null;

  const events: ExecutionEvent[] = [];
  const emit = (event: ExecutionEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };

  emit({ type: 'skill_matched', skillId: match.skill.id, confidence: match.confidence, timestamp: Date.now() });

  // Step 1: Extract and validate parameters from the user message.
  const extraction = await extractParams(message, match.skill);

  if (!extraction.valid && extraction.missing.length > 0) {
    // Can't execute — enter param collection mode.
    const missingDescs = match.skill.extractFields
      .filter((f) => extraction.missing.includes(f.name))
      .map((f) => f.description || f.name);
    const response = `I'll create that for you. I just need: ${missingDescs.join(', ')}.`;
    return {
      handled: true,
      response,
      messages: [textMsg(response)],
      executedCalls: [],
      events,
    };
  }

  const extractedParams = extraction.params;

  // Step 2: Build the deterministic execution plan.
  const handler = getHandler(match.skill.id);
  if (!handler) return null;

  let plan: ExecutionPlan;
  try {
    plan = await handler({
      extractedParams,
      sessionContext: options.sessionContext || {},
      userMessage: message,
    });
  } catch {
    return null; // Handler failed — fall through to LLM planner
  }

  emit({ type: 'plan_created', skillId: match.skill.id, stepCount: plan.steps.length, timestamp: Date.now() });

  // Step 3: Execute the plan step by step.
  const executedCalls: ExecutedToolCall[] = [];
  const completedResults: Record<string, unknown> = {};
  const executedStepIds: string[] = [];
  const allowedTools = new Set(match.skill.allowedTools);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const localLeadCount = getProspectLocalLeadCount(plan, completedResults);

    if (shouldSkipProspectStep(plan, step.id, localLeadCount)) {
      continue;
    }

    // Enforce allowed_tools
    if (!allowedTools.has(step.toolCall.name)) {
      continue;
    }

    // Resolve $prev references in args
    const resolvedArgs = resolveStepArgs(step.toolCall.args, completedResults);

    // Confirmation gate for write operations
    if (step.requiresConfirmation) {
      const summary = formatConfirmationSummary(plan, i, resolvedArgs, completedResults, localLeadCount);
      return {
        handled: true,
        response: '',
        messages: [],
        executedCalls,
        plan,
        events,
        pendingConfirmation: {
          plan: {
            ...plan,
            steps: plan.steps.map((s, idx) => ({
              ...s,
              toolCall: {
                ...s.toolCall,
                args: idx === i ? resolvedArgs : resolveStepArgs(s.toolCall.args, completedResults),
              },
            })),
          },
          nextStepIndex: i,
          completedResults,
          executedStepIds: [...executedStepIds],
          summary,
        },
      };
    }

    // Execute the tool
    emit({ type: 'step_started', stepId: step.id, toolName: step.toolCall.name, timestamp: Date.now() });
    options.onToolCall?.(step.toolCall.name);

    const startedAt = Date.now();
    try {
      const result = await options.executeTool(step.toolCall.name, resolvedArgs);
      const durationMs = Date.now() - startedAt;
      const ok = !isErrorResult(result);
      executedCalls.push({ name: step.toolCall.name, args: resolvedArgs, result, ok, durationMs });
      completedResults[step.id] = result;
      executedStepIds.push(step.id);
      emit({ type: 'step_completed', stepId: step.id, toolName: step.toolCall.name, ok, durationMs, timestamp: Date.now() });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const error = err instanceof Error ? err.message : 'Unknown error';
      executedCalls.push({ name: step.toolCall.name, args: resolvedArgs, result: { error }, ok: false, durationMs });
      emit({ type: 'step_failed', stepId: step.id, toolName: step.toolCall.name, error, timestamp: Date.now() });
    }
  }

  // Step 4: Synthesize response from results
  const response = synthesizeSkillResponse(plan, executedCalls, extractedParams);
  emit({ type: 'execution_completed', skillId: match.skill.id, success: executedCalls.every((c) => c.ok), totalMs: events.reduce((sum, e) => (e.type === 'step_completed' ? sum + (e.durationMs || 0) : sum), 0), timestamp: Date.now() });

  return {
    handled: true,
    response,
    messages: [textMsg(response)],
    executedCalls,
    plan,
    events,
  };
}

/**
 * Resume a skill execution after user confirms a pending step.
 */
export async function resumeSkillExecution(
  pending: NonNullable<RecipeResult['pendingConfirmation']>,
  approved: boolean,
  options: {
    onEvent?: (event: ExecutionEvent) => void;
    onToolCall?: (toolName: string) => void;
    executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }
): Promise<RecipeResult> {
  const { plan, nextStepIndex, completedResults, executedStepIds: alreadyExecuted } = pending;
  const events: ExecutionEvent[] = [];
  const emit = (event: ExecutionEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };

  emit({ type: 'confirmation_received', stepId: plan.steps[nextStepIndex]?.id || '', approved, timestamp: Date.now() });

  if (!approved) {
    return {
      handled: true,
      response: 'Cancelled. What would you like to do instead?',
      messages: [textMsg('Cancelled. What would you like to do instead?')],
      executedCalls: [],
      events,
    };
  }

  const executedCalls: ExecutedToolCall[] = [];
  const results = { ...completedResults };
  const doneIds = new Set(alreadyExecuted || []);

  for (let i = nextStepIndex; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const localLeadCount = getProspectLocalLeadCount(plan, results);

    // Idempotency guard: skip steps already executed (double-confirm protection)
    if (doneIds.has(step.id)) {
      continue;
    }

    if (shouldSkipProspectStep(plan, step.id, localLeadCount)) {
      continue;
    }

    const resolvedArgs = resolveStepArgs(step.toolCall.args, results);

    // If this isn't the confirmed step and it requires confirmation, pause again
    if (i > nextStepIndex && step.requiresConfirmation) {
      const summary = formatConfirmationSummary(plan, i, resolvedArgs, results, localLeadCount);
      const resolvedPlan: ExecutionPlan = {
        ...plan,
        steps: plan.steps.map((s, idx) => ({
          ...s,
          toolCall: {
            ...s.toolCall,
            args: idx === i ? resolvedArgs : resolveStepArgs(s.toolCall.args, results),
          },
        })),
      };
      return {
        handled: true,
        response: '',
        messages: [],
        executedCalls,
        plan: resolvedPlan,
        events,
        pendingConfirmation: {
          plan: resolvedPlan,
          nextStepIndex: i,
          completedResults: results,
          executedStepIds: [...doneIds],
          summary,
        },
      };
    }

    emit({ type: 'step_started', stepId: step.id, toolName: step.toolCall.name, timestamp: Date.now() });
    options.onToolCall?.(step.toolCall.name);

    const startedAt = Date.now();
    try {
      const result = await options.executeTool(step.toolCall.name, resolvedArgs);
      const durationMs = Date.now() - startedAt;
      const ok = !isErrorResult(result);
      executedCalls.push({ name: step.toolCall.name, args: resolvedArgs, result, ok, durationMs });
      results[step.id] = result;
      doneIds.add(step.id);
      emit({ type: 'step_completed', stepId: step.id, toolName: step.toolCall.name, ok, durationMs, timestamp: Date.now() });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const error = err instanceof Error ? err.message : 'Unknown error';
      executedCalls.push({ name: step.toolCall.name, args: resolvedArgs, result: { error }, ok: false, durationMs });
      emit({ type: 'step_failed', stepId: step.id, toolName: step.toolCall.name, error, timestamp: Date.now() });
    }
  }

  const response = synthesizeSkillResponse(plan, executedCalls, plan.extractedParams);
  return {
    handled: true,
    response,
    messages: [textMsg(response)],
    executedCalls,
    plan,
    events,
  };
}

// ── Helpers ─────────────────────────────────────────────────

function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const obj = result as Record<string, unknown>;
  return obj.error === true;
}

/**
 * Resolve `$prev.<stepId>.<field>` references in tool call args.
 */
function resolveStepArgs(
  args: Record<string, unknown>,
  completedResults: Record<string, unknown>
): Record<string, unknown> {
  const getByPath = (obj: unknown, path: string[]): unknown => {
    let current: unknown = obj;
    for (const segment of path) {
      if (!segment) continue;
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  };

  const resolvePrevReference = (value: string): unknown => {
    const path = value.slice('$prev.'.length).split('.').filter(Boolean);
    const stepId = path[0];
    if (!stepId || !completedResults[stepId]) return value;
    const stepResult = completedResults[stepId];
    const nestedPath = path.slice(1);
    let resolved = nestedPath.length > 0 ? getByPath(stepResult, nestedPath) : stepResult;

    if (resolved === undefined || resolved === null) {
      const terminal = nestedPath[nestedPath.length - 1] || '';
      if (terminal === 'id') {
        resolved =
          getByPath(stepResult, ['id']) ??
          getByPath(stepResult, ['campaign_id']) ??
          getByPath(stepResult, ['campaign', 'id']) ??
          getByPath(stepResult, ['data', 'id']);
      } else if (terminal === 'campaign_id') {
        resolved =
          getByPath(stepResult, ['campaign_id']) ??
          getByPath(stepResult, ['id']) ??
          getByPath(stepResult, ['campaign', 'id']) ??
          getByPath(stepResult, ['data', 'campaign_id']);
      }
    }

    return resolved ?? value;
  };

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.startsWith('$prev.')) {
      resolved[key] = resolvePrevReference(value);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Extract parameters from a user message for a skill's extract_fields.
 * Uses a cheap LLM call for extraction, then validates + normalizes with Zod.
 *
 * If the LLM returns invalid/incomplete data, falls back to heuristic
 * extraction.  If both fail, returns the validation result so the caller
 * can enter param collection mode.
 */
async function extractParams(
  message: string,
  skill: SkillDefinition
): Promise<{ params: Record<string, unknown>; valid: boolean; missing: string[] }> {
  if (skill.extractFields.length === 0) return { params: {}, valid: true, missing: [] };

  let rawParsed: unknown = null;

  // 1. Try LLM extraction
  try {
    const fieldsDesc = skill.extractFields
      .map((f) => `- ${f.name} (${f.type || 'string'}${f.required ? ', required' : ', optional'}): ${f.description}`)
      .join('\n');

    const response = await ollamaChat({
      model: EXTRACTION_MODEL,
      messages: [
        {
          role: 'system',
          content:
            `Extract parameter values from the user message.\n` +
            `Skill: ${skill.name}\n` +
            `Fields to extract:\n${fieldsDesc}\n\n` +
            `Rules:\n` +
            `- Return ONLY a JSON object with the exact field names listed above.\n` +
            `- Do NOT add extra keys. Only use the field names above.\n` +
            `- For industry/vertical, extract the core keyword (e.g. "banks", "construction", "veterinary").\n` +
            `- If the user says "targeting banks", industry = "bank".\n` +
            `- If the user provides a campaign name, extract it. Otherwise omit the key.\n` +
            `- No markdown, no explanation, ONLY the JSON object.`,
        },
        { role: 'user', content: message },
      ],
      temperature: 0,
      numPredict: 128,
    });

    const raw = (response.message.content || '').trim();
    const cleaned = raw.replace(/```json\s*|```/g, '').trim();
    rawParsed = JSON.parse(cleaned);
  } catch {
    // LLM extraction failed — rawParsed stays null
  }

  // 2. Validate with Zod
  if (rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed)) {
    const result = validateAndNormalizeParams(rawParsed, skill.extractFields);
    if (result.ok) return { params: result.params, valid: true, missing: [] };
    // Partial extraction — check if heuristic can fill gaps
  }

  // 3. Heuristic fallback
  const heuristic = heuristicExtract(message, skill);
  const merged = {
    ...(rawParsed && typeof rawParsed === 'object' ? rawParsed as Record<string, unknown> : {}),
    ...heuristic,
  };
  const heuristicResult = validateAndNormalizeParams(merged, skill.extractFields);
  if (heuristicResult.ok) return { params: heuristicResult.params, valid: true, missing: [] };

  // 4. Return what we have with missing fields flagged
  return {
    params: merged,
    valid: false,
    missing: heuristicResult.missing,
  };
}

/**
 * Heuristic fallback: extract industry keyword from common patterns.
 */
function heuristicExtract(
  message: string,
  _skill: SkillDefinition
): Record<string, unknown> {
  const lower = message.toLowerCase();
  const params: Record<string, unknown> = {};

  // Extract industry from "targeting X" or "X contacts"
  const targetingMatch = lower.match(/targeting\s+(\w[\w\s]{0,30}?)(?:\s+and\s|\s+then\s|$)/);
  if (targetingMatch) {
    params.industry = targetingMatch[1].trim();
  } else {
    // Try "campaign for X" or "X campaign"
    const forMatch = lower.match(/campaign\s+(?:for|about|on)\s+(\w[\w\s]{0,30}?)(?:\s+and\s|\s+then\s|$)/);
    if (forMatch) {
      params.industry = forMatch[1].trim();
    }
  }

  // Extract campaign name from quotes
  const quotedMatch = message.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    params.campaign_name = quotedMatch[1].trim();
  }

  return params;
}

function formatConfirmationSummary(
  plan: ExecutionPlan,
  stepIndex: number,
  resolvedArgs: Record<string, unknown>,
  _completedResults: Record<string, unknown>,
  localLeadCount?: number
): string {
  const step = plan.steps[stepIndex];
  if (
    plan.skillId === PROSPECT_SKILL_ID &&
    step.id === PROSPECT_ESCALATE_STEP &&
    (localLeadCount || 0) <= 0
  ) {
    return (
      "I couldn't find contacts matching those exact filters in your local database. " +
      'Do you want me to start a background Sales Navigator search for matching leads?'
    );
  }
  const argsStr = Object.entries(resolvedArgs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return `${step.description}\n-> ${step.toolCall.name}(${argsStr})`;
}

function countItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.items)) return obj.items.length;
  if (Array.isArray(obj.results)) return obj.results.length;
  if (Array.isArray(obj.contacts)) return obj.contacts.length;
  if (typeof obj.total_matched === 'number' && Number.isFinite(obj.total_matched)) {
    return Math.max(0, Math.floor(obj.total_matched));
  }
  if (typeof obj.count === 'number' && Number.isFinite(obj.count)) {
    return Math.max(0, Math.floor(obj.count));
  }
  return 0;
}

function getProspectLocalLeadCount(
  plan: ExecutionPlan,
  completedResults: Record<string, unknown>
): number {
  if (plan.skillId !== PROSPECT_SKILL_ID) return 0;
  return countItems(completedResults[PROSPECT_DISCOVERY_CONTACT_STEP]);
}

function shouldSkipProspectStep(
  plan: ExecutionPlan,
  stepId: string,
  localLeadCount: number
): boolean {
  if (plan.skillId !== PROSPECT_SKILL_ID) return false;
  if (localLeadCount > 0 && stepId === PROSPECT_ESCALATE_STEP) return true;
  if (localLeadCount <= 0 && PROSPECT_CAMPAIGN_STEP_IDS.has(stepId)) return true;
  return false;
}

function synthesizeSkillResponse(
  _plan: ExecutionPlan,
  executedCalls: ExecutedToolCall[],
  extractedParams: Record<string, unknown>
): string {
  const industry = extractedParams.industry || extractedParams.campaignName || 'unknown';
  const parts: string[] = [];

  for (const call of executedCalls) {
    if (!call.ok) {
      parts.push(`Failed: ${call.name} — ${JSON.stringify((call.result as Record<string, unknown>)?.error || 'Unknown error')}`);
      continue;
    }

    const result = call.result as Record<string, unknown>;

    if (call.name === 'create_campaign') {
      const id = result.id ?? result.campaign_id;
      const name = result.name ?? '';
      const existed = result.already_existed ? ' (already existed)' : '';
      parts.push(`Created campaign "${name}" (ID: ${id})${existed}.`);
    }

    if (call.name === 'enroll_contacts_by_filter') {
      const enrolled = result.enrolled ?? 0;
      const skipped = result.skipped ?? 0;
      const matched = result.total_matched ?? 0;
      parts.push(
        `Enrolled ${enrolled} ${industry}-related contact(s) into the campaign` +
        (skipped ? ` (${skipped} already enrolled)` : '') +
        ` — ${matched} total matched the filter.`
      );
    }
    if (call.name === 'compound_workflow_run') {
      const workflowId = typeof result.workflow_id === 'string' ? result.workflow_id : '';
      const status = typeof result.status === 'string' ? result.status : 'running';
      parts.push(
        `Started background Sales Navigator search${workflowId ? ` (workflow: ${workflowId})` : ''}. ` +
        `Current status: ${status}.`
      );
    }

  }

  if (parts.length === 0) return 'Done.';
  return parts.join('\n\n');
}
