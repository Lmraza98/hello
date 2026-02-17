import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRegistry } from '../src/assistant-core/skills/registry';
import { registerBuiltinSkills } from '../src/assistant-core/skills/loader';
import { trySkillRoute, resumeSkillExecution } from '../src/assistant-core/router/recipeRouter';

const COMPLEX_REQUEST =
  'Find 5 companies in the Fintech space in New York City that have raised Series B funding in the last year. ' +
  'Then, find the Head of Marketing at each company and draft a personalized introductory email highlighting our [Specific Service] and schedule it to send 3 days from now.';

describe('deterministic prospecting skill flow', () => {
  beforeEach(() => {
    clearRegistry();
    registerBuiltinSkills();
  });

  it('routes complex request through skill and pauses on first write confirmation', async () => {
    const executeTool = vi.fn(async (name: string) => {
      if (name === 'browser_search_and_extract') {
        return { items: [{ id: 1, title: 'Sample' }] };
      }
      return { ok: true };
    });

    const result = await trySkillRoute(COMPLEX_REQUEST, {
      executeTool,
    });

    expect(result).not.toBeNull();
    expect(result?.handled).toBe(true);
    expect(result?.plan?.skillId).toBe('prospect-companies-and-draft-emails');
    expect(result?.executedCalls.map((c) => c.name)).toEqual([
      'browser_search_and_extract',
      'browser_search_and_extract',
    ]);
    expect(result?.pendingConfirmation?.plan.steps[result.pendingConfirmation.nextStepIndex]?.toolCall.name).toBe('create_campaign');
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it('resume continues and pauses again on the next write confirmation step', async () => {
    const executeTool = vi.fn(async (name: string) => {
      if (name === 'create_campaign') return { id: 101, name: 'Campaign' };
      if (name === 'enroll_contacts_by_filter') return { enrolled: 5, skipped: 0, total_matched: 5 };
      return { ok: true };
    });

    const first = await trySkillRoute(COMPLEX_REQUEST, {
      executeTool: async (name: string) => {
        if (name === 'browser_search_and_extract') return { items: [{ id: 1 }] };
        return { ok: true };
      },
    });

    expect(first?.pendingConfirmation).toBeDefined();
    const resumed = await resumeSkillExecution(first!.pendingConfirmation!, true, {
      executeTool,
    });

    expect(resumed.handled).toBe(true);
    expect(resumed.pendingConfirmation).toBeDefined();
    expect(resumed.pendingConfirmation?.plan.steps[resumed.pendingConfirmation.nextStepIndex]?.toolCall.name).toBe('enroll_contacts_by_filter');
  });
});
