// â”€â”€ Task Classifiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LLM-based classifiers for task relevance, param extraction,
// and task requirements analysis.  All functions have try/catch
// with safe fallbacks â€” they never throw.

import { ollamaChat } from './models/ollamaClient';
import type { Task } from './taskState';
import { taskSummary } from './taskState';

// Use the same classifier model as the intent classifier in chatEngine.ts.
// Default to gemma3:12b â€” functiongemma is too small and frequently returns
// invalid output for classification tasks.
const CLASSIFIER_MODEL =
  process.env.NEXT_PUBLIC_DECOMPOSE_CLASSIFIER_MODEL ||
  process.env.NEXT_PUBLIC_OLLAMA_GEMMA_MODEL ||
  'gemma3:12b';

// Use the planner model for param extraction â€” needs to output structured JSON.
const PLANNER_MODEL =
  process.env.NEXT_PUBLIC_PLANNER_BACKEND ||
  process.env.NEXT_PUBLIC_TOOL_BRAIN ||
  'gemma3:12b';

export type TaskRelevance = 'continuation' | 'cancellation' | 'new_topic';

/**
 * Given an active task and a new user message, classify whether the message
 * is continuing the task, cancelling it, or starting something new.
 *
 * Uses the cheap classifier model (~200ms).
 * Falls back to 'continuation' on error (safe default when task is active).
 */
export async function classifyTaskRelevance(
  message: string,
  task: Task
): Promise<TaskRelevance> {
  try {
    const response = await ollamaChat({
      model: CLASSIFIER_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'There is an active task in progress.\n' +
            taskSummary(task) + '\n' +
            'Classify the user message as one of:\n' +
            '- continuation: provides info for the task, confirms, answers a question, or says yes/ok/go ahead\n' +
            '- cancellation: user wants to stop, cancel, nevermind, forget it\n' +
            '- new_topic: user is asking about something completely unrelated\n' +
            'Reply with ONLY one word: continuation, cancellation, or new_topic.',
        },
        { role: 'user', content: message },
      ],
      temperature: 0,
      numPredict: 4,
    });
    const answer = (response.message.content || '').trim().toLowerCase();
    if (answer.includes('cancel')) return 'cancellation';
    if (answer.includes('new')) return 'new_topic';
    return 'continuation';
  } catch {
    // Safe default: if task is active and classifier fails, assume continuation.
    return 'continuation';
  }
}

/**
 * Extract parameter values from a user message given the current task state.
 * Returns a partial record of { paramName: extractedValue }.
 *
 * Uses the planner model (~1-2s) since it needs to understand schemas and
 * output valid JSON.
 *
 * Returns {} on error or if nothing could be extracted.
 */
export async function extractTaskParams(
  message: string,
  task: Task
): Promise<Record<string, unknown>> {
  if (task.missingParams.length === 0) return {};

  try {
    const response = await ollamaChat({
      model: PLANNER_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Extract parameter values from the user message for a task.\n' +
            `Task: ${task.goal}\n` +
            `Already collected: ${JSON.stringify(task.params)}\n` +
            `Still needed:\n${task.missingParams
              .map((p) => `- ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`)
              .join('\n')}\n\n` +
            'Rules:\n' +
            '- Return ONLY a JSON object with extracted values, e.g. {"description": "WOW", "num_emails": 1}\n' +
            '- Only include params you can confidently extract from the message.\n' +
            '- Use the exact param names listed above as keys.\n' +
            '- If the message is just "yes" or a confirmation, return {}.\n' +
            '- If nothing matches, return {}.\n' +
            '- No markdown, no explanation, ONLY the JSON object.',
        },
        { role: 'user', content: message },
      ],
      temperature: 0,
      numPredict: 256,
    });
    const raw = (response.message.content || '').trim();
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\s*|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      // Validate that keys are actually in missingParams
      const validKeys = new Set(task.missingParams.map((p) => p.name));
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (validKeys.has(key) && value !== null && value !== undefined) {
          result[key] = value;
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Ask the LLM whether a user goal requires parameter collection before
 * execution, and if so, what params are needed.
 *
 * This is called when creating a new task to determine if we can execute
 * immediately or need to collect more info first.
 *
 * Uses the planner model.
 */
export async function analyzeTaskRequirements(
  goal: string,
  availableContext: Record<string, unknown>
): Promise<{
  canExecuteImmediately: boolean;
  missingParams: Array<{ name: string; description: string; type: string; required: boolean }>;
  suggestedTool?: string;
}> {
  try {
    const response = await ollamaChat({
      model: PLANNER_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Analyze what a user wants to do and determine if we have enough info to execute.\n' +
            'Available context (already known):\n' +
            JSON.stringify(availableContext) + '\n\n' +
            'Available tools that require params:\n' +
            '- create_campaign: needs name (string, required), description (string, optional), num_emails (number, optional, default 3), days_between_emails (number, optional, default 3)\n' +
            '- enroll_contacts_in_campaign: needs campaign_id (number, required), contact_ids (array, required)\n' +
            '- enroll_contacts_by_filter: needs campaign_id (number, required), plus at least one filter: query (string, free-text search), vertical (string), company (string), has_email (boolean)\n' +
            '- send_email_now: needs email_id (number, required)\n' +
            '- browser_search_and_extract: needs task (string, required), query (string, required)\n\n' +
            'Return ONLY a JSON object:\n' +
            '{\n' +
            '  "canExecuteImmediately": boolean,\n' +
            '  "missingParams": [{"name": "...", "description": "...", "type": "string|number|boolean|entity_ref", "required": true}],\n' +
            '  "suggestedTool": "tool_name or null"\n' +
            '}\n' +
            'If the request is a simple lookup (find, search, list, show) â†’ canExecuteImmediately: true, missingParams: [].\n' +
            'If the request needs info the user has not provided â†’ canExecuteImmediately: false, list what is missing.',
        },
        { role: 'user', content: goal },
      ],
      temperature: 0,
      numPredict: 512,
    });
    const raw = (response.message.content || '').trim();
    const cleaned = raw.replace(/```json\s*|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    const obj = parsed as Record<string, unknown>;
    return {
      canExecuteImmediately: Boolean(obj.canExecuteImmediately),
      missingParams: Array.isArray(obj.missingParams)
        ? (obj.missingParams as Array<{ name: string; description: string; type: string; required: boolean }>)
        : [],
      suggestedTool: (typeof obj.suggestedTool === 'string' && obj.suggestedTool) || undefined,
    };
  } catch {
    // If analysis fails, assume we can try to execute immediately
    // (the planner will figure it out or ask for more info)
    return { canExecuteImmediately: true, missingParams: [] };
  }
}

