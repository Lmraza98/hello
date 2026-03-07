const OLLAMA_BASE = process.env.NEXT_PUBLIC_OLLAMA_URL || 'http://localhost:11434';
const LOCAL_LLM_API = (process.env.NEXT_PUBLIC_LOCAL_LLM_API || 'ollama').toLowerCase();

export type LocalToolCall = {
  id?: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
};

export type LocalChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LocalToolCall[];
  name?: string;
};

export interface OllamaChatRequest {
  model: string;
  messages: LocalChatMessage[];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
  temperature?: number;
  topP?: number;
  topK?: number;
  numPredict?: number;
  stop?: string[];
  signal?: AbortSignal;
  /** When provided, enables streaming mode.  Called with each token chunk as
   *  it arrives from the model.  The final assembled content is still returned
   *  from the `ollamaChat` promise. */
  onToken?: (token: string) => void;
}

export interface OllamaChatResponse {
  message: LocalChatMessage;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

type OpenAIChatToolCall = {
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAIChatMessage = {
  role?: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIChatToolCall[];
};

function toOpenAIMessage(message: LocalChatMessage): Record<string, unknown> {
  // Some OpenAI-compatible servers are strict about tool message shape.
  if (message.role === 'tool') {
    return {
      role: 'assistant',
      content: message.content || '',
    };
  }

  return {
    role: message.role,
    content: message.content,
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.name ? { name: message.name } : {}),
  };
}

function fromOpenAIMessage(message: OpenAIChatMessage | undefined): LocalChatMessage {
  return {
    role: message?.role === 'tool' ? 'tool' : (message?.role || 'assistant'),
    content: message?.content ?? '',
    ...(message?.tool_calls
      ? {
          tool_calls: message.tool_calls
            .map((tc) => {
              const name = tc.function?.name;
              if (!name) return null;
              return {
                id: tc.id,
                type: 'function' as const,
                function: {
                  name,
                  arguments: tc.function?.arguments || '{}',
                },
              };
            })
            .filter(Boolean) as LocalToolCall[],
        }
      : {}),
  };
}

async function openAICompatibleChat(req: OllamaChatRequest): Promise<OllamaChatResponse> {
  const wantStream = typeof req.onToken === 'function';
  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: req.signal,
    body: JSON.stringify({
      model: req.model,
      messages: req.messages.map(toOpenAIMessage),
      tools: req.tools,
      stream: wantStream,
      temperature: req.temperature ?? 0.3,
      top_p: req.topP,
      max_tokens: req.numPredict ?? 2048,
      ...(req.stop ? { stop: req.stop } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI-compatible local LLM error (${res.status}): ${err}`);
  }

  if (!wantStream) {
    const data = (await res.json()) as {
      choices?: Array<{
        message?: OpenAIChatMessage;
      }>;
      usage?: {
        completion_tokens?: number;
      };
    };
    const message = fromOpenAIMessage(data.choices?.[0]?.message);
    return {
      message,
      done: true,
      eval_count: data.usage?.completion_tokens,
    };
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('OpenAI-compatible streaming: no response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!rawLine.startsWith('data:')) continue;
      const line = rawLine.slice(5).trim();
      if (!line || line === '[DONE]') continue;
      try {
        const chunk = JSON.parse(line) as {
          choices?: Array<{
            delta?: {
              content?: string;
            };
          }>;
        };
        const token = chunk.choices?.[0]?.delta?.content || '';
        if (token) {
          fullContent += token;
          req.onToken!(token);
        }
      } catch {
        // Skip malformed lines.
      }
    }
  }

  return {
    message: { role: 'assistant', content: fullContent },
    done: true,
  };
}

export async function ollamaChat(req: OllamaChatRequest): Promise<OllamaChatResponse> {
  if (LOCAL_LLM_API === 'openai') {
    return openAICompatibleChat(req);
  }

  const wantStream = typeof req.onToken === 'function';
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: req.signal,
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      stream: wantStream,
      options: {
        temperature: req.temperature ?? 0.3,
        top_p: req.topP,
        top_k: req.topK,
        num_predict: req.numPredict ?? 2048,
        ...(req.stop ? { stop: req.stop } : {}),
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error (${res.status}): ${err}`);
  }

  if (!wantStream) {
    return (await res.json()) as OllamaChatResponse;
  }

  // Streaming mode: read NDJSON lines, call onToken for each chunk,
  // accumulate content, and return the final assembled response.
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Ollama streaming: no response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let lastChunk: OllamaChatResponse | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete NDJSON lines.
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line) as OllamaChatResponse;
        const token = chunk.message?.content || '';
        if (token) {
          fullContent += token;
          req.onToken!(token);
        }
        if (chunk.done) {
          lastChunk = chunk;
        }
      } catch {
        // Skip malformed lines.
      }
    }
  }

  // Assemble final response matching the non-streaming shape.
  return {
    message: { role: 'assistant', content: fullContent },
    done: true,
    total_duration: lastChunk?.total_duration,
    eval_count: lastChunk?.eval_count,
  };
}

export async function listOllamaModels(): Promise<string[]> {
  try {
    if (LOCAL_LLM_API === 'openai') {
      const res = await fetch(`${OLLAMA_BASE}/v1/models`);
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      return (data.data || []).map((m) => m.id || '').filter(Boolean);
    }

    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models || []).map((m) => m.name || '').filter(Boolean);
  } catch {
    return [];
  }
}

export async function isOllamaAvailable(model: string): Promise<boolean> {
  const models = await listOllamaModels();
  return models.some((name) => name.startsWith(model));
}

