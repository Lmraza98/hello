import { ollamaChat, type LocalChatMessage } from './ollamaClient';
import { runFunctionGemma } from './functionGemmaProvider';
import {
  OPENROUTER_TOOL_BRAIN_MODEL,
  PLANNER_BACKEND,
  TOOL_BRAIN_MODEL,
  type PlannerBackend,
} from './toolBrainConfig';

export interface PlannerSampling {
  temperature?: number;
  topP?: number;
  topK?: number;
  numPredict?: number;
  signal?: AbortSignal;
  /** When provided, enables streaming mode on the Ollama backend and calls
   *  this function with each token chunk as it arrives. */
  onToken?: (token: string) => void;
}

export type PlannerAskFn = (
  messages: LocalChatMessage[],
  options?: PlannerSampling
) => Promise<{ content: string | null }>;

export type PlannerProvider = 'ollama' | 'openai' | 'openrouter';

export interface PlannerRoute {
  backend?: PlannerBackend;
  provider?: PlannerProvider;
  model?: string;
}

const NEVER_ABORT_SIGNAL: AbortSignal = new AbortController().signal;

const BACKEND_DEFAULTS: Record<PlannerBackend, Required<PlannerSampling>> = {
  qwen3: {
    temperature: Number.parseFloat(process.env.NEXT_PUBLIC_QWEN3_TEMPERATURE || '0.4'),
    topP: Number.parseFloat(process.env.NEXT_PUBLIC_QWEN3_TOP_P || '0.95'),
    topK: Number.parseInt(process.env.NEXT_PUBLIC_QWEN3_TOP_K || '40', 10),
    numPredict: Number.parseInt(process.env.NEXT_PUBLIC_QWEN3_NUM_PREDICT || '384', 10),
    signal: NEVER_ABORT_SIGNAL,
    onToken: () => {},
  },
  devstral: {
    temperature: Number.parseFloat(process.env.NEXT_PUBLIC_DEVSTRAL_TEMPERATURE || '0.3'),
    topP: Number.parseFloat(process.env.NEXT_PUBLIC_DEVSTRAL_TOP_P || '0.9'),
    topK: Number.parseInt(process.env.NEXT_PUBLIC_DEVSTRAL_TOP_K || '20', 10),
    numPredict: Number.parseInt(process.env.NEXT_PUBLIC_DEVSTRAL_NUM_PREDICT || '384', 10),
    signal: NEVER_ABORT_SIGNAL,
    onToken: () => {},
  },
  functiongemma: {
    temperature: 0.0,
    topP: 0.9,
    topK: 20,
    numPredict: 256,
    signal: NEVER_ABORT_SIGNAL,
    onToken: () => {},
  },
};

export function createPlannerAskFn(route: PlannerRoute = {}): PlannerAskFn {
  const backend = route.backend || PLANNER_BACKEND;
  const provider = (
    route.provider ||
    process.env.NEXT_PUBLIC_PLANNER_PROVIDER ||
    process.env.NEXT_PUBLIC_QWEN3_PROVIDER ||
    'ollama'
  ).toLowerCase() as PlannerProvider;
  const defaults = BACKEND_DEFAULTS[backend];
  const openaiPlannerModel = process.env.NEXT_PUBLIC_OPENAI_PLANNER_MODEL || process.env.NEXT_PUBLIC_OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  const openrouterPlannerModel = process.env.NEXT_PUBLIC_OPENROUTER_PLANNER_MODEL || OPENROUTER_TOOL_BRAIN_MODEL;
  const defaultModelForProvider =
    provider === 'openai'
      ? openaiPlannerModel
      : (provider === 'openrouter' ? openrouterPlannerModel : TOOL_BRAIN_MODEL);
  const selectedModel = route.model || defaultModelForProvider;

  return async (messages, options = {}) => {
    const readErrorDetail = async (res: Response): Promise<string> => {
      try {
        const payload = await res.json() as { detail?: { code?: string; message?: string } | string };
        if (typeof payload?.detail === 'string') return payload.detail;
        if (payload?.detail && typeof payload.detail === 'object') {
          const code = typeof payload.detail.code === 'string' ? payload.detail.code : '';
          const message = typeof payload.detail.message === 'string' ? payload.detail.message : '';
          return [code, message].filter(Boolean).join(':');
        }
        return '';
      } catch {
        return '';
      }
    };
    if (backend === 'functiongemma') {
      // Use the function-gemma-specific caller which is optimized for tool planning.
      // Return JSON-only tool calls to satisfy the planner contract.
      const userMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const history = messages.filter((m) => m.role !== 'system');
      const result = await runFunctionGemma(userMessage, history, undefined, { executeTools: false });
      const calls = result.diagnostics?.parsedCalls || [];
      const normalized = calls.map((c) => ({ name: c.name, args: c.args || {} }));
      return { content: JSON.stringify(normalized) };
    }

    const sampling = {
      temperature:
        Number.isFinite(options.temperature as number)
          ? options.temperature
          : defaults.temperature,
      topP:
        Number.isFinite(options.topP as number)
          ? options.topP
          : defaults.topP,
      topK:
        Number.isFinite(options.topK as number)
          ? options.topK
          : defaults.topK,
      numPredict:
        Number.isFinite(options.numPredict as number)
          ? options.numPredict
          : defaults.numPredict,
    };

    if (provider === 'openrouter') {
      const res = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          provider: 'openrouter',
          model: selectedModel,
          temperature: sampling.temperature,
          top_p: sampling.topP,
          top_k: sampling.topK,
          messages: messages.map((m) => ({ role: m.role, content: m.content || '' })),
        }),
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        throw new Error(`planner_openrouter_error_${res.status}${detail ? `:${detail}` : ''}`);
      }
      const data = await res.json() as { message?: { content?: string | null } };
      return { content: data?.message?.content || null };
    }

    if (provider === 'openai') {
      const res = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          provider: 'openai',
          model: selectedModel,
          temperature: sampling.temperature,
          top_p: sampling.topP,
          messages: messages.map((m) => ({ role: m.role, content: m.content || '' })),
        }),
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        throw new Error(`planner_openai_error_${res.status}${detail ? `:${detail}` : ''}`);
      }
      const data = await res.json() as { message?: { content?: string | null } };
      return { content: data?.message?.content || null };
    }

    const local = await ollamaChat({
      model: selectedModel,
      messages,
      temperature: sampling.temperature,
      topP: sampling.topP,
      topK: sampling.topK,
      numPredict: sampling.numPredict,
      signal: options.signal,
      onToken: options.onToken,
    });
    return { content: local.message.content };
  };
}

