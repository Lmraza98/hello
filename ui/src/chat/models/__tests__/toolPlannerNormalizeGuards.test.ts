import { describe, expect, test } from 'vitest';

import { normalizePlannedCalls } from '../toolPlanner/normalize';

describe('toolPlanner normalize guards', () => {
  test('rewrites generic resolve_entity role lookup to constrained hybrid_search', () => {
    const normalized = normalizePlannedCalls(
      [
        {
          name: 'resolve_entity',
          args: {
            name_or_identifier: 'Head of Marketing',
            entity_types: ['person'],
          },
        },
      ],
      'Identify the Head of Marketing for each company found in s1\nTop entities: Schneider Electric | Legrand',
      []
    );

    expect(normalized.calls).toHaveLength(1);
    expect(normalized.calls[0]?.name).toBe('hybrid_search');
    expect(normalized.calls[0]?.args.entity_types).toEqual(['contact']);
    expect(String(normalized.calls[0]?.args.query || '')).toContain('Schneider Electric');
  });

  test('adds contact constraints to generic hybrid_search role lookup', () => {
    const normalized = normalizePlannedCalls(
      [
        {
          name: 'hybrid_search',
          args: {
            query: 'Head of Marketing',
          },
        },
      ],
      'Step context\nTop entities: CDM Smith | Tripp Lite',
      []
    );

    expect(normalized.calls).toHaveLength(1);
    expect(normalized.calls[0]?.name).toBe('hybrid_search');
    expect(normalized.calls[0]?.args.entity_types).toEqual(['contact']);
    expect(normalized.calls[0]?.args.k).toBe(10);
    expect(String(normalized.calls[0]?.args.query || '')).toContain('CDM Smith');
  });

  test('drops get_contact calls without a finite numeric contact_id', () => {
    const normalized = normalizePlannedCalls(
      [
        {
          name: 'get_contact',
          args: {
            name: 'Lucas Raza',
            contact_id: null,
          },
        },
      ],
      'send an email to Lucas Raza',
      []
    );

    expect(normalized.calls).toHaveLength(0);
  });

  test('rewrites explicit google intent from hybrid_search to google_search_browser', () => {
    const normalized = normalizePlannedCalls(
      [
        {
          name: 'hybrid_search',
          args: {
            query: 'google companies in new hampshire',
            k: 12,
          },
        },
      ],
      'google companies in new hampshire',
      []
    );

    expect(normalized.calls).toHaveLength(1);
    expect(normalized.calls[0]?.name).toBe('google_search_browser');
    expect(normalized.calls[0]?.args.query).toBe('companies in new hampshire');
    expect(normalized.calls[0]?.args.max_results).toBe(12);
  });
});
