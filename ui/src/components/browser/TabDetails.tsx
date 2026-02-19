import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Eye, Focus, RefreshCw, Sparkles, TestTube2, Wand2 } from 'lucide-react';
import type { WorkbenchTab, WorkflowActionType } from './types';

type TabDetailsProps = {
  tab: WorkbenchTab;
  runningAction?: string | null;
  onTriggerWorkflowAction: (tabId: string, action: WorkflowActionType) => void;
};

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-dim hover:bg-surface-hover disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

export function TabDetails({ tab, runningAction, onTriggerWorkflowAction }: TabDetailsProps) {
  return (
    <div className="border-t border-border/70 bg-bg px-3 py-2 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] text-text">{tab.url || 'about:blank'}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(tab.url || '');
          }}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-dim hover:bg-surface-hover"
        >
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
        <span>status: {tab.status}</span>
        {tab.lastError ? (
          <span className="inline-flex items-center gap-1 text-red-600">
            <AlertTriangle className="h-3 w-3" />
            {tab.lastError}
          </span>
        ) : null}
        {runningAction ? <span className="text-accent">running: {runningAction}</span> : null}
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <ActionButton label="Focus" icon={<Focus className="h-3 w-3" />} onClick={() => onTriggerWorkflowAction(tab.id, 'focus')} />
        <ActionButton label="Observe" icon={<Eye className="h-3 w-3" />} onClick={() => onTriggerWorkflowAction(tab.id, 'observe')} />
        <ActionButton label="Annotate" icon={<Wand2 className="h-3 w-3" />} onClick={() => onTriggerWorkflowAction(tab.id, 'annotate')} />
        <ActionButton label="Validate" icon={<TestTube2 className="h-3 w-3" />} onClick={() => onTriggerWorkflowAction(tab.id, 'validate')} />
        <ActionButton label="Synthesize" icon={<Sparkles className="h-3 w-3" />} onClick={() => onTriggerWorkflowAction(tab.id, 'synthesize')} />
        <ActionButton label="Refresh" icon={<RefreshCw className="h-3 w-3" />} onClick={() => onTriggerWorkflowAction(tab.id, 'refresh')} />
      </div>

      {tab.validationSummary ? (
        <div className="text-[11px]">
          <span className="mr-1 text-text-dim">validation:</span>
          <span className={tab.validationSummary.status === 'pass' ? 'text-green-600' : 'text-amber-600'}>
            {tab.validationSummary.status === 'pass' ? (
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            )}
            {tab.validationSummary.status} ({tab.validationSummary.fitScore.toFixed(2)})
          </span>
        </div>
      ) : (
        <div className="text-[11px] text-text-dim">No validation run yet.</div>
      )}
    </div>
  );
}
