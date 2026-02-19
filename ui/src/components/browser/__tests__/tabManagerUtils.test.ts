import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  defaultGroupByForCount,
  filterTabsByQuery,
  getDuplicateTabIds,
  getErrorTabIds,
  getIdleTabIds,
  orderTabsForDisplay,
} from '../tabManagerUtils';
import type { WorkbenchTab } from '../types';

const now = Date.now();

function makeTab(overrides: Partial<WorkbenchTab>): WorkbenchTab {
  return {
    id: overrides.id || 'tab-1',
    title: overrides.title || 'Tab',
    url: overrides.url || 'https://example.com',
    domain: overrides.domain || 'example.com',
    faviconUrl: null,
    status: overrides.status || 'idle',
    isActive: overrides.isActive ?? false,
    isPinned: overrides.isPinned ?? false,
    lastUsedAt: overrides.lastUsedAt ?? now,
    lastUpdatedAt: overrides.lastUpdatedAt ?? now,
    lastError: overrides.lastError ?? null,
    hasAnnotations: overrides.hasAnnotations ?? false,
    validationSummary: overrides.validationSummary ?? null,
    screenshotUrl: overrides.screenshotUrl ?? null,
  };
}

describe('tabManagerUtils', () => {
  it('filters tabs by title/domain/url', () => {
    const tabs = [
      makeTab({ id: '1', title: 'Weather radar', domain: 'weather.com', url: 'https://weather.com/radar' }),
      makeTab({ id: '2', title: 'GitHub', domain: 'github.com', url: 'https://github.com/openai' }),
    ];
    expect(filterTabsByQuery(tabs, 'weather').map((tab) => tab.id)).toEqual(['1']);
    expect(filterTabsByQuery(tabs, 'openai').map((tab) => tab.id)).toEqual(['2']);
  });

  it('puts pinned tabs first after sorting', () => {
    const tabs = [
      makeTab({ id: '1', title: 'B', lastUpdatedAt: now - 1_000 }),
      makeTab({ id: '2', title: 'A', isPinned: true, lastUpdatedAt: now - 10_000 }),
      makeTab({ id: '3', title: 'C', isPinned: true, lastUpdatedAt: now }),
    ];
    expect(orderTabsForDisplay(tabs, 'recent').map((tab) => tab.id)).toEqual(['3', '2', '1']);
  });

  it('finds idle tabs for bulk close', () => {
    const tabs = [
      makeTab({ id: '1', lastUsedAt: now - 40 * 60_000 }),
      makeTab({ id: '2', isPinned: true, lastUsedAt: now - 40 * 60_000 }),
      makeTab({ id: '3', isActive: true, lastUsedAt: now - 40 * 60_000 }),
    ];
    expect(getIdleTabIds(tabs, { nowMs: now, idleMinutes: 30, selectedTabId: '3' })).toEqual(['1']);
  });

  it('finds error tabs for bulk close', () => {
    const tabs = [
      makeTab({ id: '1', status: 'error' }),
      makeTab({ id: '2', status: 'idle', lastError: 'timeout' }),
      makeTab({ id: '3', status: 'active' }),
    ];
    expect(getErrorTabIds(tabs)).toEqual(['1', '2']);
  });

  it('finds duplicate canonical urls', () => {
    const tabs = [
      makeTab({ id: '1', url: 'https://example.com/a/?b=2&c=1', lastUpdatedAt: now }),
      makeTab({ id: '2', url: 'https://example.com/a?c=1&b=2', lastUpdatedAt: now - 10_000 }),
      makeTab({ id: '3', url: 'https://example.com/a?b=3' }),
    ];
    expect(getDuplicateTabIds(tabs)).toEqual(['2']);
  });

  it('canonicalizes URL consistently', () => {
    expect(canonicalizeUrl('https://example.com/path/?z=1&a=2#frag')).toBe('https://example.com/path?a=2&z=1');
    expect(canonicalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('defaults group-by mode based on count', () => {
    expect(defaultGroupByForCount(5)).toBe('none');
    expect(defaultGroupByForCount(10)).toBe('domain');
  });
});

