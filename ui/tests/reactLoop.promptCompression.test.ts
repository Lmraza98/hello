import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runToolPlanMock, dispatchToolCallsMock } = vi.hoisted(() => ({
  runToolPlanMock: vi.fn(),
  dispatchToolCallsMock: vi.fn(),
}));

vi.mock('../src/chat/models/toolPlanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/chat/models/toolPlanner')>();
  return {
    ...actual,
    runToolPlan: runToolPlanMock,
  };
});

vi.mock('../src/chat/toolExecutor', () => ({
  dispatchToolCalls: dispatchToolCallsMock,
}));

import { resumeReActLoop, type ReActStep } from '../src/chat/reactLoop';

describe('reactLoop prompt compression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchToolCallsMock.mockResolvedValue({
      success: true,
      toolsUsed: [],
      executed: [],
      summary: 'ok',
    });
    runToolPlanMock.mockResolvedValue({
      success: true,
      plannedCalls: [],
      planRationale: [],
    });
  });

  it('sends a bounded prompt with only recent steps and limited tool list', async () => {
    const previousTrace: ReActStep[] = [
      { thought: 'old step 1', actions: [{ name: 'a1', args: {} }], observations: [], reflection: '' },
      { thought: 'old step 2', actions: [{ name: 'a2', args: {} }], observations: [], reflection: '' },
      { thought: 'old step 3', actions: [{ name: 'a3', args: {} }], observations: [], reflection: '' },
      { thought: 'old step 4', actions: [{ name: 'a4', args: {} }], observations: [], reflection: '' },
    ];

    const localHistory = [
      { role: 'user' as const, content: 'x'.repeat(2000) },
      { role: 'assistant' as const, content: 'y'.repeat(2000) },
    ];

    await resumeReActLoop(
      'find people at zco',
      [],
      previousTrace,
      localHistory,
      { maxIterations: 2, maxToolCalls: 3 }
    );

    const prompt = String(runToolPlanMock.mock.calls[0]?.[0] || '');
    const allowedTools = (runToolPlanMock.mock.calls[0]?.[3] as string[] | undefined) || [];
    expect(prompt).toContain('State summary:');
    expect(prompt).not.toContain('Key findings:');
    expect(prompt).not.toContain('old step 1');
    expect(prompt).not.toContain('old step 2');
    expect(prompt).toContain('old step 4');
    expect(prompt).toContain('Executing user-confirmed actions.');
    expect(prompt).toContain('Allowed tools for this request:');
    expect(allowedTools.length).toBeGreaterThan(0);
    expect(allowedTools.length).toBeLessThanOrEqual(12);
    expect(prompt.length).toBeLessThan(6000);
  });
});
