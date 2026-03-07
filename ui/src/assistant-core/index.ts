/**
 * Assistant Core â€” public API.
 *
 * Usage:
 *   import { initAssistantCore, trySkillRoute } from '../assistant-core';
 *   initAssistantCore();  // once at app startup
 *   const result = await trySkillRoute(message, options);
 */

export { registerBuiltinSkills } from './skills/loader';
export { registerSkill, matchMessage, getAllSkills, getSkill, clearRegistry } from './skills/registry';
export { matchSkill, matchBestSkill } from './skills/matcher';
export { trySkillRoute, resumeSkillExecution, type RecipeResult } from './router/recipeRouter';
export type {
  SkillDefinition,
  SkillMatch,
  SkillHandler,
  ExecutionPlan,
  PlanStep,
  PlannedToolCall,
  ExecutedToolCall,
  ExecutionEvent,
  ConfirmationPolicy,
  ActiveWorkItem,
} from './domain/types';
export {
  generateCorrelationId,
  isWorkItemExpired,
  WORK_ITEM_TTL_MS,
} from './domain/types';
export { validateAndNormalizeParams, normalizeIndustry } from './skills/paramSchema';

import { registerBuiltinSkills as _registerBuiltinSkills } from './skills/loader';

/**
 * Initialize the assistant core: register all built-in skills.
 * Call once at app startup (e.g., in app/(workspace)/layout.tsx).
 */
export function initAssistantCore(): void {
  _registerBuiltinSkills();
}

