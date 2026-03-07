export type PlannerBackend = 'qwen3' | 'devstral' | 'functiongemma';
export type ToolBrainName = PlannerBackend;

function normalizePlannerBackend(value: string | undefined): PlannerBackend {
  const normalized = (value || '').trim().toLowerCase();
  const base = normalized.split(':')[0]?.trim() || normalized;
  if (base === 'functiongemma' || base === 'function_gemma') return 'functiongemma';
  if (
    base === 'devstral' ||
    base === 'devstral-small' ||
    base === 'devstral-small-2' ||
    base === 'devstral-small-2-24b'
  ) return 'devstral';
  return 'qwen3';
}

const configuredBackend =
  process.env.NEXT_PUBLIC_PLANNER_BACKEND ||
  process.env.NEXT_PUBLIC_TOOL_BRAIN;

export const PLANNER_BACKEND: PlannerBackend = normalizePlannerBackend(configuredBackend);

export const TOOL_BRAIN_NAME: ToolBrainName = PLANNER_BACKEND;

export const TOOL_BRAIN_MODEL =
  process.env.NEXT_PUBLIC_OLLAMA_TOOL_BRAIN_MODEL ||
  (PLANNER_BACKEND === 'functiongemma'
    ? (process.env.NEXT_PUBLIC_OLLAMA_FUNCTIONGEMMA_MODEL || 'functiongemma:latest')
    : (PLANNER_BACKEND === 'devstral'
      ? (process.env.NEXT_PUBLIC_OLLAMA_DEVSTRAL_MODEL || 'devstral-small-2:latest')
      : (process.env.NEXT_PUBLIC_OLLAMA_QWEN3_MODEL || 'qwen3-coder-next:latest')));

export const OPENROUTER_TOOL_BRAIN_MODEL =
  process.env.NEXT_PUBLIC_OPENROUTER_TOOL_BRAIN_MODEL ||
  (PLANNER_BACKEND === 'devstral'
    ? (process.env.NEXT_PUBLIC_OPENROUTER_DEVSTRAL_MODEL || 'mistralai/devstral-small')
    : (process.env.NEXT_PUBLIC_OPENROUTER_QWEN3_MODEL || 'qwen/qwen3-coder-next'));

