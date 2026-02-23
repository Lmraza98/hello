import { describe, expect, it, vi } from 'vitest';

const ollamaChatMock = vi.fn();

vi.mock('../src/chat/models/ollamaClient', () => ({
  ollamaChat: (...args: unknown[]) => ollamaChatMock(...args),
}));

import { classifyIntent } from '../src/chat/chatEngine/intentClassifier';

describe('classifyIntent', () => {
  it('classifies greetings as conversational without model calls', async () => {
    const result = await classifyIntent('Hello');
    expect(result).toBe('conversational');
    expect(ollamaChatMock).not.toHaveBeenCalled();
  });
});

