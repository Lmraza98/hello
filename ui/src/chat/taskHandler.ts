// â”€â”€ Task Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Bridge between the task state machine and the chat engine.
// Handles active-task routing: param collection, confirmation,
// cancellation, and execution hand-off.

import type { ChatEngineResult, ChatEngineOptions, StepContextEntry } from './chatEngine';
import { summarizeToolResult } from './chatEngine';
import type { ChatCompletionMessageParam } from './chatEngineTypes';
import type { Task, DataSource } from './taskState';
import { collectParam, transitionTask } from './taskState';
import { classifyTaskRelevance, extractTaskParams } from './taskClassifiers';
import { stripPlannerHeuristicContext } from './models/toolPlanner/sessionBlocks';
import { textMsg } from '../services/messageHelpers';
import { ollamaChat } from './models/ollamaClient';

const RESPONSE_MODEL =
  process.env.NEXT_PUBLIC_PLANNER_BACKEND ||
  process.env.NEXT_PUBLIC_TOOL_BRAIN ||
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

  // â”€â”€ Continuation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (task.status === 'collecting') {
    return await handleParamCollection(userMessage, task, history, options);
  }

  if (task.status === 'ready' || task.status === 'paused') {
    return await handleConfirmation(userMessage, task, history, options);
  }

  // For other statuses (executing, etc.), treat as acknowledgment â€” let caller handle
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
  if (String(task.params.clarification_kind || '') === 'salesnav_employee_details') {
    if (extracted.contact_count == null) {
      const countMatch = userMessage.match(/\b(\d{1,3})\b/);
      if (countMatch) {
        extracted.contact_count = Number(countMatch[1]);
      }
    }
    if (extracted.detail_fields == null) {
      if (/\ball\b/i.test(userMessage) && /\bdetails?\b/i.test(userMessage)) {
        extracted.detail_fields = 'LinkedIn URL, title, email, phone';
      } else {
        const requested = [
          /\blinkedin\b/i.test(userMessage) ? 'LinkedIn URL' : '',
          /\btitle|titles\b/i.test(userMessage) ? 'title' : '',
          /\bemail|emails\b/i.test(userMessage) ? 'email' : '',
          /\bphone|phones|mobile|direct dial\b/i.test(userMessage) ? 'phone' : '',
        ].filter(Boolean);
        if (requested.length > 0) {
          extracted.detail_fields = requested.join(', ');
        }
      }
    }
  }
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
    // All params collected â€” transition to ready
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

  // Still missing params â€” ask for them
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
      `IMPORTANT â€” Results from previous steps (use these values for your tool call arguments):\n` +
      contextLines.join('\n');

    updated.params = {
      ...updated.params,
      _syntheticMessage: syntheticMessage,
    };
  }

  if (String(task.params.clarification_kind || '') === 'salesnav_employee_details') {
    const companyName = stripPlannerHeuristicContext(
      typeof task.params.company_name === 'string' ? task.params.company_name.trim() : ''
    );
    const contactCount = typeof task.params.contact_count === 'number'
      ? task.params.contact_count
      : (typeof task.params.contact_count === 'string' && task.params.contact_count.trim()
          ? Number(task.params.contact_count)
          : null);
    const detailFields = typeof task.params.detail_fields === 'string' ? task.params.detail_fields.trim() : '';
    const detailText = detailFields || 'LinkedIn URL, title, email, phone';
    const countText = Number.isFinite(contactCount as number) && (contactCount as number) > 0
      ? String(contactCount)
      : '10';
    const reconstructedMessage =
      `Find ${countText} employees of ${companyName || 'the company'} on SalesNavigator and collect ${detailText}.`;
    updated.params = {
      ...updated.params,
      _syntheticMessage: reconstructedMessage,
    };
  }

  return {
    result: {
      // Sentinel â€” the caller (processMessage) replaces this with actual execution
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
            '- Be concise â€” 2-3 sentences max.\n' +
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

