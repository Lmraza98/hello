/**
 * Skill system adapter.
 *
 * Responsibilities:
 * - Skill-first routing (must run before conversational short-circuit)
 * - Skill plan confirmation persistence via sessionState.activeWorkItem
 * - Resuming pending skill plans with TTL handling
 *
 * Nonnegotiable behavior:
 * - Skill matching uses RAW `intentText` / normalized user intent only.
 *   Do not inject session context blocks into the matcher input.
 */

import { textMsg } from '../../services/messageHelpers';
import { trySkillRoute, resumeSkillExecution } from '../../assistant-core';
import { generateCorrelationId, isWorkItemExpired, WORK_ITEM_TTL_MS, type ActiveWorkItem, type ExecutionPlan } from '../../assistant-core/domain/types';
import { executeTool } from '../toolExecutor';
import { createTask, transitionTask, type Task } from '../taskState';
import type { ChatCompletionMessageParam } from '../chatEngineTypes';
import type { ChatSessionState } from '../sessionState';
import type { ChatEngineResult, PipelineContext } from './pipelineTypes';
import { ENABLE_SKILL_ROUTER } from './env';

export function buildSkillWorkItemFromPendingConfirmation(params: {
  skillId: string;
  plan: ExecutionPlan;
  nextStepIndex: number;
  completedResults: Record<string, unknown>;
  executedStepIds: string[];
  summary: string;
  correlationId?: string;
  generateNewCorrelationId?: boolean;
}): ActiveWorkItem {
  const now = Date.now();
  const correlationId =
    params.generateNewCorrelationId
      ? generateCorrelationId()
      : (params.correlationId || generateCorrelationId());
  return {
    kind: 'skill_plan',
    skillId: params.skillId,
    plan: params.plan,
    nextStepIndex: params.nextStepIndex,
    completedResults: params.completedResults,
    executedStepIds: params.executedStepIds,
    summary: params.summary,
    createdAt: now,
    expiresAt: now + WORK_ITEM_TTL_MS,
    correlationId,
  };
}

export function buildSkillConfirmationResult(params: {
  history: ChatCompletionMessageParam[];
  userMessage: string;
  summary: string;
  executedToolNames: string[];
  updatedSession: ChatSessionState;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}): ChatEngineResult {
  return {
    response: '',
    updatedHistory: [...params.history, { role: 'user', content: params.userMessage }, { role: 'assistant', content: params.summary }],
    messages: [textMsg('Confirm to continue.')],
    modelUsed: 'qwen3',
    toolsUsed: params.executedToolNames,
    fallbackUsed: false,
    sessionState: params.updatedSession,
    confirmation: {
      required: true,
      summary: params.summary,
      calls: params.calls,
    },
  };
}

export function clearExpiredSkillWorkItemResult(params: {
  history: ChatCompletionMessageParam[];
  userMessage: string;
  sessionState?: ChatSessionState;
}): ChatEngineResult {
  const expiredSession: ChatSessionState = {
    ...(params.sessionState || { entities: [] }),
    activeWorkItem: undefined,
    activeTask: undefined,
  };
  const msg = 'That confirmation has expired. Please start the request again.';
  return {
    response: msg,
    updatedHistory: [...params.history, { role: 'user', content: params.userMessage }, { role: 'assistant', content: msg }],
    messages: [textMsg(msg)],
    modelUsed: 'qwen3',
    toolsUsed: [],
    fallbackUsed: false,
    sessionState: expiredSession,
  };
}

export async function trySkillFirst(ctx: PipelineContext): Promise<ChatEngineResult | null> {
  if (!ENABLE_SKILL_ROUTER) return null;
  if (ctx.phase !== 'planning') return null;
  if (ctx.options.confirmedToolCalls?.length) return null;

  const emitPlannerEvent = (msg: string) => ctx.options.onPlannerEvent?.(msg);

  try {
    const skillResult = await trySkillRoute(ctx.intentText.trim() || ctx.normalizedMessage, {
      onToolCall: ctx.options.onToolCall,
      onEvent: (event) => {
        if (event.type === 'skill_matched') {
          emitPlannerEvent(`Skill matched: ${event.skillId} (confidence: ${event.confidence.toFixed(2)})`);
        } else if (event.type === 'plan_created') {
          emitPlannerEvent(`Skill plan: ${event.stepCount} step(s)`);
        } else if (event.type === 'step_started') {
          emitPlannerEvent(`Running ${event.toolName}...`);
        } else if (event.type === 'step_completed') {
          emitPlannerEvent(`${event.toolName} ${event.ok ? 'completed' : 'failed'} (${event.durationMs}ms)`);
        }
      },
      executeTool,
      sessionContext: ctx.sessionState
        ? {
            activeEntity: ctx.sessionState.activeEntity
              ? {
                  type: ctx.sessionState.activeEntity.entityType,
                  id: ctx.sessionState.activeEntity.entityId,
                  label: ctx.sessionState.activeEntity.label,
                }
              : undefined,
          }
        : {},
    });

    if (!skillResult?.handled) return null;

    if (skillResult.pendingConfirmation) {
      const summary = skillResult.pendingConfirmation.summary;
      const workItem = buildSkillWorkItemFromPendingConfirmation({
        skillId: skillResult.pendingConfirmation.plan.skillId,
        plan: skillResult.pendingConfirmation.plan,
        nextStepIndex: skillResult.pendingConfirmation.nextStepIndex,
        completedResults: skillResult.pendingConfirmation.completedResults,
        executedStepIds: skillResult.pendingConfirmation.executedStepIds,
        summary,
        generateNewCorrelationId: true,
      });

      const updatedSession: ChatSessionState = {
        ...(ctx.sessionState || { entities: [] }),
        activeWorkItem: workItem,
        activeTask: {
          ...createTask(ctx.normalizedMessage),
          status: 'paused',
          params: { _skillWorkItemCorrelationId: workItem.correlationId },
        },
      };

      return buildSkillConfirmationResult({
        history: ctx.history,
        userMessage: ctx.userMessage,
        summary,
        executedToolNames: skillResult.executedCalls.map((c) => c.name),
        updatedSession,
        calls: skillResult.pendingConfirmation.plan.steps
          .slice(skillResult.pendingConfirmation.nextStepIndex)
          .map((s) => ({ name: s.toolCall.name, args: s.toolCall.args })),
      });
    }

    const updatedHistory: ChatCompletionMessageParam[] = [
      ...ctx.history,
      { role: 'user', content: ctx.userMessage },
      { role: 'assistant', content: skillResult.response },
    ];
    return {
      response: skillResult.response,
      updatedHistory,
      messages: skillResult.messages,
      modelUsed: 'qwen3',
      toolsUsed: skillResult.executedCalls.map((c) => c.name),
      fallbackUsed: false,
      sessionState: ctx.sessionState,
    };
  } catch {
    emitPlannerEvent('Skill router failed. Falling back to LLM planner.');
    return null;
  }
}

export async function resumeSkillWorkItem(params: {
  ctx: PipelineContext;
  updatedTask: Task;
}): Promise<ChatEngineResult | null> {
  const { ctx } = params;
  if (!ENABLE_SKILL_ROUTER) return null;
  const workItem = ctx.sessionState?.activeWorkItem;
  if (!workItem || workItem.kind !== 'skill_plan') return null;

  if (isWorkItemExpired(workItem)) {
    return clearExpiredSkillWorkItemResult({
      history: ctx.history,
      userMessage: ctx.userMessage,
      sessionState: ctx.sessionState,
    });
  }

  const emitPlannerEvent = (msg: string) => ctx.options.onPlannerEvent?.(msg);

  const pendingSkill = {
    plan: workItem.plan,
    nextStepIndex: workItem.nextStepIndex,
    completedResults: workItem.completedResults,
    executedStepIds: workItem.executedStepIds,
    summary: workItem.summary,
  };

  const skillResult = await resumeSkillExecution(pendingSkill, true, {
    onToolCall: ctx.options.onToolCall,
    onEvent: (event) => {
      if (event.type === 'step_started') emitPlannerEvent(`Running ${event.toolName}...`);
      if (event.type === 'step_completed') emitPlannerEvent(`${event.toolName} ${event.ok ? 'completed' : 'failed'} (${event.durationMs}ms)`);
    },
    executeTool,
  });

  if (skillResult.pendingConfirmation) {
    const summary = skillResult.pendingConfirmation.summary;
    const nextWorkItem = buildSkillWorkItemFromPendingConfirmation({
      skillId: workItem.skillId,
      plan: skillResult.pendingConfirmation.plan,
      nextStepIndex: skillResult.pendingConfirmation.nextStepIndex,
      completedResults: skillResult.pendingConfirmation.completedResults,
      executedStepIds: skillResult.pendingConfirmation.executedStepIds,
      summary,
      correlationId: workItem.correlationId,
      generateNewCorrelationId: false,
    });
    const updatedSession: ChatSessionState = {
      ...(ctx.sessionState || { entities: [] }),
      activeWorkItem: nextWorkItem,
      activeTask: {
        ...params.updatedTask,
        status: 'paused',
        params: { _skillWorkItemCorrelationId: nextWorkItem.correlationId },
      },
    };
    return buildSkillConfirmationResult({
      history: ctx.history,
      userMessage: ctx.userMessage,
      summary,
      executedToolNames: skillResult.executedCalls.map((c) => c.name),
      updatedSession,
      calls: skillResult.pendingConfirmation.plan.steps
        .slice(skillResult.pendingConfirmation.nextStepIndex)
        .map((s) => ({ name: s.toolCall.name, args: s.toolCall.args })),
    });
  }

  const updatedSession: ChatSessionState = {
    ...(ctx.sessionState || { entities: [] }),
    activeWorkItem: undefined,
    activeTask: transitionTask(params.updatedTask, 'completed', 'skill_execution_finished'),
  };
  return {
    response: skillResult.response,
    updatedHistory: [...ctx.history, { role: 'user', content: ctx.userMessage }, { role: 'assistant', content: skillResult.response }],
    messages: skillResult.messages,
    modelUsed: 'qwen3',
    toolsUsed: skillResult.executedCalls.map((c) => c.name),
    fallbackUsed: false,
    sessionState: updatedSession,
  };
}
