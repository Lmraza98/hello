/**
 * Chat engine orchestrator.
 *
 * Pipeline (early-return order):
 * A) buildPipelineContext
 * B) skill-first routing
 * C) conversational short-circuit
 * D) active task handling + skill resume
 * E) session coreference + disambiguation
 * F) pending task-plan resume
 * G) task decomposition
 * H) browser follow-up (tool-grounded ReAct)
 * I) model fast path
 * J) param collection gate
 * K) generic retrieval bootstrap
 * L) route and run planner or fallback
 */

import type { ChatCompletionMessageParam } from './chatEngineTypes';
import type { ChatSessionState } from './sessionState';
import type { ChatEngineOptions, ChatEngineResult } from './chatEngine/pipelineTypes';
import { processMessagePipeline } from './chatEngine/pipelineSteps';
import { processAction as processActionImpl } from './chatEngine/actionRouter';

export async function processMessage(
  userMessage: string,
  options: ChatEngineOptions = {}
): Promise<ChatEngineResult> {
  return processMessagePipeline(userMessage, options);
}

export async function processAction(
  actionValue: string,
  conversationHistory: ChatCompletionMessageParam[] = [],
  sessionState?: ChatSessionState
): Promise<ChatEngineResult> {
  return processActionImpl(actionValue, conversationHistory, sessionState);
}

// Legacy exports used by other modules (eg `taskHandler.ts`) remain intact.
export type { ChatEngineOptions, ChatEngineResult } from './chatEngine/pipelineTypes';
export type { StepContextEntry } from './chatEngine/stepContext';
export { summarizeToolResult } from './chatEngine/stepContext';

export type { ChatCompletionMessageParam } from './chatEngineTypes';
export type { ChatSessionState } from './sessionState';

