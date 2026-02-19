import { ChevronDown, ChevronRight, CircleCheck, CircleDotDashed, CircleX, Clock3, FileWarning, ShieldAlert, Wrench } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { WorkflowChipStatus } from './workflowEventFormatters';

type WorkflowEventAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
};

type WorkflowEventCardProps = {
  kind: 'action_required' | 'status' | 'tool_result' | 'next_actions';
  title: string;
  summary: string;
  timestamp?: Date;
  status: WorkflowChipStatus;
  roleLabel?: string;
  keyOutputs?: string[];
  errorText?: string;
  details?: string;
  links?: Array<{ label: string; url: string }>;
  actions?: WorkflowEventAction[];
};

function statusClass(status: WorkflowChipStatus): string {
  if (status === 'running') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function statusLabel(status: WorkflowChipStatus): string {
  if (status === 'running') return 'running';
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  return 'queued';
}

function kindIcon(kind: WorkflowEventCardProps['kind']): ReactNode {
  if (kind === 'action_required') return <ShieldAlert className="h-4 w-4 text-accent" />;
  if (kind === 'tool_result') return <Wrench className="h-4 w-4 text-accent" />;
  if (kind === 'next_actions') return <FileWarning className="h-4 w-4 text-accent" />;
  return <CircleDotDashed className="h-4 w-4 text-accent" />;
}

function statusIcon(status: WorkflowChipStatus): ReactNode {
  if (status === 'running') return <Clock3 className="h-3.5 w-3.5" />;
  if (status === 'done') return <CircleCheck className="h-3.5 w-3.5" />;
  if (status === 'failed') return <CircleX className="h-3.5 w-3.5" />;
  return <CircleDotDashed className="h-3.5 w-3.5" />;
}

function formatTs(timestamp?: Date): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function WorkflowEventCard({
  kind,
  title,
  summary,
  timestamp,
  status,
  roleLabel = 'Assistant',
  keyOutputs = [],
  errorText,
  details,
  links = [],
  actions = [],
}: WorkflowEventCardProps) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(details && details.trim().length > 0);
  const hasFooterContent = keyOutputs.length > 0 || errorText || links.length > 0 || hasDetails;
  const ts = useMemo(() => formatTs(timestamp), [timestamp]);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[76ch] rounded-xl border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-text-dim">
          <span className="uppercase tracking-wide">{roleLabel}</span>
          <span>{ts}</span>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              {kindIcon(kind)}
              <p className="text-sm font-semibold text-text">{title}</p>
            </div>
            <p className="text-sm text-text-muted">{summary}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(status)}`}>
            {statusIcon(status)}
            {statusLabel(status)}
          </span>
        </div>

        {keyOutputs.length > 0 ? (
          <ul className="mt-2 space-y-1 pl-4 text-xs text-text-muted">
            {keyOutputs.map((item, idx) => (
              <li key={`${item}-${idx}`} className="list-disc">
                {item}
              </li>
            ))}
          </ul>
        ) : null}

        {errorText ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
            {errorText}
          </div>
        ) : null}

        {links.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {links.map((link) => (
              <a
                key={`${link.label}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-accent hover:text-accent-hover"
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="mt-3 flex items-center gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={
                  action.variant === 'secondary'
                    ? 'rounded-md border border-border bg-bg px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover'
                    : 'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover'
                }
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        {hasDetails ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Show details
            </button>
            {open ? (
              <pre className="mt-2 max-h-52 overflow-auto rounded border border-border bg-bg p-2 text-[11px] text-text-dim">
                {details}
              </pre>
            ) : null}
          </div>
        ) : null}

        {!hasFooterContent && actions.length === 0 ? (
          <div className="mt-1 text-[11px] text-text-dim">No additional details.</div>
        ) : null}
      </div>
    </div>
  );
}
