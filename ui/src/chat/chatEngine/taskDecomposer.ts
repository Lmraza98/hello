/**
 * Task decomposition (multi-step planning) utilities.
 *
 * This module preserves the legacy behavior from `chatEngine.ts`:
 * - uses classifyIntent() (unless provided)
 * - if LLM decomposition fails/returns <2 steps, falls back to a heuristic split
 */

import type { TaskStep } from '../chatEngineTypes';
import { compactPlannerHistoryByTurns } from '../runtimeGuards';
import { runTaskDecomposition } from '../models/toolPlanner';
import { withSessionContext, type ChatSessionState } from '../sessionState';
import { classifyIntent, type IntentKind } from './intentClassifier';

export function heuristicDecomposeSteps(message: string): TaskStep[] {
  const cleaned = (message || '').trim();
  if (!cleaned) return [];
  const normalized = cleaned.replace(/\s+/g, ' ').trim();
  const parts = normalized
    .split(/\b(?:and then|then|after that|next)\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [];
  const steps: TaskStep[] = parts.map((intent, idx) => ({
    id: `s${idx + 1}`,
    intent,
    dependsOn: idx === 0 ? [] : [`s${idx}`],
  }));
  return steps;
}

export async function decomposeTask(
  resolvedMessage: string,
  plannerHistory: ReturnType<typeof compactPlannerHistoryByTurns>,
  sessionState: ChatSessionState | undefined,
  intentKind: IntentKind | undefined,
  onProgress?: (message: string) => void
): Promise<TaskStep[]> {
  const intent = intentKind || (await classifyIntent(resolvedMessage, onProgress));
  if (intent === 'conversational') return [];
  const needsDecomposition = intent === 'multi';
  if (!needsDecomposition) return [];

  const prompt = withSessionContext(resolvedMessage, sessionState);
  const result = await runTaskDecomposition(prompt, plannerHistory, onProgress);
  const steps = result.success ? result.steps : [];
  if (steps.length >= 2) return steps;

  // If decomposition fails or returns empty/one step, fall back to a cheap heuristic split.
  const heuristic = heuristicDecomposeSteps(resolvedMessage);
  return heuristic.length >= 2 ? heuristic : [];
}

