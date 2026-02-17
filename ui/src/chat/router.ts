export type ModelRoute = 'qwen3' | 'gemma' | 'deepseek' | 'openai';

export interface RouteDecision {
  model: ModelRoute;
  reason: string;
}

const ENABLE_OPENAI_ROUTE =
  (import.meta.env.VITE_CHAT_ENABLE_OPENAI_ROUTE || 'false').toLowerCase() === 'true';

const PLANNER_PATTERNS: RegExp[] = [
  /\bthen\b.*\bthen\b/i,
  /\bif\b.*\bthen\b/i,
  /\bfirst\b.*\bthen\b/i,
  /\bresearch.*\bassess\b/i,
  /\bfind.*\benroll\b/i,
  /\bplan\b/i,
  /\bstrateg/i,
  /\banaly[sz]e\b.*\brecommend\b/i,
  /\bcompare\b.*\bcampaign/i,
  /\bwhich.*\bshould\b/i,
  /\bprioritize\b/i,
  /\bbest\s+approach\b/i,
];

const FALLBACK_PATTERNS: RegExp[] = [
  /\buse gpt\b/i,
  /\bhigh.?quality\b/i,
  /\bcareful\b/i,
  /\bdraft.*email.*from scratch\b/i,
  /\bwrite.*template\b/i,
];

const FUNCTION_CALL_PATTERNS: RegExp[] = [
  /\b(find|search|look\s*up|show|get|list)\b/i,
  /\b(add|create|new)\b/i,
  /\b(delete|remove)\b/i,
  /\b(status|stats|metrics)\b/i,
  /\b(start|stop|run|pause|activate)\b/i,
  /\b(approve|reject|review)\b/i,
  /\b(upload|export|send)\b/i,
  /\b(research|assess)\b/i,
];

const ROUTER_INTENT_PATTERNS: RegExp[] = [
  /\bresearch\b/i,
  /\bdraft\b/i,
  /\bfollow[\s-]?up\b/i,
  /\bobjection\b/i,
  /\benrich(ment)?\b/i,
];

export function routeMessage(message: string): RouteDecision {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Meta/help request; no backend tool required.
  if (/\blist tools?\b/i.test(lower) || /\bwhat tools\b/i.test(lower)) {
    return { model: 'gemma', reason: 'tool_help_request' };
  }

  for (const pat of FALLBACK_PATTERNS) {
    if (pat.test(trimmed)) {
      if (ENABLE_OPENAI_ROUTE) {
        return { model: 'openai', reason: 'explicit_quality_request_openai' };
      }
      return { model: 'deepseek', reason: 'explicit_quality_request_local' };
    }
  }

  for (const pat of PLANNER_PATTERNS) {
    if (pat.test(trimmed)) {
      return { model: 'deepseek', reason: 'complex_multi_step' };
    }
  }

  // Filter-heavy entity discovery should use tool brain planning.
  if (/\b(show|find|search|list)\b/i.test(trimmed) && /\b(in|near|from)\b/i.test(trimmed)) {
    if (/\b(compan(y|ies)|clinic|industry|sector|vertical|state|city|region)\b/i.test(trimmed)) {
      return { model: 'qwen3', reason: 'advanced_search_with_filters' };
    }
  }

  const sentenceCount = trimmed.split(/[.!?]+/).filter(Boolean).length;
  if (trimmed.length > 200 && sentenceCount >= 3) {
    return { model: 'deepseek', reason: 'long_complex_request' };
  }

  for (const pat of FUNCTION_CALL_PATTERNS) {
    if (pat.test(trimmed)) {
      return { model: 'qwen3', reason: 'tool_eligible_request' };
    }
  }

  for (const pat of ROUTER_INTENT_PATTERNS) {
    if (pat.test(trimmed)) {
      return { model: 'qwen3', reason: 'intent_router_request' };
    }
  }

  return { model: 'gemma', reason: 'general_dialogue' };
}

export function shouldFallback(result: {
  success: boolean;
  response: string;
  toolsUsed: string[];
}): boolean {
  if (!result.success) return true;
  if (result.toolsUsed.length > 0 && !result.response.trim()) return true;
  if (result.toolsUsed.length >= 3 && result.response.length < 20) return true;

  const confusionSignals = [
    'i cannot',
    "i don't have",
    "i'm not able",
    'as an ai',
    'i apologize but',
    "i'll do that",
    'i am running',
  ];
  const lower = result.response.toLowerCase();
  return confusionSignals.some((signal) => lower.includes(signal));
}
