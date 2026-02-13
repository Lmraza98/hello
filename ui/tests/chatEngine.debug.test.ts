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
import * as ollamaStatusModule from '../src/chat/ollamaStatus';
import * as intentFastPathModule from '../src/chat/intentFastPath';
import * as toolExecutorModule from '../src/chat/toolExecutor';

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

  it('computes local history once per request', async () => {
    const localHistorySpy = vi.spyOn(ollamaStatusModule, 'toLocalHistory');
    await processMessage('hello', {
      forceModel: 'openai',
      debug: true,
    });
    expect(localHistorySpy).toHaveBeenCalledTimes(1);
  });

  it('computes selected tools once when debug fast path needs them', async () => {
    const selectToolsSpy = vi.spyOn(intentFastPathModule, 'selectToolsForIntent');
    const fastPathSpy = vi.spyOn(intentFastPathModule, 'detectFastPathPlan').mockReturnValue({
      reason: 'test_fast_path',
      calls: [{ name: 'search_contacts', args: { name: 'Randy Peterson' } }],
    });
    await processMessage('find Randy Peterson', {
      debug: true,
      requireToolConfirmation: true,
      phase: 'planning',
    });
    expect(selectToolsSpy).toHaveBeenCalledTimes(1);
    expect(fastPathSpy).toHaveBeenCalledTimes(1);
  });

  it('adds debug trace for browser follow-up fast-path confirmation', async () => {
    vi.spyOn(intentFastPathModule, 'detectFastPathPlan').mockReturnValue({
      reason: 'test_browser_followup',
      calls: [{ name: 'browser_health', args: {} }],
    });

    const result = await processMessage('click on Zco in sales navigator', {
      debug: true,
      requireToolConfirmation: true,
      conversationHistory: [
        { role: 'assistant', content: 'I completed the browser navigation and kept the session open.' },
      ],
    });

    expect(result.confirmation?.required).toBe(true);
    expect(result.debugTrace).toBeDefined();
    expect(result.debugTrace?.routeReason).toBe('fast_path_browser_followup');
    expect(typeof result.debugTrace?.timings?.totalMs).toBe('number');
  });

  it('enforces grounding failure when hybrid_search has no source refs', async () => {
    vi.spyOn(intentFastPathModule, 'detectFastPathPlan').mockReturnValue({
      reason: 'test_hybrid_no_refs',
      calls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 5 } }],
    });
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza' },
          ok: true,
          result: { results: [{ entity_type: 'contact', entity_id: '1', title: 'Lucas Raza', snippet: 'test', source_refs: [] }] },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Find Lucas Raza', {
      requireToolConfirmation: false,
      phase: 'planning',
    });

    expect(result.response).toContain('cannot verify');
  });

  it('allows grounded hybrid_search responses when source refs exist', async () => {
    vi.spyOn(intentFastPathModule, 'detectFastPathPlan').mockReturnValue({
      reason: 'test_hybrid_with_refs',
      calls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 5 } }],
    });
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza' },
          ok: true,
          result: {
            results: [
              {
                entity_type: 'contact',
                entity_id: '1',
                title: 'Lucas Raza',
                snippet: 'test',
                source_refs: [{ row_id: 1, table: 'linkedin_contacts' }],
              },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Find Lucas Raza', {
      requireToolConfirmation: false,
      phase: 'planning',
    });

    expect(result.response).toContain('Executed hybrid_search');
  });
});
