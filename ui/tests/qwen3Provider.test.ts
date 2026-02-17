import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/chat/models/toolPlanner', () => ({
  runToolPlan: vi.fn(),
}));

import { runToolPlan } from '../src/chat/models/toolPlanner';
import { runQwen3Plan } from '../src/chat/models/qwen3Provider';

describe('runQwen3Plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to runToolPlan with the same inputs', async () => {
    const expected = {
      success: true,
      plannedCalls: [{ name: 'search_contacts', args: { name: 'Randy Peterson' } }],
      selectedTools: ['search_contacts'],
      rawContent: '[]',
      planRationale: [],
      constraintWarnings: [],
    };
    vi.mocked(runToolPlan).mockResolvedValue(expected);

    const onProgress = vi.fn();
    const history = [{ role: 'user', content: 'Find Randy Peterson' }] as const;
    const result = await runQwen3Plan('Find Randy Peterson', [...history], onProgress);

    expect(vi.mocked(runToolPlan)).toHaveBeenCalledWith(
      'Find Randy Peterson',
      [...history],
      onProgress
    );
    expect(result).toEqual(expected);
  });

  it('propagates planner failure result', async () => {
    const expected = {
      success: false,
      plannedCalls: [],
      selectedTools: ['hybrid_search'],
      rawContent: null,
      planRationale: [],
      constraintWarnings: [],
      failureReason: 'planner_request_error_or_timeout' as const,
    };
    vi.mocked(runToolPlan).mockResolvedValue(expected);

    const result = await runQwen3Plan('Find vet clinics in Vermont LinkedIn Sales Navigator', []);
    expect(result).toEqual(expected);
  });
});
