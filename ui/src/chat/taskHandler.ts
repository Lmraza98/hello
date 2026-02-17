// ── Task Handler ────────────────────────────────────────────
// Bridge between the task state machine and the chat engine.
// Handles active-task routing: param collection, confirmation,
// cancellation, and execution hand-off.

import type { ChatEngineResult, ChatEngineOptions, StepContextEntry } from './chatEngine';
import { summarizeToolResult } from './chatEngine';
import type { ChatCompletionMessageParam } from './chatEngineTypes';
import type { Task, DataSource } from './taskState';
import { collectParam, transitionTask } from './taskState';
import { classifyTaskRelevance, extractTaskParams } from './taskClassifiers';
import { textMsg } from '../services/messageHelpers';
import { ollamaChat } from './models/ollamaClient';

const RESPONSE_MODEL =
  import.meta.env.VITE_PLANNER_BACKEND ||
  import.meta.env.VITE_TOOL_BRAIN ||
  'gemma3:12b';

/**
 * Sentinel value returned in `result.response` when the task handler
 * has approved execution but needs the caller (processMessage) to
 * actually run the tool pipeline.
 */
export const EXECUTE_TASK_SENTINEL = '__EXECUTE_TASK__';

/**
 * Handle a user message when there is an active task.
 *
 * Returns null if the message is a new topic (caller should fall through
 * to normal intent classification), or a ChatEngineResult if handled.
 */
export async function handleActiveTask(
  userMessage: string,
  task: Task,
  history: ChatCompletionMessageParam[],
  options: ChatEngineOptions
): Promise<{ result: ChatEngineResult; updatedTask: Task } | null> {
  const relevance = await classifyTaskRelevance(userMessage, task);

  if (relevance === 'new_topic') {
    // Caller should park this task and start fresh routing
    return null;
  }

  if (relevance === 'cancellation') {
    const cancelled = transitionTask(task, 'cancelled', 'user_cancelled');
    const text = `Cancelled: "${task.goal}". What would you like to do instead?`;
    return {
      result: {
        response: text,
        updatedHistory: [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: text }],
        messages: [textMsg(text)],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState: options.sessionState,
      },
      updatedTask: cancelled,
    };
  }

  // ── Continuation ──────────────────────────────────────────

  if (task.status === 'collecting') {
    return await handleParamCollection(userMessage, task, history, options);
  }

  if (task.status === 'ready' || task.status === 'paused') {
    return await handleConfirmation(userMessage, task, history, options);
  }

  // For other statuses (executing, etc.), treat as acknowledgment — let caller handle
  return null;
}

async function handleParamCollection(
  userMessage: string,
  task: Task,
  history: ChatCompletionMessageParam[],
  options: ChatEngineOptions
): Promise<{ result: ChatEngineResult; updatedTask: Task }> {
  // Extract params from the user message
  const extracted = await extractTaskParams(userMessage, task);
  let updated = { ...task };

  const now = Date.now();
  for (const [name, value] of Object.entries(extracted)) {
    const source: DataSource = {
      origin: 'user_input',
      confidence: 0.9,
      timestamp: now,
    };
    updated = collectParam(updated, name, value, source);
  }

  // Check if we're done collecting
  const stillRequired = updated.missingParams.filter((p) => p.required);

  if (stillRequired.length === 0) {
    // All params collected — transition to ready
    if (updated.status !== 'ready') {
      updated = transitionTask(updated, 'ready', 'all_required_params_collected');
    }
    const summary = formatReadySummary(updated);
    return {
      result: {
        response: summary,
        updatedHistory: [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: summary }],
        messages: [textMsg(summary)],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState: options.sessionState,
      },
      updatedTask: updated,
    };
  }

  // Still missing params — ask for them
  const askText = await generateParamRequest(updated);
  return {
    result: {
      response: askText,
      updatedHistory: [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: askText }],
      messages: [textMsg(askText)],
      modelUsed: 'qwen3',
      toolsUsed: [],
      fallbackUsed: false,
      sessionState: options.sessionState,
    },
    updatedTask: updated,
  };
}

async function handleConfirmation(
  userMessage: string,
  task: Task,
  history: ChatCompletionMessageParam[],
  options: ChatEngineOptions
): Promise<{ result: ChatEngineResult; updatedTask: Task }> {
  // At this point the user message is a continuation of a ready/paused task.
  // Likely "yes", "go ahead", "do it", or similar.
  // Return the EXECUTE_TASK_SENTINEL so the caller can route to the
  // existing execution pipeline with the task's collected params injected.
  //
  // For paused multi-step tasks, we also stash a rich synthetic message
  // in task.params._syntheticMessage so the caller (processMessage) can
  // feed it to the planner with full context from completed steps.

  const updated = transitionTask(task, 'executing', 'user_confirmed');

  // Build rich synthetic message for paused multi-step tasks.
  const completedSteps = task.params.completedSteps as StepContextEntry[] | undefined;
  const remainingIntents = task.params.remainingStepIntents as string[] | undefined;

  if (completedSteps && Array.isArray(completedSteps) && completedSteps.length > 0) {
    // Determine what to execute next: the user's follow-up message
    // combined with structured context from completed steps.
    const nextIntent =
      (remainingIntents && remainingIntents.length > 0 ? remainingIntents[0] : null) ||
      userMessage;

    const contextLines: string[] = [];
    for (const entry of completedSteps) {
      for (const tr of entry.toolResults) {
        const summary = summarizeToolResult(tr.name, tr.ok, tr.result);
        contextLines.push(`- ${entry.stepId} (${tr.name}): ${summary}`);
      }
    }

    const syntheticMessage =
      `${nextIntent}\n\n` +
      `IMPORTANT — Results from previous steps (use these values for your tool call arguments):\n` +
      contextLines.join('\n');

    updated.params = {
      ...updated.params,
      _syntheticMessage: syntheticMessage,
    };
  }

  return {
    result: {
      // Sentinel — the caller (processMessage) replaces this with actual execution
      response: EXECUTE_TASK_SENTINEL,
      updatedHistory: history,
      messages: [],
      modelUsed: 'qwen3',
      toolsUsed: [],
      fallbackUsed: false,
      sessionState: options.sessionState,
    },
    updatedTask: updated,
  };
}

function formatReadySummary(task: Task): string {
  const params = Object.entries(task.params)
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join('\n');
  return (
    `Ready to execute: ${task.goal}\n\n` +
    `Parameters:\n${params}\n\n` +
    `Shall I proceed?`
  );
}

async function generateParamRequest(task: Task): Promise<string> {
  const missing = task.missingParams.filter((p) => p.required);
  const collected = Object.entries(task.params);

  try {
    const response = await ollamaChat({
      model: RESPONSE_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are collecting information for a task. Generate a short, natural message asking the user for the missing parameters.\n' +
            'Rules:\n' +
            '- Acknowledge any params that were just provided.\n' +
            '- Ask for the remaining required params.\n' +
            '- Be concise — 2-3 sentences max.\n' +
            '- Do not use bullet points or numbered lists unless there are 4+ missing items.',
        },
        {
          role: 'user',
          content:
            `Task: ${task.goal}\n` +
            `Collected so far: ${collected.length > 0 ? collected.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ') : 'nothing yet'}\n` +
            `Still needed: ${missing.map((p) => `${p.description || p.name} (${p.type})`).join(', ')}`,
        },
      ],
      temperature: 0.5,
      numPredict: 200,
    });
    return (
      (response.message.content || '').trim() ||
      `I still need: ${missing.map((p) => p.description || p.name).join(', ')}`
    );
  } catch {
    return `I still need: ${missing.map((p) => p.description || p.name).join(', ')}`;
  }
}

// Re-export for use by chatEngine when creating tasks from analyzeTaskRequirements
export { generateParamRequest };
