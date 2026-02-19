import type { ChatMessage } from '../types/chat';
import { shouldFallback, type ModelRoute } from './router';
import { runGemma } from './models/gemmaProvider';
import { runDeepseek } from './models/deepseekProvider';
import { runOpenAI } from './models/openaiProvider';
import type { ChatCompletionMessageParam } from './chatEngineTypes';
import type { LocalChatMessage } from './models/ollamaClient';
import { textMsg } from '../services/messageHelpers';

const ALLOW_OPENAI_FALLBACK =
  (import.meta.env.VITE_CHAT_ALLOW_OPENAI_FALLBACK || 'false').toLowerCase() === 'true';

type StepRunner = (input: {
  userMessage: string;
  localHistory: LocalChatMessage[];
  history: ChatCompletionMessageParam[];
  onToolCall?: (name: string) => void;
  onToken?: (token: string) => void;
}) => Promise<{ response: string; messages: ChatMessage[]; toolsUsed: string[]; success: boolean }>;

const RUNNERS: Record<ModelRoute, StepRunner> = {
  qwen3: async ({ userMessage, localHistory, onToolCall, onToken }) => runGemma(userMessage, localHistory, onToolCall, onToken),
  gemma: async ({ userMessage, localHistory, onToolCall, onToken }) => runGemma(userMessage, localHistory, onToolCall, onToken),
  deepseek: async ({ userMessage, localHistory, onToolCall, onToken }) => runDeepseek(userMessage, localHistory, onToolCall, onToken),
  openai: async ({ userMessage, history, onToolCall, onToken }) => runOpenAI(userMessage, history, onToolCall, onToken),
};

const FALLBACK_CHAINS: Record<ModelRoute, ModelRoute[]> = {
  qwen3: ALLOW_OPENAI_FALLBACK ? ['gemma', 'deepseek', 'openai'] : ['gemma', 'deepseek'],
  gemma: ALLOW_OPENAI_FALLBACK ? ['gemma', 'deepseek', 'openai'] : ['gemma', 'deepseek'],
  deepseek: ALLOW_OPENAI_FALLBACK ? ['deepseek', 'openai'] : ['deepseek', 'gemma'],
  openai: ['openai'],
};

export async function runWithFallback(
  route: ModelRoute,
  userMessage: string,
  localHistory: LocalChatMessage[],
  history: ChatCompletionMessageParam[],
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

  let current = chain[0];
  let result = await RUNNERS[current]({ userMessage, localHistory, history, onToolCall, onToken });

  for (let i = 1; i < chain.length && shouldFallback(result); i++) {
    const next = chain[i];
    const reason = `${current}_failed`;
    switches.push({ from: current, to: next, reason });
    onModelSwitch?.(current, next, reason);
    fallbackUsed = true;
    current = next;
    result = await RUNNERS[current]({ userMessage, localHistory, history, onToolCall, onToken });
  }

  const exhausted = shouldFallback(result);
  if (exhausted && !ALLOW_OPENAI_FALLBACK) {
    const response =
      'I could not complete that because local models are unavailable. Start Ollama (or enable OpenAI fallback) and try again.';
    return {
      response,
      messages: [textMsg(response)],
      toolsUsed: result.toolsUsed,
      success: false,
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
