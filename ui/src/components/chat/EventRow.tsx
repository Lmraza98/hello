import { ChevronDown, ChevronRight, CircleCheck, CircleDot, CircleX, Clock3, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { WorkflowChipStatus } from './workflowEventFormatters';
import { UnifiedCard } from './UnifiedCard';

function statusIcon(status: WorkflowChipStatus): ReactNode {
  if (status === 'running') return <Clock3 className="h-3.5 w-3.5 text-amber-700" />;
  if (status === 'done') return <CircleCheck className="h-3.5 w-3.5 text-emerald-700" />;
  if (status === 'failed') return <CircleX className="h-3.5 w-3.5 text-red-700" />;
  return <CircleDot className="h-3.5 w-3.5 text-slate-500" />;
}

function kindIcon(kind: 'status' | 'tool' | 'action'): ReactNode {
  if (kind === 'tool') return <Wrench className="h-3.5 w-3.5 text-accent" />;
  return null;
}

function formatTs(timestamp?: Date): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function EventRow({
  kind,
  label,
  summary,
  timestamp,
  status,
  details,
  links = [],
  actions,
}: {
  kind: 'status' | 'tool' | 'action';
  label: string;
  summary?: string;
  timestamp?: Date;
  status: WorkflowChipStatus;
  details?: string;
  links?: Array<{ label: string; url: string }>;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(details && details.trim().length > 0);
  const statusClass =
    status === 'running'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : status === 'done'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : status === 'failed'
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <UnifiedCard
      title={label}
      icon={kindIcon(kind)}
      timestamp={formatTs(timestamp)}
      statusIcon={statusIcon(status)}
      statusLabel={status}
      statusClass={statusClass}
    >
      <div className="space-y-1.5">
        {summary ? <p className="text-xs text-text-muted">{summary}</p> : null}
        {links.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {links.map((link) => (
              <a
                key={`${link.label}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-medium text-accent hover:text-accent-hover"
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
        {actions ? <div>{actions}</div> : null}
        {hasDetails ? (
          <div>
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text"
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Show details
            </button>
            {open ? (
              <pre className="mt-1.5 max-h-52 overflow-auto rounded-md border border-border bg-bg p-2 text-[11px] text-text-dim">
                {details}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </UnifiedCard>
  );
}
