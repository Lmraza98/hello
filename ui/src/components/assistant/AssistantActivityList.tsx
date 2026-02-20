import type { ReactNode } from 'react';

export type AssistantActivityItem = {
  id: string;
  label: string;
  time?: string;
  icon?: ReactNode;
};

type AssistantActivityListProps = {
  items: AssistantActivityItem[];
};

export function AssistantActivityList({ items }: AssistantActivityListProps) {
  if (items.length === 0) {
    return <p className="text-xs text-text-muted">No recent activity yet.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-bg px-3 py-2">
          <div className="h-8 w-8 shrink-0 rounded-md bg-accent/10 text-accent flex items-center justify-center">
            {item.icon ?? <span className="text-[11px] font-semibold">AI</span>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text truncate">{item.label}</p>
            {item.time ? <p className="text-[11px] text-text-dim mt-0.5">{item.time}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
