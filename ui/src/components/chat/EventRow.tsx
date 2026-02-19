import { ChevronDown, ChevronRight, CircleCheck, CircleDot, CircleX, Clock3, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { WorkflowChipStatus } from './workflowEventFormatters';

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
  return (
    <div className="ml-1 max-w-[74ch] border-l border-border/70 pl-3">
      <div className="flex items-center gap-2 text-xs text-text">
        {kindIcon(kind)}
        {statusIcon(status)}
        <span className="font-medium">{label}</span>
        <span className="text-[10px] text-text-dim">{formatTs(timestamp)}</span>
      </div>
      {summary ? <p className="mt-1 text-xs text-text-muted">{summary}</p> : null}
      {links.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
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
      {actions ? <div className="mt-1.5">{actions}</div> : null}
      {hasDetails ? (
        <div className="mt-1.5">
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
  );
}
