import { Globe, Pin, X } from 'lucide-react';
import type { WorkbenchTab } from './types';

type TabGridProps = {
  tabs: WorkbenchTab[];
  selectedTabId: string | null;
  onSelect: (tabId: string) => void;
  onPin: (tabId: string) => void;
  onClose: (tabId: string) => void;
};

export function TabGrid({ tabs, selectedTabId, onSelect, onPin, onClose }: TabGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={`rounded border p-2 text-left ${selectedTabId === tab.id ? 'border-accent/60 bg-accent/5' : 'border-border bg-surface hover:bg-surface-hover'}`}
        >
          <div className="mb-1 flex items-center justify-between gap-1">
            <div className="min-w-0 truncate text-[11px] font-medium text-text">{tab.domain}</div>
            <div className="flex items-center gap-1">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">{tab.status}</span>
              {tab.isPinned ? <Pin className="h-3 w-3 text-accent" /> : null}
            </div>
          </div>

          <div className="mb-2 flex h-20 items-center justify-center overflow-hidden rounded border border-border bg-bg">
            {tab.screenshotUrl ? (
              <img src={tab.screenshotUrl} alt={`Tab ${tab.id}`} className="h-full w-full object-contain" />
            ) : (
              <Globe className="h-6 w-6 text-text-dim" />
            )}
          </div>

          <div className="truncate text-[11px] text-text-dim">{tab.title || 'Untitled tab'}</div>

          <div className="mt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPin(tab.id);
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover"
            >
              {tab.isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </button>
      ))}
    </div>
  );
}

