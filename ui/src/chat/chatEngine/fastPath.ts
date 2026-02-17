/**
 * Fast-path planner execution.
 *
 * This is used for:
 * - model fast path plans
 * - browser follow-up fast lanes
 * - confirmed read-only fast lane (via dispatchPlanAndBuildResult in reactAdapter)
 */

import { textMsg } from '../../services/messageHelpers';
import type { PlannedToolCall } from '../chatEngineTypes';
import type { ChatAction } from '../actions';
import type { ChatSessionState } from '../sessionState';
import type { dispatchToolCalls } from '../toolExecutor';
import type { ChatEngineResult, PipelineContext } from './pipelineTypes';
import {
  appendBrowserSessionNoteIfActive,
  baseDebugTrace,
  attachTimingsAndSizes,
} from './dispatchResponse';
import { buildDispatchBackedResult, dispatchAndBuildArtifacts } from './responseBuilder';

type DisambiguationChoice = {
  id: number;
  label: string;
};

type BuildDisambiguationOptions = {
  toolName: string;
  entityType: string;
  idFields: string[];
  labelFields: string[];
  maxChoices?: number;
  requireSameTopLabel?: boolean;
};

function buildDisambiguationChoices(
  dispatched: Awaited<ReturnType<typeof dispatchToolCalls>>,
  options: BuildDisambiguationOptions
): DisambiguationChoice[] {
  const {
    toolName,
    entityType,
    idFields,
    labelFields,
    maxChoices = 5,
    requireSameTopLabel = false,
  } = options;
  const toolResult = [...dispatched.executed].reverse().find((x) => x.name === toolName && x.ok);
  if (!toolResult || !toolResult.result || typeof toolResult.result !== 'object') return [];
  const payload = toolResult.result as { results?: unknown[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  const normalizedEntityType = entityType.trim().toLowerCase();
  const out: DisambiguationChoice[] = [];
  const seen = new Set<number>();
  for (const row of results) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const type = String(record.entity_type || record.entityType || '').trim().toLowerCase();
    if (type !== normalizedEntityType) continue;
    const rawId = idFields
      .map((field) => record[field])
      .find((value) => value !== undefined && value !== null && String(value).trim().length > 0);
    const entityId = Number.parseInt(String(rawId ?? ''), 10);
    if (!Number.isFinite(entityId) || entityId <= 0 || seen.has(entityId)) continue;
    const rawLabel = labelFields
      .map((field) => record[field])
      .find((value) => typeof value === 'string' && String(value).trim().length > 0);
    const label = String(rawLabel || '').trim();
    seen.add(entityId);
    out.push({
      id: entityId,
      label: label || `${entityType} #${entityId}`,
    });
    if (out.length >= maxChoices) break;
  }
  if (!requireSameTopLabel) return out;
  if (out.length <= 1) return out;
  const normalizeName = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const topName = normalizeName(out[0]?.label || '');
  if (!topName) return out.slice(0, 1);
  const sameName = out.filter((choice) => normalizeName(choice.label) === topName);
  if (sameName.length >= 2) return sameName;
  return out.slice(0, 1);
}

function buildEmailDisambiguationChoices(
  dispatched: Awaited<ReturnType<typeof dispatchToolCalls>>
): DisambiguationChoice[] {
  return buildDisambiguationChoices(dispatched, {
    toolName: 'hybrid_search',
    entityType: 'contact',
    idFields: ['entity_id', 'entityId'],
    labelFields: ['title', 'name'],
    maxChoices: 5,
    requireSameTopLabel: true,
  });
}

export async function executeFastPathPlan(params: {
  ctx: PipelineContext;
  fastPlan: { calls: PlannedToolCall[]; uiActions?: ChatAction[]; reason: string };
  routeReason: 'fast_path_browser_followup' | 'fast_path_intent' | 'model_fast_path';
  selectedTools?: string[];
  userMessageForHistory?: string;
  normalizedMessageForSynthesis?: string;
  previousSessionState?: ChatSessionState;
}): Promise<ChatEngineResult> {
  const {
    ctx,
    fastPlan,
    routeReason,
    selectedTools,
    userMessageForHistory,
    normalizedMessageForSynthesis,
    previousSessionState,
  } = params;

  // Email lookup fast path has special UX: show disambiguation prompt and buttons,
  // but do not append the synthesized execution summary to conversation history.
  if (fastPlan.reason === 'fast_path_entity_lookup') {
    const {
      updatedHistoryPrefix,
      dispatched,
      synthesized,
      grounded,
      nextSessionState,
      selectedToolsForTrace,
    } = await dispatchAndBuildArtifacts({
      ctx,
      calls: fastPlan.calls,
      routeReason,
      selectedTools,
      allowSkipSynthesis: true,
      previousSessionState,
      phaseOverride: ctx.phase,
      userMessageForHistory: userMessageForHistory ?? ctx.resolvedMessage ?? ctx.normalizedMessage,
      metaOverride: {
        rawUserMessage: ctx.userMessage,
        intentText: normalizedMessageForSynthesis ?? (ctx.resolvedMessage ?? ctx.normalizedMessage),
        pageContext: ctx.pageContext,
      },
      defaultResponse: 'Executed fast path actions.',
      postProcessAssistantText: (assistantText, dispatchedResult) =>
        appendBrowserSessionNoteIfActive(dispatchedResult, assistantText),
    });

    const emailDisambiguationChoices = buildEmailDisambiguationChoices(dispatched);
    if (emailDisambiguationChoices.length === 0) {
      const followupPrompt =
        'I could not find a clear matching record. Share more detail (name, company, or identifier) and I will try again.';
      return {
        response: followupPrompt,
        updatedHistory: [
          ...updatedHistoryPrefix,
          { role: 'assistant', content: followupPrompt },
        ],
        messages: [
          ...grounded.messages,
          textMsg(followupPrompt),
        ],
        modelUsed: 'qwen3',
        toolsUsed: dispatched.toolsUsed,
        fallbackUsed: false,
        sessionState: nextSessionState,
        ...(ctx.includeDebugTrace ? { debugTrace: attachTimingsAndSizes(baseDebugTrace(ctx, {
          route: 'qwen3',
          routeReason,
          modelUsed: 'qwen3',
          success: dispatched.success,
          selectedTools: selectedToolsForTrace,
          nativeToolCalls: 0,
          tokenToolCalls: fastPlan.calls.length,
          toolsUsed: dispatched.toolsUsed,
          fallbackUsed: false,
          modelSwitches: [],
          phase: ctx.phase,
          executedCalls: dispatched.executed.map((x) => ({ name: x.name, args: x.args, ok: x.ok, result: x.result, durationMs: x.durationMs })),
          rawUserMessage: ctx.userMessage,
          intentText: ctx.resolvedMessage ?? ctx.normalizedMessage,
          pageContext: ctx.pageContext || undefined,
          synthesisMs: ctx.timings.synthesisMs,
          synthesisModelUsed: synthesized.modelUsed,
          synthesized: synthesized.synthesized,
          synthesisPromptChars: synthesized.promptChars,
        }), ctx.timings, ctx.sizeMetrics) } : {}),
      };
    }
    if (emailDisambiguationChoices.length > 0) {
      const followupPrompt =
        emailDisambiguationChoices.length > 1
          ? 'I found multiple matching records. Which one should I use?'
          : `I found ${emailDisambiguationChoices[0]?.label || 'a matching record'}. Should I proceed with this target?`;

      return {
        response: followupPrompt,
        updatedHistory: [
          ...updatedHistoryPrefix,
          { role: 'assistant', content: followupPrompt },
        ],
        messages: [
          ...grounded.messages,
          textMsg(followupPrompt),
          {
            id: `email-disambiguation-${Date.now()}`,
            type: 'action_buttons',
            sender: 'bot',
            content: emailDisambiguationChoices.length > 1 ? 'Pick one match:' : 'Confirm target:',
            timestamp: new Date(),
            buttons:
              emailDisambiguationChoices.length > 1
                ? emailDisambiguationChoices.map((choice) => ({
                    label: choice.label.length > 48 ? `${choice.label.slice(0, 45)}...` : choice.label,
                    value: `pick_contact_for_email:${choice.id}`,
                    variant: 'primary' as const,
                  }))
                : [
                    {
                      label: `Use ${emailDisambiguationChoices[0]?.label || 'match'}`,
                      value: `pick_contact_for_email:${emailDisambiguationChoices[0]?.id || 0}`,
                      variant: 'primary' as const,
                    },
                  ],
          },
        ],
        modelUsed: 'qwen3',
        toolsUsed: dispatched.toolsUsed,
        fallbackUsed: false,
        sessionState: nextSessionState,
        ...(ctx.includeDebugTrace ? { debugTrace: attachTimingsAndSizes(baseDebugTrace(ctx, {
          route: 'qwen3',
          routeReason,
          modelUsed: 'qwen3',
          success: dispatched.success,
          selectedTools: selectedToolsForTrace,
          nativeToolCalls: 0,
          tokenToolCalls: fastPlan.calls.length,
          toolsUsed: dispatched.toolsUsed,
          fallbackUsed: false,
          modelSwitches: [],
          phase: ctx.phase,
          executedCalls: dispatched.executed.map((x) => ({ name: x.name, args: x.args, ok: x.ok, result: x.result, durationMs: x.durationMs })),
          rawUserMessage: ctx.userMessage,
          intentText: ctx.resolvedMessage ?? ctx.normalizedMessage,
          pageContext: ctx.pageContext || undefined,
          synthesisMs: ctx.timings.synthesisMs,
          synthesisModelUsed: synthesized.modelUsed,
          synthesized: synthesized.synthesized,
          synthesisPromptChars: synthesized.promptChars,
        }), ctx.timings, ctx.sizeMetrics) } : {}),
      };
    }

    // No disambiguation needed: return the grounded execution result.
    return {
      response: grounded.response,
      updatedHistory: [
        ...updatedHistoryPrefix,
        { role: 'assistant', content: grounded.response },
      ],
      messages: grounded.messages,
      modelUsed: 'qwen3',
      toolsUsed: dispatched.toolsUsed,
      fallbackUsed: false,
      sessionState: nextSessionState,
      ...(ctx.includeDebugTrace ? { debugTrace: attachTimingsAndSizes(baseDebugTrace(ctx, {
        route: 'qwen3',
        routeReason,
        modelUsed: 'qwen3',
        success: dispatched.success,
        selectedTools: selectedToolsForTrace,
        nativeToolCalls: 0,
        tokenToolCalls: fastPlan.calls.length,
        toolsUsed: dispatched.toolsUsed,
        fallbackUsed: false,
        modelSwitches: [],
        phase: ctx.phase,
        executedCalls: dispatched.executed.map((x) => ({ name: x.name, args: x.args, ok: x.ok, result: x.result, durationMs: x.durationMs })),
        rawUserMessage: ctx.userMessage,
        intentText: ctx.resolvedMessage ?? ctx.normalizedMessage,
        pageContext: ctx.pageContext || undefined,
        synthesisMs: ctx.timings.synthesisMs,
        synthesisModelUsed: synthesized.modelUsed,
        synthesized: synthesized.synthesized,
        synthesisPromptChars: synthesized.promptChars,
      }), ctx.timings, ctx.sizeMetrics) } : {}),
    };
  }

  return await buildDispatchBackedResult({
    ctx,
    calls: fastPlan.calls,
    uiActions: fastPlan.uiActions || [],
    routeReason,
    selectedTools,
    allowSkipSynthesis: true,
    previousSessionState,
    phaseOverride: ctx.phase,
    userMessageForHistory,
    defaultResponse: 'Executed fast path actions.',
    postProcessAssistantText: (assistantText, dispatched) => appendBrowserSessionNoteIfActive(dispatched, assistantText),
  });
}

