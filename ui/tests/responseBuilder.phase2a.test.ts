import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPlanSummary } from '../src/chat/chatEnginePolicy';
import type { PipelineContext } from '../src/chat/chatEngine/pipelineTypes';

const mocks = vi.hoisted(() => ({
  dispatchToolCalls: vi.fn(),
  synthesizeAnswer: vi.fn(),
  formatDispatchMessages: vi.fn(),
}));

vi.mock('../src/chat/toolExecutor', () => ({
  dispatchToolCalls: mocks.dispatchToolCalls,
}));

vi.mock('../src/chat/chatSynthesis', () => ({
  synthesizeAnswer: mocks.synthesizeAnswer,
}));

vi.mock('../src/chat/dispatchFormatter', () => ({
  formatDispatchMessages: mocks.formatDispatchMessages,
}));

import { buildDispatchBackedResult, appendBrowserSessionNoteIfActive } from '../src/chat/chatEngine/responseBuilder';

function mkText(content: string) {
  return {
    id: `m-${Math.random()}`,
    type: 'text' as const,
    sender: 'bot' as const,
    content,
    timestamp: new Date(),
  };
}

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const base: PipelineContext = {
    userMessage: 'raw user',
    history: [{ role: 'assistant', content: 'prior assistant' }],
    localHistory: [],
    phase: 'planning',
    options: { requireToolConfirmation: false },
    sessionState: undefined,
    intentText: 'intent text',
    pageContext: null,
    normalizedMessage: 'normalized message',
    includeDebugTrace: true,
    includeHeavyDebug: false,
    timings: { totalMs: 0 },
    plannerHistory: [] as any,
    reactConfig: {} as any,
    meta: {
      rawUserMessage: 'raw user',
      intentText: 'intent text',
      pageContext: null,
    },
    getSelectedToolsForMessage: () => ['tool_a'],
  };
  return { ...base, ...overrides };
}

describe('buildDispatchBackedResult (Phase 2A golden)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formatDispatchMessages.mockImplementation(() => []);
    mocks.synthesizeAnswer.mockResolvedValue({
      response: 'SYNTH',
      modelUsed: 'qwen3',
      promptChars: 111,
      synthesized: true,
    });
  });

  it('confirmation gate: returns confirmation prompt and skips dispatch', async () => {
    const ctx = makeCtx({
      options: { requireToolConfirmation: true },
      plannerMessage: 'historyUserMessage',
      userMessage: 'raw gate user',
      normalizedMessage: 'normalized gate',
      resolvedMessage: undefined,
      pageContext: 'gate page',
      getSelectedToolsForMessage: () => ['send_email'],
    });
    const calls = [{ name: 'send_email', args: { to: 'x@y.com' } }];

    const result = await buildDispatchBackedResult({
      ctx,
      calls,
      routeReason: 'golden_confirmation',
      allowSkipSynthesis: true,
    });

    expect(result.response).toBe('');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.type).toBe('text');
    expect(result.messages[0]?.content).toBe('Fast plan ready for confirmation.');
    expect(result.confirmation?.required).toBe(true);
    expect(result.confirmation?.summary).toBe(buildPlanSummary(calls));
    expect(result.updatedHistory[result.updatedHistory.length - 1]).toEqual({ role: 'user', content: 'historyUserMessage' });
    expect(result.updatedHistory.some((m) => m.role === 'assistant' && m.content === 'Fast plan ready for confirmation.')).toBe(false);
    expect(mocks.dispatchToolCalls).not.toHaveBeenCalled();

    expect(result.debugTrace?.success).toBe(true);
    expect(result.debugTrace?.tokenToolCalls).toBe(0);
    expect(result.debugTrace?.toolsUsed).toEqual([]);
    expect(result.debugTrace?.phase).toBe(ctx.phase);
    expect(result.debugTrace?.rawUserMessage).toBe(ctx.userMessage);
    expect(result.debugTrace?.intentText).toBe(ctx.normalizedMessage);
  });

  it('dispatch path: skips synthesis and dedupes duplicate summary text', async () => {
    const summary = 'Found 1 matching contact: Alice';
    const ctx = makeCtx({
      options: { requireToolConfirmation: false },
      phase: 'executing',
    });
    const calls = [{ name: 'search_contacts', args: { name: 'Alice' } }];

    mocks.dispatchToolCalls.mockResolvedValue({
      success: true,
      toolsUsed: ['search_contacts'],
      executed: [
        {
          name: 'search_contacts',
          args: { name: 'Alice' },
          ok: true,
          result: [{ id: 1, name: 'Alice' }],
          durationMs: 12,
        },
      ],
      summary,
    });
    mocks.formatDispatchMessages.mockImplementation((dispatched: { summary: string }) => [mkText(dispatched.summary)]);

    const result = await buildDispatchBackedResult({
      ctx,
      calls,
      routeReason: 'golden_skip_synthesis',
      allowSkipSynthesis: true,
    });

    expect(mocks.synthesizeAnswer).not.toHaveBeenCalled();
    const textMessages = result.messages.filter((m) => m.type === 'text');
    expect(textMessages).toHaveLength(1);
    expect(textMessages[0]?.content).toBe(summary);
    expect(result.updatedHistory[result.updatedHistory.length - 1]).toEqual({ role: 'assistant', content: result.response });

    expect(result.debugTrace?.tokenToolCalls).toBe(1);
    expect(result.debugTrace?.executedCalls?.[0]?.durationMs).toBe(12);
    expect(result.debugTrace?.synthesized).toBe(false);
    expect(result.debugTrace?.synthesisPromptChars).toBe(0);
  });

  it('dispatch path: applies metaOverride + phaseOverride + postProcessAssistantText', async () => {
    const ctx = makeCtx({
      options: { requireToolConfirmation: false },
      phase: 'planning',
      meta: {
        rawUserMessage: 'raw-original',
        intentText: 'intent-original',
        pageContext: 'page-original',
      },
    });
    const calls = [
      { name: 'browser_health', args: {} },
      { name: 'search_contacts', args: { name: 'Alice' } },
    ];

    mocks.dispatchToolCalls.mockResolvedValue({
      success: true,
      toolsUsed: ['browser_health', 'search_contacts'],
      executed: [
        {
          name: 'browser_health',
          args: {},
          ok: true,
          result: { tab_id: 'tab-123' },
          durationMs: 10,
        },
        {
          name: 'search_contacts',
          args: { name: 'Alice' },
          ok: true,
          result: [{ id: 1, name: 'Alice' }],
          durationMs: 11,
        },
      ],
      summary: 'Executed actions.',
    });
    mocks.synthesizeAnswer.mockResolvedValue({
      response: 'SYNTH',
      modelUsed: 'qwen3',
      promptChars: 123,
      synthesized: true,
    });

    const result = await buildDispatchBackedResult({
      ctx,
      calls,
      routeReason: 'golden_override',
      allowSkipSynthesis: true,
      metaOverride: {
        rawUserMessage: 'overrideRaw',
        intentText: 'overrideIntent',
        pageContext: 'overrideCtx',
      },
      phaseOverride: 'executing',
      postProcessAssistantText: (assistantText, dispatched) => appendBrowserSessionNoteIfActive(dispatched, assistantText),
    });

    expect(mocks.synthesizeAnswer).toHaveBeenCalled();
    const synthesisInput = mocks.synthesizeAnswer.mock.calls[0]?.[0];
    expect(synthesisInput.userMessage).toBe('overrideRaw');
    expect(synthesisInput.normalizedMessage).toBe('overrideIntent');
    expect(synthesisInput.intentText).toBe('overrideIntent');
    expect(synthesisInput.pageContext).toBe('overrideCtx');

    const firstText = result.messages.find((m) => m.type === 'text');
    expect(firstText?.content).toContain('SYNTH');
    expect(firstText?.content.endsWith('Browser session is still open.')).toBe(true);

    expect(result.debugTrace?.phase).toBe('executing');
    expect(result.debugTrace?.rawUserMessage).toBe('overrideRaw');
    expect(result.debugTrace?.intentText).toBe('overrideIntent');
    expect(result.debugTrace?.pageContext).toBe('overrideCtx');

    expect(result.sessionState?.browser?.tabId).toBe('tab-123');
  });
});
