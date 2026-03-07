/**
 * Chat engine message pipeline.
 *
 * Ordered steps (early-return):
 * A) buildPipelineContext
 * B) sessionCoreferenceAndDisambiguation
 * C) trySkillFirst
 * D) activeTaskAndSkillResume
 * E) resumePendingConfirmation
 * F) conversationalShortCircuit
 * G) pendingTaskPlanResume
 * H) taskDecomposition
 * I) browserFollowUp
 * J) modelFastPath
 * K) paramCollectionGate
 * L) genericRetrievalBootstrap
 * M) routeAndRunPlannerOrFallback
 */

import { textMsg } from '../../services/messageHelpers';
import type { ChatCompletionMessageParam, ChatPhase } from '../chatEngineTypes';
import { extractUserIntentText, extractPageContext, applyRefinementRules } from '../messageParsing';
import { toLocalHistory, getOllamaReadyFast } from '../ollamaStatus';
import { nowMs, elapsedMs } from '../timing';
import { compactPlannerHistoryByTurns, CHAT_PLANNER_MAX_USER_TURNS } from '../runtimeGuards';
import { estimateChars } from '../chatEngineDebug';
import { withSessionContext } from '../sessionState';
import { routeMessage, type ModelRoute } from '../router';
import { recordToolFailure } from '../finetuneCapture';
import { runWithFallback } from '../fallbackPipeline';
import { ollamaChat } from '../models/ollamaClient';
import { runToolPlan } from '../models/toolPlanner';
import { assessComplexity } from '../models/toolPlanner/complexityClassifier';
import { stripPlannerHeuristicContext } from '../models/toolPlanner/sessionBlocks';
import { analyzeTaskRequirements } from '../taskClassifiers';
import { createTask, isTaskActive, transitionTask, type ParamRequest } from '../taskState';
import { handleActiveTask, EXECUTE_TASK_SENTINEL, generateParamRequest } from '../taskHandler';
import {
  hasOpenBrowserSessionSignal,
  isBrowserFollowUpIntent,
  isExplicitBrowserAutomationIntent,
  isLikelyInternalUiIntent,
} from '../chatEnginePolicy';
import { TOOLS } from '../tools';

import { TOOL_BRAIN_MODEL, TOOL_BRAIN_NAME } from '../models/toolBrainConfig';
import { AVOID_DUPLICATE_PLANNER_PASSES, CHAT_BENCHMARK_MODEL, CHAT_BENCHMARK_NUM_PREDICT, CONVERSATION_MODEL, ENABLE_CHAT_BENCHMARK_MODE, ENABLE_CHAT_ENGINE_DEBUG_TRACE, ENABLE_CHAT_ENGINE_HEAVY_DEBUG_TRACE, ENABLE_CHAT_MODEL_FAST_PATH, ENABLE_GENERIC_RETRIEVAL_BOOTSTRAP, ENABLE_OPENAI_FALLBACK, MODEL_FAST_PATH_ALLOWED_TOOLS } from './env';
import { attachTimingsAndSizes } from './dispatchResponse';
import { buildSessionEntityChoices, resolveSessionCoreference } from './coreference';
import { decomposeTask } from './taskDecomposer';
import { executeFastPathPlan } from './fastPath';
import { handleToolRoute, buildReActConfig } from './reactAdapter';
import { trySkillFirst, resumeSkillWorkItem } from './skillAdapter';
import { deserializeStepContext, serializeStepContext } from './stepContext';
import { executeTaskPlan } from './taskPlanExecutor';
import { classifyIntent } from './intentClassifier';

import type { ChatEngineOptions, ChatEngineResult, ChatEngineSizeMetrics, ChatEngineTimings, MessageMeta, PipelineContext, StepResult } from './pipelineTypes';

function buildSelectedToolsGetter() {
  const selectedToolsForMessageCache: { value: string[] | null } = { value: null };
  return (): string[] => {
    if (!selectedToolsForMessageCache.value) {
      selectedToolsForMessageCache.value = TOOLS.map((tool) => tool.function.name);
    }
    return selectedToolsForMessageCache.value;
  };
}

function finalizeResult(ctx: PipelineContext, startedAt: number, result: ChatEngineResult): ChatEngineResult {
  ctx.timings.totalMs = elapsedMs(startedAt);

  // Auto-complete executing tasks when we reach a final result.
  if (result.sessionState?.activeTask?.status === 'executing') {
    result = {
      ...result,
      sessionState: {
        ...result.sessionState,
        activeTask: transitionTask(result.sessionState.activeTask, 'completed', 'execution_finished'),
      },
    };
  }

  if (!result.debugTrace) return result;
  return {
    ...result,
    debugTrace: attachTimingsAndSizes(result.debugTrace, ctx.timings, ctx.sizeMetrics),
  };
}

export function buildPipelineContext(
  userMessage: string,
  options: ChatEngineOptions
): {
  ctx: PipelineContext;
  startedAt: number;
  emitPlannerEvent: (msg: string) => void;
} {
  const emitPlannerEvent = (msg: string) => options.onPlannerEvent?.(msg);
  const startedAt = nowMs();
  const timings: ChatEngineTimings = { totalMs: 0 };
  const phase: ChatPhase = options.phase || 'planning';
  const history = options.conversationHistory || [];
  const includeDebugTrace = options.debug ?? ENABLE_CHAT_ENGINE_DEBUG_TRACE;
  const includeHeavyDebug = includeDebugTrace && (options.debugHeavy ?? ENABLE_CHAT_ENGINE_HEAVY_DEBUG_TRACE);
  const intentText = extractUserIntentText(userMessage);
  const pageContext = extractPageContext(userMessage);
  const baseMessage = intentText.trim() || userMessage.trim();
  const normalizedMessage = phase === 'refining' ? applyRefinementRules(baseMessage) : baseMessage;

  const localHistory = toLocalHistory(history);
  const plannerHistory = compactPlannerHistoryByTurns(localHistory, CHAT_PLANNER_MAX_USER_TURNS);

  const historyChars = history.reduce((sum, message) => sum + estimateChars((message as { content?: unknown }).content), 0);
  const localHistoryChars = localHistory.reduce((sum, message) => sum + estimateChars(message.content), 0);

  const sizeMetrics: ChatEngineSizeMetrics = {
    historyChars,
    localHistoryChars,
    promptChars: normalizedMessage.length + localHistoryChars,
  };

  const sessionContext = options.sessionState && options.sessionState.entities.length > 0
    ? withSessionContext('Recent resolved entities for this conversation.', options.sessionState)
    : '';

  const reactConfig = buildReActConfig(options, pageContext, sessionContext);

  const meta: MessageMeta = { rawUserMessage: userMessage, intentText, pageContext };

  const ctx: PipelineContext = {
    userMessage,
    history,
    localHistory,
    phase,
    options,
    sessionState: options.sessionState,
    intentText,
    pageContext,
    normalizedMessage,
    includeDebugTrace,
    includeHeavyDebug,
    timings,
    sizeMetrics,
    plannerHistory,
    reactConfig,
    meta,
    getSelectedToolsForMessage: buildSelectedToolsGetter(),
  };

  return { ctx, startedAt, emitPlannerEvent };
}

async function stepTrySkillFirst(ctx: PipelineContext): Promise<StepResult> {
  if (ctx.phase !== 'planning') return null;
  if (ctx.options.confirmedToolCalls?.length) return null;
  try {
    return await trySkillFirst(ctx);
  } catch {
    return null;
  }
}

function isAffirmativeToken(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/[.!?]+$/g, '');
  const affirmatives = new Set([
    'yes',
    'y',
    'yeah',
    'yep',
    'ok',
    'okay',
    'sure',
    'go ahead',
    'do it',
    'proceed',
    'continue',
  ]);
  return affirmatives.has(normalized);
}

function lastAssistantAskedToConfirm(history: ChatCompletionMessageParam[]): boolean {
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string');
  const last = (typeof lastAssistant?.content === 'string' ? lastAssistant.content : '').toLowerCase();
  return /\b(would you like me to proceed|should i proceed|do you want me to proceed|confirm to run|confirm|shall i proceed|ready to execute|awaiting confirmation|send the email)\b/i.test(last);
}

function modelRouteFromId(modelId: string): ModelRoute {
  if (/qwen/i.test(modelId)) return 'qwen3';
  if (/deepseek/i.test(modelId)) return 'deepseek';
  if (/gpt|openai/i.test(modelId)) return 'openai';
  return 'gemma';
}

async function stepBenchmarkSinglePass(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  if (!ENABLE_CHAT_BENCHMARK_MODE) return null;
  if (ctx.options.confirmedToolCalls?.length) return null;
  if (ctx.phase !== 'planning') return null;

  emitPlannerEvent?.(`Benchmark mode enabled. Running single-pass model call (${CHAT_BENCHMARK_MODEL}).`);
  const route = modelRouteFromId(CHAT_BENCHMARK_MODEL);
  try {
    const started = nowMs();
    const resp = await ollamaChat({
      model: CHAT_BENCHMARK_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a concise assistant. Respond directly to the user request.',
        },
        { role: 'user', content: ctx.normalizedMessage },
      ],
      temperature: 0.2,
      numPredict: CHAT_BENCHMARK_NUM_PREDICT,
      onToken: ctx.options.onAssistantToken,
    });
    const elapsed = elapsedMs(started);
    ctx.timings.fallbackMs = elapsed;

    const text = (resp.message.content || '').trim() || 'No response.';
    const updatedHistory: ChatCompletionMessageParam[] = [
      ...ctx.history,
      { role: 'user', content: ctx.userMessage },
      { role: 'assistant', content: text },
    ];

    const evalCount = Number(resp.eval_count || 0);
    const totalDurationNs = Number(resp.total_duration || 0);
    const tokensPerSec =
      evalCount > 0 && totalDurationNs > 0
        ? Math.round((evalCount / (totalDurationNs / 1_000_000_000)) * 10) / 10
        : undefined;
    if (tokensPerSec != null) {
      emitPlannerEvent?.(`Benchmark throughput: ~${tokensPerSec} tok/s (${evalCount} tokens).`);
    }

    return {
      response: text,
      updatedHistory,
      messages: [textMsg(text)],
      modelUsed: route,
      toolsUsed: [],
      fallbackUsed: false,
      sessionState: ctx.options.sessionState,
      ...(ctx.includeDebugTrace
        ? {
            debugTrace: {
              route,
              routeReason: 'benchmark_single_pass',
              modelUsed: route,
              toolBrainName: TOOL_BRAIN_NAME,
              toolBrainModel: TOOL_BRAIN_MODEL,
              success: true,
              selectedTools: [],
              nativeToolCalls: 0,
              tokenToolCalls: 0,
              toolsUsed: [],
              fallbackUsed: false,
              modelSwitches: [],
              phase: ctx.phase,
              rawUserMessage: ctx.userMessage,
              intentText: ctx.normalizedMessage,
              pageContext: ctx.pageContext || undefined,
              executionTrace: [
                `benchmark_model=${CHAT_BENCHMARK_MODEL}`,
                `benchmark_elapsed_ms=${elapsed}`,
                `benchmark_eval_count=${evalCount}`,
                `benchmark_total_duration_ns=${totalDurationNs}`,
                ...(tokensPerSec != null ? [`benchmark_tok_per_sec=${tokensPerSec}`] : []),
              ],
            },
          }
        : {}),
    };
  } catch {
    emitPlannerEvent?.('Benchmark single-pass failed. Falling back to normal pipeline.');
    return null;
  }
}

async function stepConversationalShortCircuit(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  if (isAffirmativeToken(ctx.resolvedMessage || ctx.normalizedMessage) && lastAssistantAskedToConfirm(ctx.history)) {
    return null;
  }
  if (ctx.intentKind !== 'conversational') return null;
  emitPlannerEvent?.('Conversational â€” skipping tool planning.');
  const chatModel = ctx.options.chatModelOverride || CONVERSATION_MODEL;
  try {
    const started = nowMs();
    const resp = await ollamaChat({
      model: chatModel,
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful sales development assistant. Answer naturally and concisely. ' +
            'You can help with: finding contacts and companies, searching Sales Navigator, ' +
            'managing campaigns, sending emails, and browser automation on any website. ' +
            'If the user asks for up-to-date public internet facts (e.g., YouTube view counts), ' +
            "do not guess: explain you can't verify live values unless a tool/skill is used.",
        },
        ...ctx.localHistory.slice(-6),
        { role: 'user', content: ctx.normalizedMessage },
      ],
      temperature: 0.7,
      numPredict: 512,
      onToken: ctx.options.onAssistantToken,
    });
    ctx.timings.fallbackMs = elapsedMs(started);
    const text =
      (resp.message.content || '').trim() ||
      "I'm a sales assistant. I can search contacts/companies, navigate Sales Navigator, manage campaigns, and help with browser automation.";
    const updatedHistory: ChatCompletionMessageParam[] = [
      ...ctx.history,
      { role: 'user', content: ctx.userMessage },
      { role: 'assistant', content: text },
    ];
    const conversationalRoute = modelRouteFromId(chatModel);

    return {
      response: text,
      updatedHistory,
      messages: [textMsg(text)],
      modelUsed: conversationalRoute,
      toolsUsed: [],
      fallbackUsed: false,
      sessionState: ctx.options.sessionState,
      ...(ctx.includeDebugTrace
        ? {
            debugTrace: {
              route: conversationalRoute,
              routeReason: 'conversational',
              modelUsed: conversationalRoute,
              toolBrainName: TOOL_BRAIN_NAME,
              toolBrainModel: TOOL_BRAIN_MODEL,
              success: true,
              selectedTools: [],
              nativeToolCalls: 0,
              tokenToolCalls: 0,
              toolsUsed: [],
              fallbackUsed: false,
              modelSwitches: [],
              phase: ctx.phase,
              rawUserMessage: ctx.userMessage,
              intentText: ctx.normalizedMessage,
              pageContext: ctx.pageContext || undefined,
            },
          }
        : {}),
    };
  } catch {
    // If conversational response fails, fall through to the normal pipeline.
    return null;
  }
}

async function stepActiveTaskAndSkillResume(ctx: PipelineContext): Promise<StepResult> {
  const activeTask = ctx.options.sessionState?.activeTask;
  if (!(activeTask && isTaskActive(activeTask) && ctx.phase === 'planning')) return null;

  const taskResult = await handleActiveTask(
    ctx.normalizedMessage,
    activeTask,
    ctx.history,
    ctx.options
  );

  if (taskResult === null) {
    // new_topic: park and fall through
    if (ctx.options.sessionState) {
      ctx.options.sessionState = {
        ...ctx.options.sessionState,
        activeTask: transitionTask(activeTask, 'paused', 'user_changed_topic'),
      };
      ctx.sessionState = ctx.options.sessionState;
    }
    return null;
  }

  // Task handler consumed the message
  if (taskResult.result.response === EXECUTE_TASK_SENTINEL) {
    const skillResumed = await resumeSkillWorkItem({ ctx: { ...ctx, sessionState: ctx.options.sessionState }, updatedTask: taskResult.updatedTask });
    if (skillResumed) return skillResumed;

    // Non-skill task execution â€” build synthetic message and recurse
    const syntheticMessage =
      (typeof taskResult.updatedTask.params._syntheticMessage === 'string'
        ? taskResult.updatedTask.params._syntheticMessage
        : `${taskResult.updatedTask.goal}\nParameters: ${JSON.stringify(taskResult.updatedTask.params)}`);

    const updatedSession = {
      ...(ctx.options.sessionState || { entities: [] }),
      activeTask: taskResult.updatedTask,
    };

    return await processMessagePipeline(syntheticMessage, {
      ...ctx.options,
      sessionState: updatedSession,
      _skipTaskDecomposition: true,
    });
  }

  const updatedSession = {
    ...(ctx.options.sessionState || { entities: [] }),
    activeTask: taskResult.updatedTask,
  };
  return {
    ...taskResult.result,
    sessionState: updatedSession,
  };
}

async function stepResumePendingConfirmation(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  if (!isAffirmativeToken(ctx.resolvedMessage || ctx.normalizedMessage)) return null;
  if (!lastAssistantAskedToConfirm(ctx.history)) return null;

  const activeTask = ctx.options.sessionState?.activeTask;
  const activeWorkItem = ctx.options.sessionState?.activeWorkItem;

  // 1) Resume pending skill-plan confirmation first.
  if (activeWorkItem?.kind === 'skill_plan' && activeTask && isTaskActive(activeTask) && ctx.phase === 'planning') {
    try {
      return await resumeSkillWorkItem({
        ctx: { ...ctx, sessionState: ctx.options.sessionState },
        updatedTask: transitionTask(activeTask, 'executing', 'user_confirmed'),
      });
    } catch {
      return null;
    }
  }

  // 2) Resume pending multi-step task confirmation flow.
  if (ctx.options.pendingTaskPlan && (ctx.options.confirmedToolCalls?.length || 0) > 0) {
    return await stepPendingTaskPlanResume(ctx, emitPlannerEvent);
  }

  // 3) Resume confirmed tool-call flow when calls are present.
  if ((ctx.options.confirmedToolCalls?.length || 0) > 0) {
    const reactStartedAt = nowMs();
    const result = await handleToolRoute({
      ctx,
      userMessage: ctx.plannerMessage || (ctx.resolvedMessage || ctx.normalizedMessage),
      history: ctx.history,
      options: {
        ...ctx.options,
        phase: 'executing',
      },
      plannerHistory: ctx.plannerHistory,
      reactConfig: ctx.reactConfig,
      includeDebugTrace: ctx.includeDebugTrace,
      includeHeavyDebug: ctx.includeHeavyDebug,
      timings: ctx.timings,
      meta: {
        ...ctx.meta,
        intentText: ctx.resolvedMessage || ctx.normalizedMessage,
      },
      previousSessionState: ctx.options.sessionState,
    });
    ctx.timings.reactMs = elapsedMs(reactStartedAt);
    return result;
  }

  // 4) Fall back to active task confirmation handling.
  if (activeTask && isTaskActive(activeTask) && ctx.phase === 'planning') {
    return await stepActiveTaskAndSkillResume(ctx);
  }

  return null;
}

async function stepSessionCoreferenceAndDisambiguation(ctx: PipelineContext): Promise<StepResult> {
  const sessionResolution = await resolveSessionCoreference(ctx.normalizedMessage, ctx.options.sessionState);
  ctx.resolvedMessage = sessionResolution.normalizedMessage;
  ctx.plannerMessage = withSessionContext(ctx.resolvedMessage, ctx.options.sessionState);
  ctx.sessionContext = ctx.options.sessionState && ctx.options.sessionState.entities.length > 0
    ? withSessionContext('Recent resolved entities for this conversation.', ctx.options.sessionState)
    : '';

  // Update prompt size metrics now that resolvedMessage is known.
  if (ctx.sizeMetrics) {
    ctx.sizeMetrics = {
      ...ctx.sizeMetrics,
      promptChars: (ctx.resolvedMessage || ctx.normalizedMessage).length + ctx.sizeMetrics.localHistoryChars,
    };
  }

  if (ctx.phase === 'planning' && !(ctx.options.confirmedToolCalls?.length) && sessionResolution.ambiguous) {
    const sessionChoices = buildSessionEntityChoices(ctx.options.sessionState);
    if (sessionChoices.length >= 2) {
      const prompt = 'I found multiple entities in this conversation. Which one should I use?';
      return {
        response: prompt,
        updatedHistory: [
          ...ctx.history,
          { role: 'user', content: ctx.normalizedMessage },
          { role: 'assistant', content: prompt },
        ],
        messages: [
          textMsg(prompt),
          {
            id: `entity-disambiguation-${Date.now()}`,
            type: 'action_buttons',
            sender: 'bot',
            content: 'Pick an entity:',
            timestamp: new Date(),
            buttons: sessionChoices.map((choice) => ({
              label: choice.label.length > 56 ? `${choice.label.slice(0, 53)}...` : choice.label,
              value: `pick_entity:${choice.entityType}:${choice.entityId}`,
              variant: 'primary' as const,
            })),
          },
        ],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState: ctx.options.sessionState,
      };
    }
  }

  return null;
}

async function stepPendingTaskPlanResume(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  if (
    ctx.phase !== 'executing' ||
    !(ctx.options.confirmedToolCalls?.length) ||
    !ctx.options.pendingTaskPlan ||
    ctx.options.pendingTaskPlan.steps.length === 0
  ) {
    return null;
  }

  emitPlannerEvent('Resuming pending multi-step task plan after confirmation.');
  const reactStartedAt = nowMs();
  const confirmedStepResult = await handleToolRoute({
    ctx,
    userMessage: ctx.plannerMessage || ctx.normalizedMessage,
    history: ctx.history,
    options: { ...ctx.options, _skipTaskDecomposition: true, debug: true },
    plannerHistory: ctx.plannerHistory,
    reactConfig: ctx.reactConfig,
    includeDebugTrace: true, // capture executedCalls for downstream steps
    includeHeavyDebug: false,
    timings: ctx.timings,
    meta: { ...ctx.meta, intentText: ctx.resolvedMessage || ctx.normalizedMessage },
    previousSessionState: ctx.options.sessionState,
  });
  ctx.timings.reactMs = elapsedMs(reactStartedAt);

  if (confirmedStepResult.confirmation?.required) {
    return confirmedStepResult;
  }

  const pending = ctx.options.pendingTaskPlan;
  const nextIndex = Math.min(pending.nextStepIndex + 1, pending.steps.length);

  const prevStructured = deserializeStepContext(pending.contextSnippets);
  const confirmedExecuted = confirmedStepResult.debugTrace?.executedCalls || [];
  if (confirmedExecuted.length > 0) {
    const confirmedStep = pending.steps[pending.nextStepIndex];
    prevStructured.push({
      stepId: confirmedStep?.id || `s${pending.nextStepIndex + 1}`,
      stepIntent: confirmedStep?.intent || 'confirmed step',
      toolResults: confirmedExecuted.map((call) => ({
        name: call.name,
        ok: call.ok,
        result: call.result,
      })),
    });
  }
  const nextSnippets = serializeStepContext(prevStructured);

  const remaining = pending.steps.slice(nextIndex);
  if (remaining.length === 0) {
    return confirmedStepResult;
  }

  const continued = await executeTaskPlan({
    rootMessage: pending.rootMessage,
    steps: remaining,
    history: confirmedStepResult.updatedHistory,
    options: { ...ctx.options, confirmedToolCalls: undefined, pendingTaskPlan: undefined },
    plannerHistory: ctx.plannerHistory,
    reactConfig: ctx.reactConfig,
    includeDebugTrace: ctx.includeDebugTrace,
    includeHeavyDebug: ctx.includeHeavyDebug,
    timings: ctx.timings,
    contextSnippets: nextSnippets,
    startingSessionState: confirmedStepResult.sessionState ?? ctx.options.sessionState,
    historyMode: 'replace_last_assistant',
  });

  return {
    ...continued,
    modelUsed: continued.modelUsed,
    toolsUsed: [...new Set([...(confirmedStepResult.toolsUsed || []), ...(continued.toolsUsed || [])])],
    fallbackUsed: confirmedStepResult.fallbackUsed || continued.fallbackUsed,
    sessionState: continued.sessionState ?? confirmedStepResult.sessionState,
  };
}

async function stepTaskDecomposition(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  if (
    ctx.phase !== 'planning' ||
    ctx.options._skipTaskDecomposition ||
    ctx.options.confirmedToolCalls?.length ||
    ctx.options.pendingTaskPlan
  ) {
    return null;
  }

  try {
    const steps = await decomposeTask(ctx.resolvedMessage || ctx.normalizedMessage, ctx.plannerHistory, ctx.options.sessionState, ctx.intentKind, emitPlannerEvent);
    if (steps.length > 1) {
      emitPlannerEvent(`Task decomposed into ${steps.length} steps.`);
      const executed = await executeTaskPlan({
        rootMessage: ctx.normalizedMessage,
        steps,
        history: ctx.history,
        options: { ...ctx.options, _skipTaskDecomposition: true },
        plannerHistory: ctx.plannerHistory,
        reactConfig: ctx.reactConfig,
        includeDebugTrace: ctx.includeDebugTrace,
        includeHeavyDebug: ctx.includeHeavyDebug,
        timings: ctx.timings,
        contextSnippets: [],
        startingSessionState: ctx.options.sessionState,
        historyMode: 'append_root',
      });
      return executed;
    }
  } catch {
    // Decomposition should never be a hard failure; fall through.
  }
  return null;
}

async function stepBrowserFollowUp(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  const browserActive = Boolean(ctx.options.sessionState?.browser?.active);
  const isAffirmativeFollowUp =
    isAffirmativeToken(ctx.resolvedMessage || ctx.normalizedMessage) &&
    lastAssistantAskedToConfirm(ctx.history);

  const browserFollowUp =
    (browserActive || hasOpenBrowserSessionSignal(ctx.history)) &&
    (isBrowserFollowUpIntent(ctx.resolvedMessage || ctx.normalizedMessage) || isAffirmativeFollowUp);

  if (isLikelyInternalUiIntent(ctx.resolvedMessage || ctx.normalizedMessage)) return null;
  if (!browserFollowUp || ctx.options.confirmedToolCalls?.length) return null;

  emitPlannerEvent('Browser follow-up detected. Enforcing tool-grounded ReAct path.');
  const reactStartedAt = nowMs();
  const result = await handleToolRoute({
    ctx,
    userMessage: `${ctx.plannerMessage || (ctx.resolvedMessage || ctx.normalizedMessage)}\n\nUse browser tools against the live page session. Do not invent results; only report observed data.`,
    history: ctx.history,
    options: ctx.options,
    plannerHistory: ctx.plannerHistory,
    reactConfig: ctx.reactConfig,
    includeDebugTrace: ctx.includeDebugTrace,
    includeHeavyDebug: ctx.includeHeavyDebug,
    timings: ctx.timings,
    meta: {
      ...ctx.meta,
      intentText: ctx.resolvedMessage || ctx.normalizedMessage,
    },
    previousSessionState: ctx.options.sessionState,
  });
  ctx.timings.reactMs = elapsedMs(reactStartedAt);
  return result;
}

async function stepModelFastPath(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  const browserFollowUp = Boolean((ctx.options.sessionState?.browser?.active || hasOpenBrowserSessionSignal(ctx.history)) &&
    isBrowserFollowUpIntent(ctx.resolvedMessage || ctx.normalizedMessage));

  const canUseModelFastPath =
    ENABLE_CHAT_MODEL_FAST_PATH &&
    ctx.phase === 'planning' &&
    !(ctx.options.confirmedToolCalls?.length) &&
    !browserFollowUp &&
    (ctx.options.forceModel === 'qwen3' || (!ctx.options.forceModel && getOllamaReadyFast()));

  if (!canUseModelFastPath) return null;

  ctx.modelFastPathAttempted = true;
  const complexity = assessComplexity(ctx.resolvedMessage || ctx.normalizedMessage);
  const useQuickMode = complexity.level === 'simple' || complexity.level === 'moderate';
  const requiresDecomposition = complexity.level === 'complex';
  emitPlannerEvent(
    `Fast-path complexity: ${complexity.level} (quick=${useQuickMode ? 'on' : 'off'}, decomposition_hint=${requiresDecomposition ? 'on' : 'off'}).`
  );
  try {
    const plannerStartedAt = nowMs();
    const fastPlan = await runToolPlan(
      ctx.plannerMessage || (ctx.resolvedMessage || ctx.normalizedMessage),
      ctx.plannerHistory,
      emitPlannerEvent,
      MODEL_FAST_PATH_ALLOWED_TOOLS,
      {
        quick: useQuickMode,
        requiresDecomposition,
        ...(ctx.options.plannerModelOverride
          ? { plannerRouteOverride: { provider: 'ollama', model: ctx.options.plannerModelOverride } }
          : (ctx.options.plannerRouteOverride ? { plannerRouteOverride: ctx.options.plannerRouteOverride } : {})),
      }
    );
    const plannedCalls = Array.isArray(fastPlan?.plannedCalls) ? fastPlan.plannedCalls : [];
    const plannedUiActions = Array.isArray(fastPlan?.plannedUiActions) ? fastPlan.plannedUiActions : [];
    ctx.timings.plannerMs = (ctx.timings.plannerMs || 0) + elapsedMs(plannerStartedAt);
    if (typeof fastPlan.clarificationQuestion === 'string' && fastPlan.clarificationQuestion.trim()) {
      const question = fastPlan.clarificationQuestion.trim();
      const clarifiedIntent = stripPlannerHeuristicContext(ctx.resolvedMessage || ctx.normalizedMessage);
      const companyMatch = clarifiedIntent.match(/\b(?:employees|people|contacts?|leads?|profiles?)\s+(?:of|at)\s+(.+?)(?:\s+on\s+salesnavigator|\s+on\s+sales\s+navigator|[?.!]|$)/i);
      const companyName = companyMatch?.[1]?.trim() || '';
      const clarificationTask = createTask(clarifiedIntent, 'ask_writes');
      clarificationTask.params = {
        clarification_kind: 'salesnav_employee_details',
        company_name: companyName,
      };
      clarificationTask.missingParams = [
        {
          name: 'contact_count',
          description: 'How many contacts to collect',
          type: 'number',
          required: true,
        },
        {
          name: 'detail_fields',
          description: 'Which details to collect (LinkedIn URL, title, email, phone)',
          type: 'string',
          required: true,
        },
      ];
      clarificationTask.steps = [
        {
          id: 's1',
          intent: clarifiedIntent,
          toolCall: { name: 'browser_list_sub_items', args: {} },
          status: 'pending',
          dependsOn: [],
        },
      ];
      const updatedSession = {
        ...(ctx.options.sessionState || { entities: [] }),
        activeTask: clarificationTask,
      };
      return {
        response: question,
        updatedHistory: [
          ...ctx.history,
          { role: 'user', content: ctx.resolvedMessage || ctx.normalizedMessage },
          { role: 'assistant', content: question },
        ],
        messages: [textMsg(question)],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        clarificationQuestion: question,
        sessionState: updatedSession,
      };
    }
    if (fastPlan.success && (plannedCalls.length > 0 || plannedUiActions.length > 0)) {
      ctx.modelFastPathSucceeded = true;
      emitPlannerEvent(`Model fast path planned ${plannedUiActions.length} ui action(s) and ${plannedCalls.length} tool call(s).`);
      return await executeFastPathPlan({
        ctx,
        fastPlan: { reason: 'model_fast_path', calls: plannedCalls, uiActions: plannedUiActions },
        routeReason: 'model_fast_path',
        selectedTools: fastPlan.selectedTools,
        userMessageForHistory: ctx.resolvedMessage || ctx.normalizedMessage,
        normalizedMessageForSynthesis: ctx.resolvedMessage || ctx.normalizedMessage,
        previousSessionState: ctx.options.sessionState,
      });
    }
    emitPlannerEvent(
      `Model fast path returned no executable plan${fastPlan.failureReason ? ` (${fastPlan.failureReason})` : ''}.`
    );
    ctx.modelFastPathFailed = true;
  } catch {
    emitPlannerEvent('Model fast path planner failed. Falling back to full routing.');
    ctx.modelFastPathFailed = true;
  }
  return null;
}

async function stepParamCollectionGate(ctx: PipelineContext): Promise<StepResult> {
  if (
    ctx.intentKind !== 'single' ||
    ctx.phase !== 'planning' ||
    ctx.options._skipTaskDecomposition ||
    ctx.options.confirmedToolCalls?.length ||
    ctx.options.sessionState?.activeTask ||
    !ctx.modelFastPathAttempted ||
    ctx.modelFastPathSucceeded
  ) {
    return null;
  }

  try {
    const requirements = await analyzeTaskRequirements(ctx.resolvedMessage || ctx.normalizedMessage, {
      ...(ctx.options.sessionState?.activeEntity
        ? {
            activeEntity: {
              type: ctx.options.sessionState.activeEntity.entityType,
              id: ctx.options.sessionState.activeEntity.entityId,
              label: ctx.options.sessionState.activeEntity.label,
            },
          }
        : {}),
    });

    if (!requirements.canExecuteImmediately && requirements.missingParams.length > 0) {
      const task = createTask(ctx.resolvedMessage || ctx.normalizedMessage);
      task.missingParams = requirements.missingParams.map((p) => ({
        name: p.name,
        description: p.description,
        type: p.type as ParamRequest['type'],
        required: p.required,
      }));
      if (requirements.suggestedTool) {
        task.steps = [
          {
            id: 's1',
            intent: ctx.resolvedMessage || ctx.normalizedMessage,
            toolCall: { name: requirements.suggestedTool, args: {} },
            status: 'pending',
            dependsOn: [],
          },
        ];
      }

      const askText = await generateParamRequest(task);
      const updatedSession = {
        ...(ctx.options.sessionState || { entities: [] }),
        activeTask: task,
      };

      return {
        response: askText,
        updatedHistory: [
          ...ctx.history,
          { role: 'user', content: ctx.userMessage },
          { role: 'assistant', content: askText },
        ],
        messages: [textMsg(askText)],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState: updatedSession,
      };
    }
  } catch {
    // Non-fatal: fall through.
  }
  return null;
}

async function stepGenericRetrievalBootstrap(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  if (ctx.intentKind === 'conversational') return null;
  const complexity = assessComplexity(ctx.resolvedMessage || ctx.normalizedMessage);
  const explicitBrowserIntent = isExplicitBrowserAutomationIntent(ctx.resolvedMessage || ctx.normalizedMessage);
  const useGenericRetrievalBootstrap =
    ENABLE_GENERIC_RETRIEVAL_BOOTSTRAP &&
    ctx.phase === 'planning' &&
    !(ctx.options.confirmedToolCalls?.length) &&
    ctx.modelFastPathAttempted &&
    !ctx.modelFastPathSucceeded &&
    Boolean(ctx.modelFastPathFailed) &&
    !explicitBrowserIntent &&
    complexity.level !== 'complex';

  if (!useGenericRetrievalBootstrap) return null;

  emitPlannerEvent('Falling back to generic retrieval bootstrap (hybrid_search).');
  return await executeFastPathPlan({
    ctx,
    fastPlan: {
      reason: 'model_fast_path',
      calls: [{ name: 'hybrid_search', args: { query: ctx.resolvedMessage || ctx.normalizedMessage, k: 10 } }],
    },
    routeReason: 'model_fast_path',
    selectedTools: ['hybrid_search'],
    userMessageForHistory: ctx.resolvedMessage || ctx.normalizedMessage,
    normalizedMessageForSynthesis: ctx.resolvedMessage || ctx.normalizedMessage,
    previousSessionState: ctx.options.sessionState,
  });
}

async function stepRouteAndRunPlannerOrFallback(ctx: PipelineContext, emitPlannerEvent: (msg: string) => void): Promise<StepResult> {
  let route: ModelRoute;
  let routeReason: string;

  const routeStartedAt = nowMs();
  if (ctx.options.forceModel) {
    route = ctx.options.forceModel;
    routeReason = 'forced';
  } else if (!getOllamaReadyFast()) {
    route = ENABLE_OPENAI_FALLBACK ? 'openai' : 'gemma';
    routeReason = ENABLE_OPENAI_FALLBACK ? 'ollama_unavailable_openai' : 'ollama_unavailable_local';
  } else {
    const decision = routeMessage(ctx.resolvedMessage || ctx.normalizedMessage);
    route = decision.model;
    routeReason = decision.reason;
  }
  ctx.timings.routeMs = elapsedMs(routeStartedAt);
  emitPlannerEvent(`Route selected: ${routeReason} (${route}).`);

  if (ctx.options.confirmedToolCalls?.length) {
    const reactStartedAt = nowMs();
    const result = await handleToolRoute({
      ctx,
      userMessage: ctx.plannerMessage || (ctx.resolvedMessage || ctx.normalizedMessage),
      history: ctx.history,
      options: ctx.options,
      plannerHistory: ctx.plannerHistory,
      reactConfig: ctx.reactConfig,
      includeDebugTrace: ctx.includeDebugTrace,
      includeHeavyDebug: ctx.includeHeavyDebug,
      timings: ctx.timings,
      meta: {
        ...ctx.meta,
        intentText: ctx.resolvedMessage || ctx.normalizedMessage,
      },
      previousSessionState: ctx.options.sessionState,
    });
    ctx.timings.reactMs = elapsedMs(reactStartedAt);
    return result;
  }

  const skipDuplicatePlannerPass =
    AVOID_DUPLICATE_PLANNER_PASSES &&
    ctx.modelFastPathAttempted &&
    !ctx.modelFastPathSucceeded &&
    route === 'qwen3' &&
    ctx.phase === 'planning';
  if (skipDuplicatePlannerPass) {
    emitPlannerEvent('Skipping duplicate ReAct planner pass after model fast-path attempt.');
  }

  if ((route === 'qwen3' || ctx.phase === 'refining') && !skipDuplicatePlannerPass) {
    emitPlannerEvent('Analyzing request and running ReAct loop...');
    try {
      const reactStartedAt = nowMs();
      const result = await handleToolRoute({
        ctx,
        userMessage: ctx.plannerMessage || (ctx.resolvedMessage || ctx.normalizedMessage),
        history: ctx.history,
        options: ctx.options,
        plannerHistory: ctx.plannerHistory,
        reactConfig: ctx.reactConfig,
        includeDebugTrace: ctx.includeDebugTrace,
        includeHeavyDebug: ctx.includeHeavyDebug,
        timings: ctx.timings,
        meta: {
          ...ctx.meta,
          intentText: ctx.resolvedMessage || ctx.normalizedMessage,
        },
        previousSessionState: ctx.options.sessionState,
      });
      ctx.timings.reactMs = elapsedMs(reactStartedAt);
      return result;
    } catch (err) {
      const failureReason = err instanceof Error ? err.message : 'react_loop_error';
      recordToolFailure({
        planner_model: TOOL_BRAIN_MODEL,
        user_message: ctx.resolvedMessage || ctx.normalizedMessage,
        conversation_tail: ctx.localHistory.slice(-4).map((m) => ({ role: m.role, content: m.content })),
        route_reason: routeReason,
        selected_tools: [],
        executed_tools: [],
        raw_content: '',
        native_tool_calls: [],
        token_tool_calls: [],
        failure_reason: failureReason,
        outcome: 'failed',
        recovered_by_gemma: false,
      });
      ctx.options.onModelSwitch?.('qwen3', 'gemma', 'react_loop_error');
      route = 'gemma';
      routeReason = 'react_loop_error_fallback';
    }
  }

  const fallbackStartedAt = nowMs();
  const fallbackResult = await runWithFallback(
    route,
    ctx.plannerMessage || (ctx.resolvedMessage || ctx.normalizedMessage),
    ctx.localHistory,
    ctx.history,
    ctx.options.chatModelOverride,
    ctx.options.chatModelProviderOverride,
    ctx.options.onToolCall,
    ctx.options.onAssistantToken,
    ctx.options.onModelSwitch
  );
  ctx.timings.fallbackMs = elapsedMs(fallbackStartedAt);

  const updatedHistory: ChatCompletionMessageParam[] = [
    ...ctx.history,
    { role: 'user', content: ctx.normalizedMessage },
    { role: 'assistant', content: fallbackResult.response },
  ];

  return {
    response: fallbackResult.response,
    updatedHistory,
    messages: fallbackResult.messages,
    modelUsed: fallbackResult.modelUsed,
    toolsUsed: fallbackResult.toolsUsed,
    fallbackUsed: fallbackResult.fallbackUsed,
    sessionState: ctx.options.sessionState,
    ...(ctx.includeDebugTrace ? { debugTrace: {
      route,
      routeReason,
      modelUsed: fallbackResult.modelUsed,
      toolBrainName: TOOL_BRAIN_NAME,
      toolBrainModel: TOOL_BRAIN_MODEL,
      success: fallbackResult.success,
      selectedTools: [],
      nativeToolCalls: 0,
      tokenToolCalls: 0,
      toolsUsed: fallbackResult.toolsUsed,
      fallbackUsed: fallbackResult.fallbackUsed,
      modelSwitches: fallbackResult.switches,
      phase: ctx.phase,
      rawUserMessage: ctx.userMessage,
      intentText: ctx.normalizedMessage,
      pageContext: ctx.pageContext || undefined,
      sizes: ctx.sizeMetrics,
    } } : {}),
  };
}

export async function processMessagePipeline(
  userMessage: string,
  options: ChatEngineOptions = {}
): Promise<ChatEngineResult> {
  const { ctx, startedAt, emitPlannerEvent } = buildPipelineContext(userMessage, options);

  // Early intent classification:
  // - conversational: answer directly (no tool planning)
  // - single/multi: continue with normal tool/routing pipeline
  ctx.intentKind = ctx.phase === 'planning' && !(ctx.options.confirmedToolCalls?.length) && !ENABLE_CHAT_BENCHMARK_MODE
    ? await classifyIntent(ctx.normalizedMessage, emitPlannerEvent)
    : 'single';

  const steps: Array<() => Promise<StepResult>> = [
    () => stepBenchmarkSinglePass(ctx, emitPlannerEvent),                   // benchmark bypass
    () => stepSessionCoreferenceAndDisambiguation(ctx),                      // B
    () => stepTrySkillFirst(ctx),                                            // C
    () => stepActiveTaskAndSkillResume(ctx),                                 // D
    () => stepResumePendingConfirmation(ctx, emitPlannerEvent),              // E
    () => stepConversationalShortCircuit(ctx, emitPlannerEvent),             // F
    () => stepPendingTaskPlanResume(ctx, emitPlannerEvent),                  // G
    () => stepTaskDecomposition(ctx, emitPlannerEvent),                      // H
    () => stepBrowserFollowUp(ctx, emitPlannerEvent),                        // I
    () => stepModelFastPath(ctx, emitPlannerEvent),                          // J
    () => stepParamCollectionGate(ctx),                                      // K
    () => stepGenericRetrievalBootstrap(ctx, emitPlannerEvent),              // L
    () => stepRouteAndRunPlannerOrFallback(ctx, emitPlannerEvent),           // M
  ];

  for (const runStep of steps) {
    const result = await runStep();
    if (result) return finalizeResult(ctx, startedAt, result);
  }

  // Should never happen: route step should always return.
  return finalizeResult(ctx, startedAt, {
    response: 'Something went wrong.',
    updatedHistory: ctx.history,
    messages: [textMsg('Something went wrong.')],
    modelUsed: 'qwen3',
    toolsUsed: [],
    fallbackUsed: false,
    sessionState: ctx.options.sessionState,
  });
}
