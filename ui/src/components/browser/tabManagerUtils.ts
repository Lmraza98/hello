import type { TabGroupBy, TabSortBy, WorkbenchTab } from './types';

const STATUS_WEIGHT: Record<WorkbenchTab['status'], number> = {
  running: 0,
  error: 1,
  blocked: 2,
  active: 3,
  idle: 4,
};

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const trimmed = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return trimmed || '/';
}

export function canonicalizeUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const params = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const search = params.length
      ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
      : '';
    return `${parsed.origin}${normalizePath(parsed.pathname)}${search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function filterTabsByQuery(tabs: WorkbenchTab[], query: string): WorkbenchTab[] {
  const q = query.trim().toLowerCase();
  if (!q) return tabs;
  return tabs.filter((tab) => (
    tab.title.toLowerCase().includes(q)
    || tab.domain.toLowerCase().includes(q)
    || tab.url.toLowerCase().includes(q)
  ));
}

function compareRecent(a: WorkbenchTab, b: WorkbenchTab): number {
  return (b.lastUpdatedAt || b.lastUsedAt || 0) - (a.lastUpdatedAt || a.lastUsedAt || 0);
}

function compareDomain(a: WorkbenchTab, b: WorkbenchTab): number {
  const domainCmp = a.domain.localeCompare(b.domain);
  if (domainCmp !== 0) return domainCmp;
  return a.title.localeCompare(b.title);
}

function compareStatus(a: WorkbenchTab, b: WorkbenchTab): number {
  const statusCmp = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
  if (statusCmp !== 0) return statusCmp;
  return compareRecent(a, b);
}

export function sortTabs(tabs: WorkbenchTab[], sortBy: TabSortBy): WorkbenchTab[] {
  const cloned = [...tabs];
  if (sortBy === 'domain') return cloned.sort(compareDomain);
  if (sortBy === 'status') return cloned.sort(compareStatus);
  return cloned.sort(compareRecent);
}

export function orderTabsForDisplay(tabs: WorkbenchTab[], sortBy: TabSortBy): WorkbenchTab[] {
  const pinned = tabs.filter((tab) => tab.isPinned);
  const regular = tabs.filter((tab) => !tab.isPinned);
  return [...sortTabs(pinned, sortBy), ...sortTabs(regular, sortBy)];
}

export function groupTabsByDomain(tabs: WorkbenchTab[]): Record<string, WorkbenchTab[]> {
  const groups: Record<string, WorkbenchTab[]> = {};
  for (const tab of tabs) {
    const key = tab.domain || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(tab);
  }
  return groups;
}

export function defaultGroupByForCount(tabCount: number): TabGroupBy {
  return tabCount > 8 ? 'domain' : 'none';
}

export function getIdleTabIds(
  tabs: WorkbenchTab[],
  options: { nowMs: number; idleMinutes: number; selectedTabId?: string | null },
): string[] {
  const threshold = options.idleMinutes * 60 * 1000;
  return tabs
    .filter((tab) => (
      !tab.isPinned
      && !tab.isActive
      && tab.id !== options.selectedTabId
      && (options.nowMs - tab.lastUsedAt) > threshold
    ))
    .map((tab) => tab.id);
}

export function getErrorTabIds(tabs: WorkbenchTab[]): string[] {
  return tabs
    .filter((tab) => tab.status === 'error' || !!tab.lastError)
    .map((tab) => tab.id);
}

export function getDuplicateTabIds(tabs: WorkbenchTab[]): string[] {
  const byCanonical = new Map<string, WorkbenchTab[]>();
  for (const tab of tabs) {
    const key = canonicalizeUrl(tab.url);
    if (!key) continue;
    const prev = byCanonical.get(key) || [];
    prev.push(tab);
    byCanonical.set(key, prev);
  }

  const duplicateIds: string[] = [];
  for (const group of byCanonical.values()) {
    if (group.length < 2) continue;
    const ordered = orderTabsForDisplay(group, 'recent');
    ordered.slice(1).forEach((tab) => duplicateIds.push(tab.id));
  }
  return duplicateIds;
}

