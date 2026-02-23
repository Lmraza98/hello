import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/chat/models/gemmaProvider', () => ({
  runGemma: vi.fn().mockResolvedValue({
    response: '',
    messages: [],
    toolsUsed: [],
    success: false,
  }),
}));

vi.mock('../src/chat/models/deepseekProvider', () => ({
  runDeepseek: vi.fn().mockResolvedValue({
    response: '',
    messages: [],
    toolsUsed: [],
    success: false,
  }),
}));

vi.mock('../src/chat/models/openaiProvider', () => ({
  runOpenAI: vi.fn().mockResolvedValue({
    response: '',
    messages: [],
    toolsUsed: [],
    success: false,
  }),
}));

import { runWithFallback } from '../src/chat/fallbackPipeline';

describe('runWithFallback offline responses', () => {
  it('returns a greeting when local models are unavailable', async () => {
    const result = await runWithFallback('gemma', 'Hello', [], []);
    expect(result.response).toContain('Hi.');
    expect(result.response.toLowerCase()).toContain('limited mode');
    expect(result.success).toBe(true);
    expect(result.fallbackUsed).toBe(true);
  });

  it('returns a deterministic limited-mode message for non-greeting input', async () => {
    const result = await runWithFallback('deepseek', 'find contacts in healthcare', [], []);
    expect(result.response.toLowerCase()).toContain('deterministic action');
    expect(result.response.toLowerCase()).toContain('local language models are unavailable');
    expect(result.success).toBe(true);
    expect(result.fallbackUsed).toBe(true);
  });
});

