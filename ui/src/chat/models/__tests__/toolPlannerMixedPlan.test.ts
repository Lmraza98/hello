import { describe, expect, test } from 'vitest';

import { normalizeParsedPlan } from '../toolPlanner/parse';
import { getCapabilityPromptContext } from '../toolPlanner/capabilitiesContext';

describe('toolPlanner mixed plan parsing', () => {
  test('parses mixed ui_actions + tool_calls envelope', () => {
    const parsed = normalizeParsedPlan({
      ui_actions: [{ action: 'email.campaigns.navigate' }],
      tool_calls: [{ name: 'list_campaigns', args: {} }],
    });

    expect(parsed.uiActions).toHaveLength(1);
    expect((parsed.uiActions[0] as { action: string }).action).toBe('email.campaigns.navigate');
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].name).toBe('list_campaigns');
  });
});

describe('capabilities context relevance', () => {
  test('includes email campaigns actions for campaign-oriented query', () => {
    const ctx = getCapabilityPromptContext('show me my email campaigns on the page');
    expect(ctx.loaded).toBe(true);
    expect(ctx.block).toContain('Email Campaigns');
    expect(ctx.block).toContain('email.campaigns.navigate');
  });
});
