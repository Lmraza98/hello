import type { ChatMessage } from '../types/chat';
import { shouldFallback, type ModelRoute } from './router';
import { runGemma } from './models/gemmaProvider';
import { runDeepseek } from './models/deepseekProvider';
import { runOpenAI } from './models/openaiProvider';
import type { ChatCompletionMessageParam } from './chatEngineTypes';
import type { LocalChatMessage } from './models/ollamaClient';
import { textMsg } from '../services/messageHelpers';

const ALLOW_OPENAI_FALLBACK =
  (process.env.NEXT_PUBLIC_CHAT_ALLOW_OPENAI_FALLBACK || 'false').toLowerCase() === 'true';

type StepRunner = (input: {
  userMessage: string;
  localHistory: LocalChatMessage[];
  history: ChatCompletionMessageParam[];
  modelOverride?: string;
  onToolCall?: (name: string) => void;
  onToken?: (token: string) => void;
}) => Promise<{ response: string; messages: ChatMessage[]; toolsUsed: string[]; success: boolean }>;

const RUNNERS: Record<ModelRoute, StepRunner> = {
  qwen3: async ({ userMessage, localHistory, modelOverride, onToolCall, onToken }) => runGemma(userMessage, localHistory, onToolCall, modelOverride, onToken),
  gemma: async ({ userMessage, localHistory, modelOverride, onToolCall, onToken }) => runGemma(userMessage, localHistory, onToolCall, modelOverride, onToken),
  deepseek: async ({ userMessage, localHistory, modelOverride, onToolCall, onToken }) => runDeepseek(userMessage, localHistory, onToolCall, modelOverride, onToken),
  openai: async ({ userMessage, history, modelOverride, onToolCall, onToken }) => runOpenAI(userMessage, history, onToolCall, modelOverride, onToken),
};

const FALLBACK_CHAINS: Record<ModelRoute, ModelRoute[]> = {
  qwen3: ALLOW_OPENAI_FALLBACK ? ['gemma', 'deepseek', 'openai'] : ['gemma', 'deepseek'],
  gemma: ALLOW_OPENAI_FALLBACK ? ['gemma', 'deepseek', 'openai'] : ['gemma', 'deepseek'],
  deepseek: ALLOW_OPENAI_FALLBACK ? ['deepseek', 'openai'] : ['deepseek', 'gemma'],
  openai: ['openai'],
};

function buildOfflineFallbackResponse(userMessage: string): string {
  const raw = (userMessage || '').trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return 'I am online, but local language models are unavailable. Start Ollama (or enable OpenAI fallback) to restore full chat responses.';
  }

  if (/^(hi|hello|hey|yo|good\s+(morning|afternoon|evening))\b/.test(lower)) {
    return 'Hi. I am in limited mode because local language models are unavailable. Start Ollama (or enable OpenAI fallback) for full chat.';
  }

  if (/\b(help|what can you do|capabilit(?:y|ies)|how can you help)\b/.test(lower)) {
    return (
      'I am in limited mode because local language models are unavailable. ' +
      'I can still run deterministic actions and tools, but for full conversational answers start Ollama (or enable OpenAI fallback).'
    );
  }

  return (
    'I cannot run full conversational responses right now because local language models are unavailable. ' +
    'Start Ollama (or enable OpenAI fallback), or ask me to run a deterministic action.'
  );
}

export async function runWithFallback(
  route: ModelRoute,
  userMessage: string,
  localHistory: LocalChatMessage[],
  history: ChatCompletionMessageParam[],
  chatModelOverride?: string,
  chatModelProviderOverride?: 'ollama' | 'openai' | 'openrouter',
  onToolCall?: (name: string) => void,
  onToken?: (token: string) => void,
  onModelSwitch?: (from: ModelRoute, to: ModelRoute, reason: string) => void
): Promise<{
  response: string;
  messages: ChatMessage[];
  toolsUsed: string[];
  success: boolean;
  modelUsed: ModelRoute;
  fallbackUsed: boolean;
  switches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }>;
}> {
  const chain = FALLBACK_CHAINS[route] || (ALLOW_OPENAI_FALLBACK ? ['openai'] : ['gemma', 'deepseek']);
  const switches: Array<{ from: ModelRoute; to: ModelRoute; reason: string }> = [];
  let fallbackUsed = false;
  const routeProvider = (r: ModelRoute): 'ollama' | 'openai' => (r === 'openai' ? 'openai' : 'ollama');
  const overrideForRoute = (r: ModelRoute): string | undefined => {
    if (!chatModelOverride) return undefined;
    if (!chatModelProviderOverride) return chatModelOverride;
    return routeProvider(r) === chatModelProviderOverride ? chatModelOverride : undefined;
  };

  let current = chain[0];
  let result = await RUNNERS[current]({ userMessage, localHistory, history, modelOverride: overrideForRoute(current), onToolCall, onToken });

  for (let i = 1; i < chain.length && shouldFallback(result); i++) {
    const next = chain[i];
    const reason = `${current}_failed`;
    switches.push({ from: current, to: next, reason });
    onModelSwitch?.(current, next, reason);
    fallbackUsed = true;
    current = next;
    result = await RUNNERS[current]({ userMessage, localHistory, history, modelOverride: overrideForRoute(current), onToolCall, onToken });
  }

  const exhausted = shouldFallback(result);
  if (exhausted && !ALLOW_OPENAI_FALLBACK) {
    const response = buildOfflineFallbackResponse(userMessage);
    return {
      response,
      messages: [textMsg(response)],
      toolsUsed: result.toolsUsed,
      success: true,
      modelUsed: current,
      fallbackUsed: true,
      switches,
    };
  }

  return {
    response: result.response,
    messages: result.messages,
    toolsUsed: result.toolsUsed,
    success: result.success,
    modelUsed: current,
    fallbackUsed,
    switches,
  };
}

