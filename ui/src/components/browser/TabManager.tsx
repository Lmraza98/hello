import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react';
import { TabGrid } from './TabGrid';
import { TabRow } from './TabRow';
import {
  defaultGroupByForCount,
  filterTabsByQuery,
  getDuplicateTabIds,
  getErrorTabIds,
  getIdleTabIds,
  groupTabsByDomain,
  orderTabsForDisplay,
} from './tabManagerUtils';
import type { TabGroupBy, TabSortBy, TabViewMode, WorkbenchTab, WorkflowActionType } from './types';

type TabManagerProps = {
  tabs: WorkbenchTab[];
  selectedTabId: string | null;
  expandedTabIds: Set<string>;
  runningActionByTab: Record<string, string | null>;
  onSelectTab: (tabId: string) => void;
  onToggleExpanded: (tabId: string) => void;
  onPinTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseTabs: (tabIds: string[]) => void;
  onSetExpandedTabIds: (next: Set<string>) => void;
  onTriggerWorkflowAction: (tabId: string, action: WorkflowActionType) => void;
};

type ListRow = {
  kind: 'group' | 'tab';
  key: string;
  label?: string;
  count?: number;
  tab?: WorkbenchTab;
};

export function TabManager({
  tabs,
  selectedTabId,
  expandedTabIds,
  runningActionByTab,
  onSelectTab,
  onToggleExpanded,
  onPinTab,
  onCloseTab,
  onCloseTabs,
  onSetExpandedTabIds,
  onTriggerWorkflowAction,
}: TabManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<TabSortBy>('recent');
  const [groupBy, setGroupBy] = useState<TabGroupBy>(defaultGroupByForCount(tabs.length));
  const [groupByTouched, setGroupByTouched] = useState(false);
  const [viewMode, setViewMode] = useState<TabViewMode>('list');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (groupByTouched) return;
    setGroupBy(defaultGroupByForCount(tabs.length));
  }, [groupByTouched, tabs.length]);

  const filteredTabs = useMemo(() => {
    const base = filterTabsByQuery(tabs, searchQuery);
    return orderTabsForDisplay(base, sortBy);
  }, [tabs, searchQuery, sortBy]);

  const rows = useMemo<ListRow[]>(() => {
    if (groupBy === 'none') {
      return filteredTabs.map((tab) => ({ kind: 'tab', key: tab.id, tab }));
    }
    const nextRows: ListRow[] = [];
    const pinnedTabs = filteredTabs.filter((tab) => tab.isPinned);
    const regularTabs = filteredTabs.filter((tab) => !tab.isPinned);
    if (pinnedTabs.length) {
      nextRows.push({ kind: 'group', key: 'group:pinned', label: 'Pinned', count: pinnedTabs.length });
      if (!collapsedGroups.has('Pinned')) {
        pinnedTabs.forEach((tab) => nextRows.push({ kind: 'tab', key: tab.id, tab }));
      }
    }
    const domainGroups = groupTabsByDomain(regularTabs);
    const domains = Object.keys(domainGroups).sort((a, b) => a.localeCompare(b));
    for (const domain of domains) {
      const tabsForDomain = domainGroups[domain] || [];
      nextRows.push({ kind: 'group', key: `group:${domain}`, label: domain, count: tabsForDomain.length });
      if (collapsedGroups.has(domain)) continue;
      tabsForDomain.forEach((tab) => nextRows.push({ kind: 'tab', key: tab.id, tab }));
    }
    return nextRows;
  }, [collapsedGroups, filteredTabs, groupBy]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = viewMode === 'list' && rows.length > 50 && expandedTabIds.size === 0;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'group' ? 30 : 56),
    overscan: 8,
    enabled: shouldVirtualize,
  });

  const idleCloseTargets = useMemo(
    () => getIdleTabIds(tabs, { nowMs: Date.now(), idleMinutes: 30, selectedTabId }),
    [selectedTabId, tabs],
  );
  const errorCloseTargets = useMemo(() => getErrorTabIds(tabs), [tabs]);
  const duplicateCloseTargets = useMemo(() => getDuplicateTabIds(tabs), [tabs]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-text">Tab Manager</div>
          <div className="rounded bg-bg px-2 py-0.5 text-[11px] text-text-dim">{tabs.length} tabs</div>
        </div>

        <div className="mb-2 flex items-center gap-1.5">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-text-dim" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, domain, url..."
              className="w-full rounded border border-border bg-bg py-1 pl-7 pr-2 text-xs text-text"
            />
          </label>
          <button
            type="button"
            onClick={() => setViewMode((prev) => (prev === 'list' ? 'grid' : 'list'))}
            className="rounded border border-border p-1.5 text-text-dim hover:bg-surface-hover"
            title={viewMode === 'list' ? 'Switch to thumbnail mode' : 'Switch to list mode'}
          >
            {viewMode === 'list' ? <LayoutGrid className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="mb-2 flex items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 text-text-dim">
            <SlidersHorizontal className="h-3 w-3" />
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as TabSortBy)}
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] text-text"
          >
            <option value="recent">Recent</option>
            <option value="domain">Domain</option>
            <option value="status">Status</option>
          </select>
          <select
            value={groupBy}
            onChange={(e) => {
              setGroupByTouched(true);
              setGroupBy(e.target.value as TabGroupBy);
            }}
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] text-text"
          >
            <option value="domain">Group: Domain</option>
            <option value="none">Group: None</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => onCloseTabs(idleCloseTargets)}
            className="rounded border border-border px-2 py-1 text-left text-text-dim hover:bg-surface-hover"
            title="Close not active, not pinned tabs idle over 30 minutes"
          >
            Close idle ({idleCloseTargets.length})
          </button>
          <button
            type="button"
            onClick={() => onCloseTabs(errorCloseTargets)}
            className="rounded border border-border px-2 py-1 text-left text-text-dim hover:bg-surface-hover"
          >
            Close errors ({errorCloseTargets.length})
          </button>
          <button
            type="button"
            onClick={() => onCloseTabs(duplicateCloseTargets)}
            className="rounded border border-border px-2 py-1 text-left text-text-dim hover:bg-surface-hover"
          >
            Close dupes ({duplicateCloseTargets.length})
          </button>
          <button
            type="button"
            onClick={() => {
              if (expandedTabIds.size) onSetExpandedTabIds(new Set());
              else onSetExpandedTabIds(new Set(filteredTabs.map((tab) => tab.id)));
            }}
            className="rounded border border-border px-2 py-1 text-left text-text-dim hover:bg-surface-hover"
          >
            {expandedTabIds.size ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-2">
        {viewMode === 'grid' ? (
          <TabGrid
            tabs={filteredTabs}
            selectedTabId={selectedTabId}
            onSelect={onSelectTab}
            onPin={onPinTab}
            onClose={onCloseTab}
          />
        ) : shouldVirtualize ? (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={row.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="pb-1.5"
                >
                  {row.kind === 'group' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const label = row.label || '';
                        if (!label) return;
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(label)) next.delete(label);
                          else next.add(label);
                          return next;
                        });
                      }}
                      className="w-full rounded border border-border/70 bg-bg px-2 py-1 text-left text-[11px] font-medium text-text-dim"
                    >
                      {row.label} ({row.count || 0})
                    </button>
                  ) : row.tab ? (
                    <TabRow
                      tab={row.tab}
                      expanded={expandedTabIds.has(row.tab.id)}
                      selected={selectedTabId === row.tab.id}
                      runningAction={runningActionByTab[row.tab.id]}
                      onSelect={onSelectTab}
                      onToggleExpanded={onToggleExpanded}
                      onPin={onPinTab}
                      onClose={onCloseTab}
                      onTriggerWorkflowAction={onTriggerWorkflowAction}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((row) => {
              if (row.kind === 'group') {
                const label = row.label || '';
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => {
                      if (!label) return;
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(label)) next.delete(label);
                        else next.add(label);
                        return next;
                      });
                    }}
                    className="w-full rounded border border-border/70 bg-bg px-2 py-1 text-left text-[11px] font-medium text-text-dim"
                  >
                    {label} ({row.count || 0})
                  </button>
                );
              }
              if (!row.tab) return null;
              return (
                <TabRow
                  key={row.key}
                  tab={row.tab}
                  expanded={expandedTabIds.has(row.tab.id)}
                  selected={selectedTabId === row.tab.id}
                  runningAction={runningActionByTab[row.tab.id]}
                  onSelect={onSelectTab}
                  onToggleExpanded={onToggleExpanded}
                  onPin={onPinTab}
                  onClose={onCloseTab}
                  onTriggerWorkflowAction={onTriggerWorkflowAction}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
