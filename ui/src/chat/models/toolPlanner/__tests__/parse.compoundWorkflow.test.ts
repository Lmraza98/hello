import { describe, expect, it } from 'vitest';

import { normalizeParsedPlan } from '../parse';

describe('normalizeParsedPlan compound workflow support', () => {
  it('converts top-level compound_workflow into compound_workflow_run tool call', () => {
    const parsed = normalizeParsedPlan({
      compound_workflow: {
        name: 'Test Workflow',
        phases: [],
      },
    });
    expect(parsed.toolCalls.length).toBe(1);
    expect(parsed.toolCalls[0]?.name).toBe('compound_workflow_run');
    expect((parsed.toolCalls[0]?.args as Record<string, unknown>)?.spec).toBeTruthy();
  });
});
