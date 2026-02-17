import { createPlannerAskFn } from '../plannerBackends';
import type { LocalChatMessage } from '../ollamaClient';
import type { TaskStep } from '../../chatEngineTypes';
import { extractCandidateJson, normalizeParsedSteps } from './parse';
import { withTimeout } from './timeout';
import { TASK_DECOMPOSITION_TIMEOUT_MS } from './config';
import { ACTIVE_MODEL_CONFIG, MODEL_ID_HINTS, MODEL_PROVIDER_HINTS } from '../../../config/plannerConfig';

export interface TaskDecompositionResult {
  success: boolean;
  steps: TaskStep[];
  rawContent: string | null;
  failureReason?: string;
}

export async function runTaskDecomposition(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  onProgress?: (message: string) => void
): Promise<TaskDecompositionResult> {
  const emit = (message: string) => onProgress?.(message);
  const decompositionModel = ACTIVE_MODEL_CONFIG.decomposition;
  const askPlanner = createPlannerAskFn({
    provider: MODEL_PROVIDER_HINTS[decompositionModel],
    model: MODEL_ID_HINTS[decompositionModel],
  });
  emit(
    `Task decomposition planner route: provider=${MODEL_PROVIDER_HINTS[decompositionModel]} model=${MODEL_ID_HINTS[decompositionModel]}.`
  );

  const system =
    `You are a task decomposer.\n` +
    `Given a user request, output a minimal set of steps to complete it.\n` +
    `Output ONLY JSON array of steps with shape:\n` +
    `[{\"id\":\"s1\",\"intent\":\"...\",\"dependsOn\":[]}]\n` +
    `Rules:\n` +
    `- If the request is single-step, output [] (empty array).\n` +
    `- Each intent must be ACTIONABLE and map to a specific tool call. Never use vague intents like \"Identify contacts\" - instead specify exactly what to search/filter.\n` +
    `- Each intent must be self-contained, executable as a standalone user message.\n` +
    `- Preserve exact spelling for proper nouns and company/person names.\n` +
    `- Steps that don't depend on each other should have empty dependsOn (they can run in parallel).\n` +
    `- Prefer 2-6 steps. Avoid over-decomposing.\n` +
    `- Do not output tool calls.\n` +
    `Examples:\n` +
    `User: \"Find Zco on Sales Navigator and list employees\"\n` +
    `Output: [{\"id\":\"s1\",\"intent\":\"Search Zco on Sales Navigator\",\"dependsOn\":[]},{\"id\":\"s2\",\"intent\":\"List employees for Zco on Sales Navigator\",\"dependsOn\":[\"s1\"]}]\n` +
    `User: \"Create a campaign for veterinary services then add contacts from the database\"\n` +
    `Output: [{\"id\":\"s1\",\"intent\":\"Create email campaign named 'Veterinary Services Campaign' targeting veterinary services\",\"dependsOn\":[]},{\"id\":\"s2\",\"intent\":\"Enroll all contacts matching 'veterinary' into the campaign created in s1\",\"dependsOn\":[\"s1\"]}]\n` +
    `User: \"Create a campaign targeting banks and add bank contacts\"\n` +
    `Output: [{\"id\":\"s1\",\"intent\":\"Create email campaign named 'Banking Campaign' targeting banks\",\"dependsOn\":[]},{\"id\":\"s2\",\"intent\":\"Enroll all contacts matching 'bank' into the campaign created in s1\",\"dependsOn\":[\"s1\"]}]\n` +
    `User: \"Find Kevin and send him an email about our new product\"\n` +
    `Output: [{\"id\":\"s1\",\"intent\":\"Search for contact named Kevin\",\"dependsOn\":[]},{\"id\":\"s2\",\"intent\":\"Send email to Kevin about our new product\",\"dependsOn\":[\"s1\"]}]\n`;

  const messages: LocalChatMessage[] = [
    { role: 'system', content: system },
    ...conversationHistory.slice(-6),
    { role: 'user', content: userMessage },
  ];

  let rawContent: string | null = null;
  try {
    const controller = new AbortController();
    const resp = await withTimeout(
      askPlanner(messages, { signal: controller.signal }),
      TASK_DECOMPOSITION_TIMEOUT_MS,
      'task_decomposition',
      () => controller.abort()
    );
    rawContent = resp.content || null;
    const candidate = extractCandidateJson(rawContent);
    if (!candidate) {
      return { success: false, steps: [], rawContent, failureReason: 'invalid_or_empty_json' };
    }
    const parsed = JSON.parse(candidate);
    const steps = normalizeParsedSteps(parsed);
    return { success: true, steps, rawContent };
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : 'task_decomposition_error';
    emit(`Task decomposition failed: ${failureReason}`);
    return { success: false, steps: [], rawContent, failureReason };
  }
}
