import type { ChatMessage } from '../../types/chat';
import { textMsg } from '../../services/messageHelpers';
import { dispatchToolCalls, type ParsedToolCall } from '../toolExecutor';
import { TOOLS } from '../tools';
import { ollamaChat, type LocalChatMessage } from './ollamaClient';

const MODEL = process.env.NEXT_PUBLIC_OLLAMA_DEEPSEEK_MODEL || 'deepseek-r1:14b';

const SYSTEM_PROMPT = `You are a sales automation planner for complex multi-step requests.

You should:
1) Produce a short tool plan as JSON array.
2) Do not include prose.
3) Keep tool args valid and concise.`;

function convertToolsForOllama() {
  return TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

export interface DeepseekResult {
  response: string;
  messages: ChatMessage[];
  toolsUsed: string[];
  success: boolean;
}

export async function runDeepseek(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  onToolCall?: (name: string) => void,
  modelOverride?: string,
  _onToken?: (token: string) => void,
): Promise<DeepseekResult> {
  const ollamaTools = convertToolsForOllama();

  const messages: LocalChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.slice(-8),
    { role: 'user', content: userMessage },
  ];

  try {
    const result = await ollamaChat({
      model: modelOverride || MODEL,
      messages,
      tools: ollamaTools,
      temperature: 0.1,
    });

    const toolCalls = result.message.tool_calls || [];
    if (toolCalls.length === 0) {
      const text = result.message.content?.trim() || 'Plan completed.';
      return { response: text, messages: [textMsg(text)], toolsUsed: [], success: true };
    }

    const planned: ParsedToolCall[] = toolCalls.map((tc) => {
      let args: Record<string, unknown> = {};
      const raw = tc.function.arguments;
      if (typeof raw === 'string') {
        try {
          args = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        args = raw as Record<string, unknown>;
      }
      return { name: tc.function.name, args };
    });

    const dispatched = await dispatchToolCalls(planned, onToolCall);
    return {
      response: dispatched.summary,
      messages: [textMsg(dispatched.summary)],
      toolsUsed: dispatched.toolsUsed,
      success: dispatched.success,
    };
  } catch {
    return { response: '', messages: [], toolsUsed: [], success: false };
  }
}

