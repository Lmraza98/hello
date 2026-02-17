import type { LocalChatMessage } from './ollamaClient';
import { runToolPlan, type ToolPlanResult } from './toolPlanner';

// Backward-compatible export for existing imports.
export type Qwen3PlanResult = ToolPlanResult;

export async function runQwen3Plan(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  onProgress?: (message: string) => void
): Promise<Qwen3PlanResult> {
  return runToolPlan(userMessage, conversationHistory, onProgress);
}

