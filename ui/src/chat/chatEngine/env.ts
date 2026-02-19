/**
 * Chat engine environment flags and constants.
 *
 * Keep parsing semantics identical to historical `chatEngine.ts`:
 * - boolean flags parse via string `.toLowerCase() === 'true'`
 * - ints parse via `Number.parseInt(..., 10)`
 */

export function getEnvBool(name: string, defaultValue: boolean): boolean {
  const raw = (import.meta.env as Record<string, unknown>)[name];
  const value = (typeof raw === 'string' && raw.length > 0 ? raw : String(defaultValue)).toLowerCase();
  return value === 'true';
}

export function getEnvInt(name: string, defaultValue: number): number {
  const raw = (import.meta.env as Record<string, unknown>)[name];
  const text = typeof raw === 'string' && raw.length > 0 ? raw : String(defaultValue);
  return Number.parseInt(text, 10);
}

export const ENABLE_SKILL_ROUTER =
  (import.meta.env.VITE_ENABLE_SKILL_ROUTER || 'true').toLowerCase() === 'true';

export const ENABLE_CHAT_ENGINE_DEBUG_TRACE = (
  import.meta.env.VITE_CHAT_DEBUG ||
  import.meta.env.VITE_DEBUG_CHAT_ENGINE ||
  'false'
).toLowerCase() === 'true';

export const ENABLE_CHAT_ENGINE_HEAVY_DEBUG_TRACE =
  (import.meta.env.VITE_CHAT_DEBUG_HEAVY || 'false').toLowerCase() === 'true';

export const ENABLE_CHAT_MODEL_FAST_PATH =
  (import.meta.env.VITE_CHAT_MODEL_FAST_PATH || 'true').toLowerCase() === 'true';

export const AVOID_DUPLICATE_PLANNER_PASSES =
  (import.meta.env.VITE_CHAT_AVOID_DUPLICATE_PLANNER_PASSES || 'true').toLowerCase() === 'true';

export const ENABLE_GENERIC_RETRIEVAL_BOOTSTRAP =
  (import.meta.env.VITE_CHAT_GENERIC_RETRIEVAL_BOOTSTRAP || 'true').toLowerCase() === 'true';

export const ENABLE_OPENAI_FALLBACK =
  (import.meta.env.VITE_CHAT_ALLOW_OPENAI_FALLBACK || 'false').toLowerCase() === 'true';

export const CONVERSATION_MODEL = import.meta.env.VITE_OLLAMA_GEMMA_MODEL || 'gemma3:12b';
export const ENABLE_CHAT_BENCHMARK_MODE =
  (import.meta.env.VITE_CHAT_BENCHMARK_MODE || 'false').toLowerCase() === 'true';
export const CHAT_BENCHMARK_MODEL =
  import.meta.env.VITE_CHAT_BENCHMARK_MODEL ||
  import.meta.env.VITE_OLLAMA_QWEN3_MODEL ||
  CONVERSATION_MODEL;
export const CHAT_BENCHMARK_NUM_PREDICT = Number.parseInt(
  import.meta.env.VITE_CHAT_BENCHMARK_NUM_PREDICT || '256',
  10
);

// Intent classifier model. Historically this was functiongemma, but it frequently returns invalid output.
// Default to conversation model which is fast and reliably produces single-word classifications.
export const DECOMPOSE_CLASSIFIER_MODEL =
  import.meta.env.VITE_DECOMPOSE_CLASSIFIER_MODEL ||
  CONVERSATION_MODEL;

export const SESSION_ENTITY_MAX_AGE_MS = Number.parseInt(
  import.meta.env.VITE_CHAT_SESSION_ENTITY_MAX_AGE_MS || String(30 * 60 * 1000),
  10
);

export const MODEL_FAST_PATH_ALLOWED_TOOLS = [
  'hybrid_search',
  'resolve_entity',
  'ask_documents',
  'search_documents',
  'get_document_summary',
  'list_company_documents',
  'search_contacts',
  'search_companies',
  'get_contact',
  'create_note',
  'list_campaigns',
  'get_campaign',
  'create_campaign',
  'get_campaign_contacts',
  'get_active_conversations',
  'get_conversation_thread',
  'send_email_now',
  'enroll_contacts_in_campaign',
  'enroll_contacts_by_filter',
  'collect_companies_from_salesnav',
  'browser_health',
  'browser_navigate',
  'browser_snapshot',
  'browser_find_ref',
  'browser_act',
  'browser_search_and_extract',
  'browser_list_sub_items',
  'compound_workflow_run',
  'compound_workflow_status',
  'compound_workflow_continue',
  'compound_workflow_cancel',
] as const;
