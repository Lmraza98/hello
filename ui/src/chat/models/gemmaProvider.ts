import type { ChatMessage } from '../../types/chat';
import { textMsg } from '../../services/messageHelpers';
import { ollamaChat, type LocalChatMessage } from './ollamaClient';

const MODEL = import.meta.env.VITE_OLLAMA_GEMMA_MODEL || 'gemma3:12b';

const SYSTEM_PROMPT = `You are a sales automation assistant for a CRM.

Rules:
- Search before acting.
- Confirm destructive actions.
- Summarize results naturally, do not dump raw JSON.
- Keep responses concise and action-oriented.`;

export interface GemmaResult {
  response: string;
  messages: ChatMessage[];
  toolsUsed: string[];
  success: boolean;
}

export async function runGemma(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  _onToolCall?: (name: string) => void
): Promise<GemmaResult> {
  const messages: LocalChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.slice(-10),
    { role: 'user', content: userMessage },
  ];

  try {
    const result = await ollamaChat({
      model: MODEL,
      messages,
      temperature: 0.2,
    });
    const text = result.message.content?.trim() || 'Done.';
    return { response: text, messages: [textMsg(text)], toolsUsed: [], success: true };
  } catch {
    return { response: '', messages: [], toolsUsed: [], success: false };
  }
}
