import { ChevronDown, ChevronRight, Clock3, MousePointerClick, Navigation, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { chatTheme } from './themeTokens';

type ActionRow = {
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed';
};

function statusChip(status: ActionRow['status']): string {
  if (status === 'running') return 'bg-amber-100 text-amber-800';
  if (status === 'done') return 'bg-emerald-100 text-emerald-800';
  if (status === 'failed') return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

function iconFor(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes('navigate')) return <Navigation className="h-3.5 w-3.5 text-accent" />;
  if (lower.includes('click') || lower.includes('select')) return <MousePointerClick className="h-3.5 w-3.5 text-accent" />;
  if (lower.includes('wait')) return <Clock3 className="h-3.5 w-3.5 text-accent" />;
  return <Navigation className="h-3.5 w-3.5 text-accent" />;
}

export function PlannedActionsCard({
  content,
  details,
  onRetry,
}: {
  content: string;
  details?: string;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo<ActionRow[]>(() => {
    const source = `${content || ''}\n${details || ''}`.trim();
    const lines = source
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !/^planned ui actions\.?$/i.test(x));
    return lines.map((line) => {
      const lower = line.toLowerCase();
      const status: ActionRow['status'] = lower.includes('fail')
        ? 'failed'
        : lower.includes('done') || lower.includes('completed')
          ? 'done'
          : lower.includes('running')
            ? 'running'
            : 'queued';
      return { label: line, status };
    });
  }, [content, details]);

  if (rows.length === 0) return null;
  const visible = expanded ? rows : rows.slice(0, 4);
  const hasFailed = rows.some((r) => r.status === 'failed');
  return (
    <div className={chatTheme.assistantTextWrap}>
      <div className={`${chatTheme.assistantCard} max-w-[72ch]`}>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mb-2 inline-flex items-center gap-1 text-left text-sm font-semibold text-text"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Planned actions
        </button>
        <div className="space-y-1.5">
          {visible.map((row, idx) => (
            <div key={`${row.label}-${idx}`} className="flex items-center justify-between gap-2 rounded border border-border bg-bg px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                {iconFor(row.label)}
                <p className="truncate text-xs text-text">{row.label}</p>
              </div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusChip(row.status)}`}>
                {row.status}
              </span>
            </div>
          ))}
        </div>
        {rows.length > 4 ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-2 text-xs text-text-muted hover:text-text"
          >
            {expanded ? 'Hide actions' : `Show actions (${rows.length})`}
          </button>
        ) : null}
        {hasFailed ? (
          <div className="mt-2 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
            <TriangleAlert className="h-3.5 w-3.5" />
            <span>Some actions failed.</span>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="ml-auto rounded border border-red-300 px-2 py-0.5 text-[11px] hover:bg-red-100">
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

