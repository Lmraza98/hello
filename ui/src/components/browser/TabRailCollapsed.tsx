import { ChevronRight, Pin, Plus, Search } from 'lucide-react';
import type { WorkbenchTab } from './types';

type TabRailCollapsedProps = {
  tabs: WorkbenchTab[];
  selectedTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onExpand: () => void;
  onNewTab: () => void;
  onOpenSearch: () => void;
};

function statusDotClass(status: WorkbenchTab['status']): string {
  if (status === 'running') return 'bg-cyan-500';
  if (status === 'error') return 'bg-red-500';
  if (status === 'blocked') return 'bg-amber-500';
  if (status === 'active') return 'bg-blue-500';
  return 'bg-slate-400';
}

function initials(text: string): string {
  const token = (text || '').trim();
  if (!token) return '?';
  return token.slice(0, 1).toUpperCase();
}

export function TabRailCollapsed({
  tabs,
  selectedTabId,
  onSelectTab,
  onExpand,
  onNewTab,
  onOpenSearch,
}: TabRailCollapsedProps) {
  return (
    <div className="flex h-full w-[72px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex shrink-0 flex-col items-center gap-1 border-b border-border px-2 py-2">
        <button
          type="button"
          onClick={onExpand}
          className="rounded border border-border p-1.5 text-text-dim hover:bg-surface-hover"
          title="Expand tab manager"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNewTab}
          className="rounded border border-border p-1.5 text-text-dim hover:bg-surface-hover"
          title="New tab"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenSearch}
          className="rounded border border-border p-1.5 text-text-dim hover:bg-surface-hover"
          title="Search tabs"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        <div className="space-y-1">
          {tabs.map((tab) => {
            const selected = tab.id === selectedTabId;
            const tooltip = `${tab.title} | ${tab.domain}`;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                title={tooltip}
                className={`relative flex h-11 w-full items-center justify-center rounded border ${
                  selected ? 'border-accent bg-accent/10' : 'border-border bg-bg hover:bg-surface-hover'
                }`}
              >
                {tab.faviconUrl ? (
                  <img src={tab.faviconUrl} alt="" className="h-4 w-4 rounded-sm" />
                ) : (
                  <span className="text-xs font-semibold text-text-dim">{initials(tab.title || tab.domain)}</span>
                )}
                {tab.isPinned ? (
                  <Pin className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-accent" />
                ) : null}
                <span className={`absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full ${statusDotClass(tab.status)}`} />
                {selected ? <span className="absolute left-0 top-0 h-full w-0.5 rounded-l bg-accent" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

