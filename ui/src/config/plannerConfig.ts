export type PlannerModelName = 'gemma' | 'gpt-4o-mini' | 'gpt-4o' | 'claude-sonnet';
export type PlannerProviderName = 'ollama' | 'openai' | 'openrouter';

export interface PlannerModelConfig {
  simple: PlannerModelName;
  complex: PlannerModelName;
  decomposition: PlannerModelName;
}

export const DEFAULT_MODEL_CONFIG: PlannerModelConfig = {
  simple: 'gemma',
  complex: 'gpt-4o-mini',
  decomposition: 'gpt-4o-mini',
};

export const PREMIUM_MODEL_CONFIG: PlannerModelConfig = {
  simple: 'gemma',
  complex: 'gpt-4o',
  decomposition: 'gpt-4o',
};

const mode = (process.env.NEXT_PUBLIC_PLANNER_MODEL_PROFILE || 'default').toLowerCase();
const base = mode === 'premium' ? PREMIUM_MODEL_CONFIG : DEFAULT_MODEL_CONFIG;

export const ACTIVE_MODEL_CONFIG: PlannerModelConfig = {
  simple: (process.env.NEXT_PUBLIC_PLANNER_SIMPLE_MODEL_PROFILE as PlannerModelName) || base.simple,
  complex: (process.env.NEXT_PUBLIC_PLANNER_COMPLEX_MODEL_PROFILE as PlannerModelName) || base.complex,
  decomposition: (process.env.NEXT_PUBLIC_PLANNER_DECOMPOSITION_MODEL_PROFILE as PlannerModelName) || base.decomposition,
};

export const MODEL_PROVIDER_HINTS: Record<PlannerModelName, PlannerProviderName> = {
  gemma: 'ollama',
  'gpt-4o-mini': 'openai',
  'gpt-4o': 'openai',
  'claude-sonnet': 'openrouter',
};

export const MODEL_ID_HINTS: Record<PlannerModelName, string> = {
  gemma: process.env.NEXT_PUBLIC_OLLAMA_GEMMA_MODEL || process.env.NEXT_PUBLIC_OLLAMA_TOOL_BRAIN_MODEL || 'gemma3:12b',
  'gpt-4o-mini': process.env.NEXT_PUBLIC_OPENAI_PLANNER_COMPLEX_MODEL || 'gpt-4o-mini',
  'gpt-4o': process.env.NEXT_PUBLIC_OPENAI_PLANNER_PREMIUM_MODEL || 'gpt-4o',
  'claude-sonnet': process.env.NEXT_PUBLIC_OPENROUTER_PLANNER_COMPLEX_MODEL || 'anthropic/claude-3.5-sonnet',
};


