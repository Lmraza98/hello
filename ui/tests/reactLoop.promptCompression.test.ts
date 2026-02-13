import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runToolPlanMock, dispatchToolCallsMock } = vi.hoisted(() => ({
  runToolPlanMock: vi.fn(),
  dispatchToolCallsMock: vi.fn(),
}));

vi.mock('../src/chat/models/toolPlanner', () => ({
  runToolPlan: runToolPlanMock,
}));

vi.mock('../src/chat/toolExecutor', () => ({
  dispatchToolCalls: dispatchToolCallsMock,
}));

vi.mock('../src/chat/intentFastPath', () => ({
  selectToolsForIntent: vi.fn(() => Array.from({ length: 30 }, (_, i) => `tool_${i + 1}`)),
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
    expect(prompt).toContain('State summary:');
    expect(prompt).not.toContain('Key findings:');
    expect(prompt).not.toContain('old step 1');
    expect(prompt).not.toContain('old step 2');
    expect(prompt).toContain('old step 4');
    expect(prompt).toContain('Executing user-confirmed actions.');
    expect(prompt).toContain('tool_1');
    expect(prompt).toContain('tool_20');
    expect(prompt).not.toContain('tool_30');
    expect(prompt.length).toBeLessThan(6000);
  });
});
