import type { ChatMessage } from '../../types/chat';
import { statusMsg, textMsg } from '../../services/messageHelpers';
import { executeTool } from '../toolExecutor';
import { TOOLS } from '../tools';
import type { ChatCompletionMessageParam, ToolCall } from '../chatEngineTypes';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const OPENAI_CHAT_MODEL =
  import.meta.env.VITE_OPENAI_CHAT_MODEL ||
  import.meta.env.VITE_OPENAI_SYNTHESIS_MODEL ||
  'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 10;

const SYSTEM_PROMPT = `You are a sales automation assistant embedded in a CRM dashboard.

Rules:
1. Search before acting.
2. Confirm destructive actions.
3. Summarize results naturally.
4. For background ops, tell the user it is running.
5. Keep responses concise and action-oriented.`;

type ChatProxyResponse = {
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
  };
  usage?: Record<string, unknown>;
};

async function requestCompletion(messages: ChatCompletionMessageParam[]) {
  const res = await fetch(`${API_BASE}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      tools: TOOLS,
      model: OPENAI_CHAT_MODEL,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const detail = payload?.detail?.message || payload?.detail || res.statusText;
    throw new Error(`Chat completion failed: ${detail}`);
  }

  return (await res.json()) as ChatProxyResponse;
}

export interface OpenAIResult {
  response: string;
  messages: ChatMessage[];
  toolsUsed: string[];
  success: boolean;
}

export async function runOpenAI(
  userMessage: string,
  conversationHistory: ChatCompletionMessageParam[],
  onToolCall?: (name: string) => void,
  _onToken?: (token: string) => void,
): Promise<OpenAIResult> {
  const toolsUsed: string[] = [];
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let round = 0;
  while (round < MAX_TOOL_ROUNDS) {
    try {
      const completion = await requestCompletion(messages);
      const assistantMessage: ChatCompletionMessageParam = {
        role: 'assistant',
        content: completion.message.content,
        ...(completion.message.tool_calls ? { tool_calls: completion.message.tool_calls } : {}),
      };
      messages.push(assistantMessage);

      const toolCalls = completion.message.tool_calls || [];
      if (toolCalls.length === 0) {
        const responseText = completion.message.content?.trim() || 'Done.';
        return {
          response: responseText,
          messages: [textMsg(responseText)],
          toolsUsed,
          success: true,
        };
      }

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        toolsUsed.push(toolName);
        onToolCall?.(toolName);

        const rawArgs = toolCall.function.arguments || '{}';
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }

        let result: unknown;
        try {
          result = await executeTool(toolName, parsedArgs);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          result = { error: true, message };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      round += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      response: `API error: ${message}`,
      messages: [statusMsg(`Failed to reach OpenAI chat model (${OPENAI_CHAT_MODEL}): ${message}`, 'error')],
      toolsUsed,
      success: false,
    };
  }
  }

  return {
    response: 'Operations completed.',
    messages: [textMsg('Done. What is next?')],
    toolsUsed,
    success: true,
  };
}
