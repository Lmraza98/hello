/**
 * Multi-step task plan executor.
 *
 * Executes TaskStep[] sequentially, persisting structured tool-result context
 * and maintaining activeTask state for follow-ups.
 *
 * Step execution forces debug trace on to capture executedCalls.
 */

import { textMsg } from '../../services/messageHelpers';
import type { ChatCompletionMessageParam, PendingTaskPlan, TaskStep } from '../chatEngineTypes';
import type { ModelRoute } from '../router';
import type { ReActConfig } from '../reactLoop';
import type { compactPlannerHistoryByTurns } from '../runtimeGuards';
import { extractPageContext, extractUserIntentText } from '../messageParsing';
import { hasOpenBrowserSessionSignal, isBrowserFollowUpIntent } from '../chatEnginePolicy';
import { createTask, transitionTask } from '../taskState';
import { withSessionContext, type ChatSessionState } from '../sessionState';
import { buildStepMessage, deserializeStepContext, serializeStepContext, type StepContextEntry } from './stepContext';
import { handleToolRoute } from './reactAdapter';
import type { ChatEngineOptions, ChatEngineResult, ChatEngineTimings, MessageMeta, PipelineContext } from './pipelineTypes';

function isDeferredSchedulingStepIntent(intent: string): boolean {
  const lower = (intent || '').toLowerCase();
  if (!lower.trim()) return false;
  return /\b(schedule|scheduled|scheduling)\b/.test(lower) && /\b(day|days|tomorrow|next week|next month|send at|send on)\b/.test(lower);
}

function hasDeterministicEmailSchedulingTool(): boolean {
  // Current toolset supports immediate send and campaign execution, but not a
  // deterministic "set send date for drafted individual emails" operation.
  return false;
}

export async function executeTaskPlan(params: {
  rootMessage: string;
  steps: TaskStep[];
  history: ChatCompletionMessageParam[];
  options: ChatEngineOptions;
  plannerHistory: ReturnType<typeof compactPlannerHistoryByTurns>;
  reactConfig: ReActConfig;
  includeDebugTrace: boolean;
  includeHeavyDebug: boolean;
  timings: ChatEngineTimings;
  contextSnippets: string[];
  startingSessionState?: ChatSessionState;
  historyMode: 'append_root' | 'replace_last_assistant';
}): Promise<ChatEngineResult> {
  const {
    rootMessage,
    steps,
    history,
    options,
    plannerHistory,
    reactConfig,
    includeDebugTrace: _includeDebugTrace,
    includeHeavyDebug: _includeHeavyDebug,
    timings,
    contextSnippets,
    startingSessionState,
    historyMode,
  } = params;
  // Step execution always forces debug trace on to capture executedCalls for structured context passing between steps.
  void _includeDebugTrace;
  void _includeHeavyDebug;

  const outputs: string[] = [];
  const toolsUsed = new Set<string>();
  let fallbackUsed = false;
  let hadUnexecutableStep = false;
  let lastModelUsed: ModelRoute = options.forceModel || 'qwen3';
  let currentSessionState: ChatSessionState | undefined = startingSessionState ?? options.sessionState;
  let plannerStepHistory: ChatCompletionMessageParam[] = [...history];
  const progress = (msg: string) => options.onPlannerEvent?.(msg);
  progress(`Executing multi-step plan (${steps.length} steps).`);

  // Structured context: track tool results from each step so downstream steps can see structured data.
  const structuredCtx: StepContextEntry[] = deserializeStepContext(contextSnippets);

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    if (isDeferredSchedulingStepIntent(step.intent) && !hasDeterministicEmailSchedulingTool()) {
      const scheduleMsg =
        'I can draft and prepare emails, but I do not have a deterministic tool to set a future send date per email. ' +
        'I can continue by preparing drafts/review queue now, then you can confirm send timing manually.';
      outputs.push(scheduleMsg);
      hadUnexecutableStep = true;
      progress(`Step ${idx + 1}/${steps.length}: scheduling requires manual confirmation path.`);
      plannerStepHistory = [
        ...plannerStepHistory,
        { role: 'user', content: step.intent },
        { role: 'assistant', content: scheduleMsg },
      ];
      continue;
    }

    const stepMessage = buildStepMessage(step, structuredCtx);
    progress(`Step ${idx + 1}/${steps.length}: ${step.intent}`);

    const stepMeta: MessageMeta = {
      rawUserMessage: stepMessage,
      intentText: extractUserIntentText(stepMessage),
      pageContext: extractPageContext(stepMessage),
    };

    const browserActive = Boolean(currentSessionState?.browser?.active);
    const browserFollowUp =
      (browserActive || hasOpenBrowserSessionSignal(plannerStepHistory)) &&
      isBrowserFollowUpIntent(stepMessage);

    const stepInput = browserFollowUp
      ? `${stepMessage}\n\nUse browser tools against the live page session. Do not invent results; only report observed data.`
      : stepMessage;
    const stepInputWithSession = withSessionContext(stepInput, currentSessionState);

    const stepCtx: PipelineContext = {
      userMessage: stepMessage,
      history: plannerStepHistory,
      localHistory: [],
      phase: 'planning',
      options,
      sessionState: currentSessionState,
      intentText: stepMeta.intentText,
      pageContext: stepMeta.pageContext,
      normalizedMessage: stepMessage,
      includeDebugTrace: true,
      includeHeavyDebug: false,
      timings,
      plannerHistory,
      reactConfig,
      meta: stepMeta,
      getSelectedToolsForMessage: () => [],
      resolvedMessage: stepMessage,
      plannerMessage: stepInputWithSession,
      sessionContext: '',
    };

    // Force debug trace on so we capture executedCalls for structured context.
    const stepResult = await handleToolRoute({
      ctx: stepCtx,
      userMessage: stepInputWithSession,
      history: plannerStepHistory,
      options: {
        ...options,
        phase: 'planning',
        confirmedToolCalls: undefined,
        pendingPlanSummary: undefined,
        pendingTaskPlan: undefined,
        _skipTaskDecomposition: true,
        sessionState: currentSessionState,
        debug: true,
      },
      plannerHistory,
      reactConfig,
      includeDebugTrace: true,   // always on for step execution
      includeHeavyDebug: false,  // off to avoid overhead
      timings,
      meta: stepMeta,
      previousSessionState: currentSessionState,
    });

    if (stepResult.confirmation?.required) {
      const pendingTaskPlan: PendingTaskPlan = {
        rootMessage,
        steps,
        nextStepIndex: idx,
        contextSnippets: serializeStepContext(structuredCtx),
      };
      return {
        ...stepResult,
        confirmation: {
          ...stepResult.confirmation,
          pendingTaskPlan,
        },
      };
    }

    // Collect structured context from this step's executed tool calls.
    const executedCalls = stepResult.debugTrace?.executedCalls || [];
    if (executedCalls.length > 0) {
      structuredCtx.push({
        stepId: step.id,
        stepIntent: step.intent,
        toolResults: executedCalls.map((call) => ({
          name: call.name,
          ok: call.ok,
          result: call.result,
        })),
      });
    }

    outputs.push(stepResult.response);
    lastModelUsed = stepResult.modelUsed;
    for (const name of stepResult.toolsUsed || []) toolsUsed.add(name);
    fallbackUsed = fallbackUsed || stepResult.fallbackUsed;
    currentSessionState = stepResult.sessionState ?? currentSessionState;
    plannerStepHistory = stepResult.updatedHistory;
  }

  // â”€â”€ Persist execution state as activeTask â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // So follow-up messages route through the task handler instead of starting from scratch.
  const allStepsOk =
    outputs.length === steps.length &&
    structuredCtx.length > 0 &&
    structuredCtx.every((e) => e.toolResults.every((r) => r.ok));
  const persistedTask = createTask(rootMessage);
  persistedTask.status = allStepsOk && !hadUnexecutableStep ? 'completed' : 'paused';
  persistedTask.currentStepIndex = outputs.length;
  persistedTask.params = {
    completedSteps: structuredCtx,
    completedStepIntents: steps.slice(0, outputs.length).map((s) => s.intent),
    remainingStepIntents: steps.slice(outputs.length).map((s) => s.intent),
  };
  persistedTask.steps = steps.map((s, i) => ({
    id: s.id,
    intent: s.intent,
    status: (i < outputs.length ? 'completed' : 'pending') as 'completed' | 'pending',
    dependsOn: s.dependsOn,
  }));
  currentSessionState = {
    ...(currentSessionState || { entities: [] }),
    activeTask: persistedTask,
  };

  const combinedResponse = outputs.filter(Boolean).join('\n\n').trim() || 'Done.';
  const updatedHistory: ChatCompletionMessageParam[] =
    historyMode === 'append_root'
      ? [...history, { role: 'user', content: rootMessage }, { role: 'assistant', content: combinedResponse }]
      : (() => {
          // Inline replaceLastAssistantMessage to avoid importing dispatchResponse here.
          const next = [...history];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              next[i] = { role: 'assistant', content: combinedResponse };
              return next;
            }
          }
          return [...next, { role: 'assistant', content: combinedResponse }];
        })();

  // If we completed an executing task, mark it as completed (compat with finalize behavior).
  if (currentSessionState?.activeTask?.status === 'executing') {
    currentSessionState = {
      ...currentSessionState,
      activeTask: transitionTask(currentSessionState.activeTask, 'completed', 'execution_finished'),
    };
  }

  return {
    response: combinedResponse,
    updatedHistory,
    messages: [textMsg(combinedResponse)],
    modelUsed: lastModelUsed,
    toolsUsed: [...toolsUsed],
    fallbackUsed,
    sessionState: currentSessionState,
  };
}
