import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/chat/fallbackPipeline', () => ({
  runWithFallback: vi.fn().mockResolvedValue({
    response: 'fallback response',
    messages: [],
    modelUsed: 'openai',
    toolsUsed: [],
    fallbackUsed: false,
    success: true,
    switches: [],
  }),
}));

import { processMessage } from '../src/chat/chatEngine';

describe('processMessage debug gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not build debugTrace by default', async () => {
    const result = await processMessage('hello', {
      forceModel: 'openai',
    });
    expect(result.debugTrace).toBeUndefined();
  });

  it('does not build debugTrace when planner callback is present but debug is false', async () => {
    const plannerEvent = vi.fn();
    const result = await processMessage('hello', {
      forceModel: 'openai',
      debug: false,
      onPlannerEvent: plannerEvent,
    });
    expect(result.debugTrace).toBeUndefined();
    expect(plannerEvent).toHaveBeenCalled();
  });

  it('builds debugTrace with timings and size metrics when debug is true', async () => {
    const result = await processMessage('hello', {
      forceModel: 'openai',
      debug: true,
      conversationHistory: [
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' },
      ],
    });

    expect(result.debugTrace).toBeDefined();
    expect(result.debugTrace?.timings).toBeDefined();
    expect(typeof result.debugTrace?.timings?.totalMs).toBe('number');
    expect(result.debugTrace?.sizes).toBeDefined();
    expect((result.debugTrace?.sizes?.historyChars || 0) > 0).toBe(true);
    expect((result.debugTrace?.sizes?.promptChars || 0) > 0).toBe(true);
  });
});
