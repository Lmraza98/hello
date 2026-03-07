export const ENABLE_PLAN_COVERAGE_AUDIT =
  (process.env.NEXT_PUBLIC_PLAN_COVERAGE_AUDIT || 'false').toLowerCase() === 'true';
export const ENABLE_AUX_PLANNER_FALLBACK =
  (process.env.NEXT_PUBLIC_ENABLE_AUX_PLANNER_FALLBACK || 'true').toLowerCase() === 'true';
export const TOOL_PLANNER_TIMEOUT_MS = Number.parseInt(process.env.NEXT_PUBLIC_TOOL_PLANNER_TIMEOUT_MS || '15000', 10);
export const TASK_DECOMPOSITION_TIMEOUT_MS = Number.parseInt(
  process.env.NEXT_PUBLIC_TASK_DECOMPOSITION_TIMEOUT_MS || '4500',
  10
);
export const AUX_PLANNER_MODEL =
  process.env.NEXT_PUBLIC_OLLAMA_AUX_PLANNER_MODEL || process.env.NEXT_PUBLIC_OLLAMA_GEMMA_MODEL || 'gemma3:12b';
export const FILTER_CONTEXT_TTL_MS = 60_000;
export const FILTER_CONTEXT_PREFETCH_INTERVAL_MS = 45_000;

