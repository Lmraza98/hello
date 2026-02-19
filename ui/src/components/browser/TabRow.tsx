import { ChevronDown, ChevronRight, Globe, MoreHorizontal, Pin, PinOff, X } from 'lucide-react';
import { TabDetails } from './TabDetails';
import type { WorkbenchTab, WorkflowActionType } from './types';

type TabRowProps = {
  tab: WorkbenchTab;
  expanded: boolean;
  selected: boolean;
  runningAction?: string | null;
  onSelect: (tabId: string) => void;
  onToggleExpanded: (tabId: string) => void;
  onPin: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onTriggerWorkflowAction: (tabId: string, action: WorkflowActionType) => void;
};

function relativeTime(epochMs: number): string {
  const deltaMs = Math.max(0, Date.now() - epochMs);
  if (deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusClass(status: WorkbenchTab['status']): string {
  if (status === 'active') return 'bg-blue-100 text-blue-700';
  if (status === 'running') return 'bg-cyan-100 text-cyan-700';
  if (status === 'error') return 'bg-red-100 text-red-700';
  if (status === 'blocked') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

export function TabRow({
  tab,
  expanded,
  selected,
  runningAction,
  onSelect,
  onToggleExpanded,
  onPin,
  onClose,
  onTriggerWorkflowAction,
}: TabRowProps) {
  return (
    <div className={`rounded border ${selected ? 'border-accent/60 bg-accent/5' : 'border-border bg-surface'}`}>
      <div
        className="flex cursor-pointer items-center gap-2 px-2 py-2"
        onClick={() => onSelect(tab.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect(tab.id);
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded(tab.id);
          }}
          className="rounded p-0.5 text-text-dim hover:bg-surface-hover"
          aria-label={expanded ? 'Collapse tab details' : 'Expand tab details'}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        {tab.faviconUrl ? (
          <img src={tab.faviconUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
        ) : (
          <Globe className="h-4 w-4 shrink-0 text-text-dim" />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-text">{tab.title || 'Untitled tab'}</div>
          <div className="truncate text-[11px] text-text-dim">{tab.domain}</div>
        </div>

        <div className="hidden items-center gap-1 md:flex">
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClass(tab.status)}`}>{tab.status}</span>
          {tab.validationSummary ? (
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${tab.validationSummary.status === 'pass' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {tab.validationSummary.status}
            </span>
          ) : null}
          {tab.hasAnnotations ? <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">annotated</span> : null}
        </div>

        <div className="hidden w-[66px] shrink-0 text-right text-[10px] text-text-dim md:block">
          {relativeTime(tab.lastUpdatedAt)}
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPin(tab.id);
            }}
            className="rounded p-1 text-text-dim hover:bg-surface-hover"
            title={tab.isPinned ? 'Unpin tab' : 'Pin tab'}
          >
            {tab.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            className="rounded p-1 text-text-dim hover:bg-surface-hover"
            title="Close tab from manager"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded(tab.id);
            }}
            className="rounded p-1 text-text-dim hover:bg-surface-hover"
            title="More details"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded ? (
        <TabDetails tab={tab} runningAction={runningAction} onTriggerWorkflowAction={onTriggerWorkflowAction} />
      ) : null}
    </div>
  );
}

