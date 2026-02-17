import { TOOL_BRAIN_MODEL } from './models/toolBrainConfig';
import { listOllamaModels, type LocalChatMessage } from './models/ollamaClient';
import type { ChatCompletionMessageParam } from './chatEngineTypes';

const LOCAL_MODEL_PRIORITY = [
  TOOL_BRAIN_MODEL,
  import.meta.env.VITE_OLLAMA_QWEN3_MODEL || 'qwen3-coder-next:latest',
  import.meta.env.VITE_OLLAMA_GEMMA_MODEL || 'gemma3:12b',
  import.meta.env.VITE_OLLAMA_DEEPSEEK_MODEL || 'deepseek-r1:14b',
] as const;

let ollamaStatus: { available: boolean; checkedAt: number } = {
  available: false,
  checkedAt: 0,
};
let ollamaChecking: Promise<void> | null = null;

const LOCAL_HISTORY_MAX_MESSAGES = Number.parseInt(import.meta.env.VITE_CHAT_HISTORY_MAX_MESSAGES || '10', 10);
const LOCAL_HISTORY_MAX_CONTENT_CHARS = Number.parseInt(import.meta.env.VITE_CHAT_HISTORY_MAX_CONTENT_CHARS || '700', 10);

function compactContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.slice(0, LOCAL_HISTORY_MAX_CONTENT_CHARS);
  }
  if (content == null) {
    return '';
  }
  try {
    const asJson = JSON.stringify(content);
    return (asJson || '').slice(0, LOCAL_HISTORY_MAX_CONTENT_CHARS);
  } catch {
    return String(content).slice(0, LOCAL_HISTORY_MAX_CONTENT_CHARS);
  }
}

function compactToolContent(content: unknown): string {
  if (content == null) return '[tool output omitted]';
  if (typeof content === 'string') {
    return content.length > 180
      ? `[tool output omitted: ${content.length} chars]`
      : content;
  }
  if (Array.isArray(content)) {
    return `[tool output omitted: ${content.length} items]`;
  }
  if (typeof content === 'object') {
    const keys = Object.keys(content as Record<string, unknown>);
    return `[tool output omitted: object keys ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', ...' : ''}]`;
  }
  return String(content);
}

export function toLocalHistory(history: ChatCompletionMessageParam[]): LocalChatMessage[] {
  const maxMessages = Number.isFinite(LOCAL_HISTORY_MAX_MESSAGES) && LOCAL_HISTORY_MAX_MESSAGES > 0
    ? LOCAL_HISTORY_MAX_MESSAGES
    : 10;

  return history
    .slice(-maxMessages)
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const rawContent = (m as { content?: unknown }).content;
      const content = m.role === 'tool' ? compactToolContent(rawContent) : compactContent(rawContent);
      if (m.role === 'tool') return { role: 'tool', content } as LocalChatMessage;
      return { role: m.role, content } as LocalChatMessage;
    });
}

function refreshOllamaStatus(force = false): void {
  const now = Date.now();
  if (!force && now - ollamaStatus.checkedAt < 60_000) return;
  if (ollamaChecking) return;

  ollamaChecking = (async () => {
    try {
      const availableModels = await listOllamaModels();
      const normalizedModels = availableModels.map((m) => m.toLowerCase());
      const hasPreferredModel = LOCAL_MODEL_PRIORITY.some((preferred) =>
        normalizedModels.some((loaded) =>
          loaded.startsWith((preferred.split(':')[0] || preferred).toLowerCase())
        )
      );
      ollamaStatus = { available: hasPreferredModel, checkedAt: Date.now() };
    } catch {
      ollamaStatus = { available: false, checkedAt: Date.now() };
    } finally {
      ollamaChecking = null;
    }
  })();
}

export function forceRefreshOllama(): void {
  refreshOllamaStatus(true);
}

export function getOllamaReadyFast(): boolean {
  refreshOllamaStatus();
  if (ollamaStatus.checkedAt === 0) {
    // On first page load we haven't completed the async tags check yet.
    // Optimistically allow local routing while the check is in-flight.
    return Boolean(ollamaChecking);
  }
  return ollamaStatus.available;
}
