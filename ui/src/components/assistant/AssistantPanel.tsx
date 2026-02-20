import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { AssistantActivityList, type AssistantActivityItem } from './AssistantActivityList';

export type AssistantSuggestedAction = {
  id: string;
  label: string;
  icon?: ReactNode;
};

type AssistantPanelProps = {
  activityItems: AssistantActivityItem[];
  suggestedActions: AssistantSuggestedAction[];
  onActionClick: (actionId: string) => void;
  onClose?: () => void;
};

export function AssistantPanel({ activityItems, suggestedActions, onActionClick, onClose }: AssistantPanelProps) {
  return (
    <aside className="flex h-full flex-col rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text">Assistant</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
            title="Search"
          >
            <Search className="h-4 w-4" />
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
          <Search className="h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
          />
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Activity</h3>
            <span className="text-[11px] text-text-dim">Recent</span>
          </div>
          <AssistantActivityList items={activityItems} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full bg-accent/10 text-accent flex items-center justify-center">AI</div>
            <div className="text-xs text-text-dim">Assistant</div>
          </div>
          <div className="rounded-2xl border border-border bg-bg px-4 py-3 text-sm text-text shadow-sm">
            Hi! I can help you find contacts, manage campaigns, and send emails. How can I assist you?
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">Suggested Actions</h3>
          <div className="flex flex-wrap gap-2">
            {suggestedActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onActionClick(action.id)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-xs font-medium text-text hover:bg-surface-hover"
              >
                {action.icon ? <span className="text-text-muted">{action.icon}</span> : null}
                {action.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
