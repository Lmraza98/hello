import { describe, expect, it } from 'vitest';
import { normalizePlannedCalls } from '../normalize';

describe('normalizePlannedCalls compound workflow people-query normalization', () => {
  it('reduces salesnav_people_search query to a single keyword token', () => {
    const calls = [
      {
        name: 'compound_workflow_run',
        args: {
          spec: {
            name: 'test',
            phases: [
              {
                id: 'phase_2_find_vp_ops',
                operation: { tool: 'browser_search_and_extract', task: 'salesnav_people_search' },
                param_templates: {
                  query: 'VP of Operations Industrial Air Centers',
                  filters: { function: 'Operations' },
                },
              },
            ],
          },
        },
      },
    ];

    const out = normalizePlannedCalls(calls as any, 'find leads', ['compound_workflow_run']);
    const normalized = out.calls[0]?.args?.spec as Record<string, unknown>;
    const phases = Array.isArray(normalized?.phases) ? (normalized.phases as Array<Record<string, unknown>>) : [];
    const phase = phases[0] || {};
    const templates =
      phase.param_templates && typeof phase.param_templates === 'object'
        ? (phase.param_templates as Record<string, unknown>)
        : {};
    expect(templates.query).toBe('VP');
  });
});
