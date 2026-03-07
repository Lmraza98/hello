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

  test('rewrites implied salesnav employee lookup browser loop to browser_search_and_extract', () => {
    const normalized = normalizePlannedCalls(
      [
        { name: 'browser_health', args: {} },
        { name: 'browser_tabs', args: {} },
        { name: 'browser_navigate', args: { url: 'https://www.linkedin.com/sales/search/people' } },
        { name: 'browser_find_ref', args: { text: 'Search', role: 'combobox' } },
        { name: 'browser_act', args: { ref: '$prev.ref', action: 'type', value: 'find contact details for employees of Zco Corporation' } },
      ],
      'find contact details for employees of Zco Corporation',
      ['browser_search_and_extract', 'browser_navigate', 'browser_act']
    );

    expect(normalized.calls).toHaveLength(3);
    expect(normalized.calls[0]?.name).toBe('browser_health');
    expect(normalized.calls[1]?.name).toBe('browser_tabs');
    expect(normalized.calls[2]?.name).toBe('browser_search_and_extract');
    expect(normalized.calls[2]?.args.task).toBe('salesnav_people_search');
  });

  test('rewrites explicit salesnav employee lookup to a single browser_list_sub_items call', () => {
    const normalized = normalizePlannedCalls(
      [
        {
          name: 'browser_search_and_extract',
          args: { task: 'salesnav_search_account', query: 'Zco Corporation', limit: 25 },
        },
        {
          name: 'browser_list_sub_items',
          args: {
            task: 'salesnav_list_employees',
            parent_query: 'Zco Corporation',
            parent_task: 'salesnav_search_account',
            limit: 25,
          },
        },
      ],
      'find contact details for employees of Zco Corporation on SalesNavigator',
      ['browser_search_and_extract', 'browser_list_sub_items']
    );

    expect(normalized.calls).toHaveLength(1);
    expect(normalized.calls[0]?.name).toBe('browser_list_sub_items');
    expect(normalized.calls[0]?.args.parent_query).toBe('Zco Corporation');
    expect(normalized.calls[0]?.args.parent_task).toBe('salesnav_search_account');
  });

  test('asks for clarification on vague salesnav employee details requests', () => {
    const normalized = normalizePlannedCalls(
      [
        {
          name: 'browser_list_sub_items',
          args: {
            task: 'salesnav_list_employees',
            parent_query: 'Zco Corporation',
            parent_task: 'salesnav_search_account',
            limit: 25,
          },
        },
      ],
      'find contact details for employees of Zco Corporation on SalesNavigator',
      ['browser_list_sub_items']
    );

    expect(normalized.calls).toEqual([]);
    expect(normalized.clarificationQuestion).toContain('How many contacts');
    expect(normalized.clarificationQuestion).toContain('LinkedIn URL');
  });
});
