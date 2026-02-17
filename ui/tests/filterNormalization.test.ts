import { describe, expect, it } from 'vitest';
import { normalizeToolArgs } from '../src/utils/filterNormalization';

describe('normalizeToolArgs', () => {
  it('preserves structured hybrid_search args (arrays and objects)', () => {
    const args = normalizeToolArgs('hybrid_search', {
      query: 'Lucas Raza',
      entity_types: ['contact', 'company'],
      filters: { domain: 'zco.com', scope: 'work-only' },
      k: 10,
    });

    expect(args).toEqual({
      query: 'Lucas Raza',
      entity_types: ['contact', 'company'],
      filters: { domain: 'zco.com', scope: 'work-only' },
      k: 10,
    });
  });

  it('keeps nested booleans/numbers for structured filters', () => {
    const args = normalizeToolArgs('hybrid_search', {
      query: 'oauth threads',
      filters: {
        time_range_days: 30,
        include_archived: false,
      },
    });

    expect(args).toEqual({
      query: 'oauth threads',
      filters: {
        time_range_days: 30,
        include_archived: false,
      },
    });
  });

  it('coerces hybrid_search entity_types string into list and parses k', () => {
    const args = normalizeToolArgs('hybrid_search', {
      query: 'Lucas Raza',
      entity_types: 'contact, company',
      k: '10',
    });

    expect(args).toEqual({
      query: 'Lucas Raza',
      entity_types: ['contact', 'company'],
      k: 10,
    });
  });

  it('maps resolve_entity query to name_or_identifier', () => {
    const args = normalizeToolArgs('resolve_entity', {
      query: 'Lucas Raza',
      entity_types: 'contact',
    });

    expect(args).toEqual({
      name_or_identifier: 'Lucas Raza',
      entity_types: ['contact'],
    });
  });
});
