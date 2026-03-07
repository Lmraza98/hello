import type { ChatCompletionMessageParam } from './chatEngineTypes';
import type { ModelRoute } from './router';
import { routeMessage } from './router';
import { getOllamaReadyFast } from './ollamaStatus';
import { ollamaChat, type LocalChatMessage } from './models/ollamaClient';
import { TOOL_BRAIN_MODEL } from './models/toolBrainConfig';
import type { ChatSessionState } from './sessionState';
import { estimateChars } from './chatEngineDebug';

export type SynthesisExecutedCall = {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  durationMs?: number;
};

export type SynthesisInput = {
  userMessage: string;
  normalizedMessage?: string;
  intentText?: string;
  pageContext?: string | null;
  sessionState?: ChatSessionState;
  executedCalls: SynthesisExecutedCall[];
  fallbackResponse: string;
};

export type SynthesisResult = {
  response: string;
  modelUsed: ModelRoute;
  promptChars: number;
  synthesized: boolean;
};

const ENABLE_CHAT_SYNTHESIS = (process.env.NEXT_PUBLIC_CHAT_SYNTHESIS || 'true').toLowerCase() === 'true';
const SYNTHESIS_MODEL_OVERRIDE = (process.env.NEXT_PUBLIC_CHAT_SYNTHESIS_MODEL || '').trim();
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const OPENAI_MODEL = process.env.NEXT_PUBLIC_OPENAI_SYNTHESIS_MODEL || 'gpt-4o-mini';
const QWEN_MODEL = process.env.NEXT_PUBLIC_OLLAMA_QWEN3_MODEL || TOOL_BRAIN_MODEL;
const GEMMA_MODEL = process.env.NEXT_PUBLIC_OLLAMA_GEMMA_MODEL || 'gemma3:12b';
const DEEPSEEK_MODEL = process.env.NEXT_PUBLIC_OLLAMA_DEEPSEEK_MODEL || 'deepseek-r1:14b';

const MAX_CALLS = 8;
const MAX_STRING = 240;
const MAX_ARRAY = 5;
const MAX_OBJECT_KEYS = 12;
const MAX_DEPTH = 3;

function truncate(value: string, limit = MAX_STRING): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]`;
}

function compactUnknown(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth >= MAX_DEPTH) {
    if (typeof value === 'string') return truncate(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return '[truncated]';
  }
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((item) => compactUnknown(item, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more items]`);
    return out;
  }
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const preferred = ['error', 'message', 'detail', 'status', 'results', 'items', 'title', 'entity_type', 'entity_id'];
    const keys = [...new Set([...preferred.filter((k) => k in input), ...Object.keys(input)])].slice(0, MAX_OBJECT_KEYS);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = compactUnknown(input[key], depth + 1);
    }
    if (Object.keys(input).length > keys.length) {
      out._truncated_keys = Object.keys(input).length - keys.length;
    }
    return out;
  }
  return String(value);
}

export function compactExecutedCalls(executedCalls: SynthesisExecutedCall[]): SynthesisExecutedCall[] {
  return executedCalls.slice(0, MAX_CALLS).map((call) => ({
    name: call.name,
    ok: call.ok,
    durationMs: call.durationMs,
    args: compactUnknown(call.args) as Record<string, unknown>,
    result: compactUnknown(call.result),
  }));
}

function buildSessionContext(sessionState: ChatSessionState | undefined): string | null {
  if (!sessionState) return null;
  const entities = Array.isArray(sessionState.entities) ? sessionState.entities : [];
  if (entities.length === 0 && !(sessionState.browserTasks?.running?.length)) return null;
  const recent = sessionState.entities.slice(0, 5).map((entity) => ({
    entity_type: entity.entityType,
    entity_id: entity.entityId,
    label: entity.label || null,
    score: entity.score ?? null,
  }));
  return JSON.stringify({
    active: sessionState.activeEntity
      ? {
          entity_type: sessionState.activeEntity.entityType,
          entity_id: sessionState.activeEntity.entityId,
          label: sessionState.activeEntity.label || null,
        }
      : null,
    recent,
    browser_tasks:
      sessionState.browserTasks?.running?.slice(0, 5).map((task) => ({
        task_id: task.taskId,
        status: task.status,
        stage: task.stage || null,
        progress_pct: task.progressPct ?? null,
        operation: task.operation || null,
      })) || [],
  });
}

export function buildSynthesisPrompt(input: {
  userMessage: string;
  normalizedMessage?: string;
  intentText?: string;
  pageContext?: string | null;
  sessionContext?: string | null;
  executedCalls: SynthesisExecutedCall[];
}): ChatCompletionMessageParam[] {
  const callsJson = JSON.stringify(input.executedCalls, null, 2);
  const userBlock = [
    `RAW_USER_MESSAGE: ${input.userMessage}`,
    input.normalizedMessage ? `NORMALIZED_MESSAGE: ${input.normalizedMessage}` : null,
    input.intentText ? `INTENT_TEXT: ${input.intentText}` : null,
    input.pageContext ? `PAGE_CONTEXT: ${input.pageContext}` : null,
    input.sessionContext ? `SESSION_CONTEXT: ${input.sessionContext}` : null,
    `TOOL_OBSERVATIONS_JSON:\n${callsJson}`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You are an assistant synthesizing tool observations into a final user response.\n' +
        'Rules:\n' +
        '- Use ONLY provided tool observations as facts.\n' +
        '- Be clear and structured.\n' +
        '- No hallucinations. If unknown, say unknown.\n' +
        '- Cite tool facts inline (tool name + key evidence).\n' +
        '- Propose next best actions.\n' +
        '- If next action writes data, explicitly require confirmation.\n' +
        '- Return plain text only. Do not call tools. Do not output JSON.',
    },
    {
      role: 'user',
      content: userBlock,
    },
  ];
}

function toLocalMessages(messages: ChatCompletionMessageParam[]): LocalChatMessage[] {
  return messages
    .filter((m) => m.role === 'system' || m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    }));
}

function parseModelRoute(override: string): ModelRoute | null {
  const value = override.trim().toLowerCase();
  if (value === 'qwen3' || value === 'gemma' || value === 'deepseek' || value === 'openai') {
    return value;
  }
  return null;
}

function getSynthesisRoute(userMessage: string): ModelRoute {
  const overrideRoute = parseModelRoute(SYNTHESIS_MODEL_OVERRIDE);
  if (overrideRoute) return overrideRoute;
  if (getOllamaReadyFast()) return 'qwen3';
  return routeMessage(userMessage).model;
}

function getOllamaModelForRoute(route: ModelRoute): string {
  if (SYNTHESIS_MODEL_OVERRIDE && !parseModelRoute(SYNTHESIS_MODEL_OVERRIDE)) return SYNTHESIS_MODEL_OVERRIDE;
  if (route === 'qwen3') return QWEN_MODEL;
  if (route === 'deepseek') return DEEPSEEK_MODEL;
  return GEMMA_MODEL;
}

async function synthesizeWithOpenAI(messages: ChatCompletionMessageParam[]): Promise<string> {
  const res = await fetch(`${API_BASE}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      model: OPENAI_MODEL,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`openai_synthesis_failed_${res.status}`);
  const payload = (await res.json()) as { message?: { content?: string | null } };
  return String(payload?.message?.content || '').trim();
}

async function synthesizeWithOllama(route: ModelRoute, messages: ChatCompletionMessageParam[]): Promise<string> {
  const model = getOllamaModelForRoute(route);
  const response = await ollamaChat({
    model,
    messages: toLocalMessages(messages),
    temperature: 0.2,
    numPredict: 320,
  });
  return String(response.message.content || '').trim();
}

export async function synthesizeAnswer(input: SynthesisInput): Promise<SynthesisResult> {
  const compacted = compactExecutedCalls(input.executedCalls);
  const prompt = buildSynthesisPrompt({
    userMessage: input.userMessage,
    normalizedMessage: input.normalizedMessage,
    intentText: input.intentText,
    pageContext: input.pageContext,
    sessionContext: buildSessionContext(input.sessionState),
    executedCalls: compacted,
  });
  const promptChars = estimateChars(prompt);
  if (!ENABLE_CHAT_SYNTHESIS || compacted.length === 0) {
    return {
      response: input.fallbackResponse,
      modelUsed: getSynthesisRoute(input.userMessage),
      promptChars,
      synthesized: false,
    };
  }

  const route = getSynthesisRoute(input.userMessage);
  try {
    const response =
      route === 'openai'
        ? await synthesizeWithOpenAI(prompt)
        : await synthesizeWithOllama(route, prompt);
    if (!response) {
      return { response: input.fallbackResponse, modelUsed: route, promptChars, synthesized: false };
    }
    return { response, modelUsed: route, promptChars, synthesized: true };
  } catch {
    return {
      response: input.fallbackResponse,
      modelUsed: route,
      promptChars,
      synthesized: false,
    };
  }
}

