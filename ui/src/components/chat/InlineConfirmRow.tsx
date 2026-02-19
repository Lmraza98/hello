import { EventRow } from './EventRow';

export function InlineConfirmRow({
  summary,
  timestamp,
  details,
  onConfirm,
  onDeny,
}: {
  summary: string;
  timestamp?: Date;
  details?: string;
  onConfirm: () => void;
  onDeny: () => void;
}) {
  const compact = summary.split('\n').map((x) => x.trim()).filter(Boolean)[0] || 'Confirm planned actions.';
  return (
    <EventRow
      kind="action"
      label="Action required"
      summary={compact}
      timestamp={timestamp}
      status="queued"
      details={details}
      actions={(
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onDeny}
            className="rounded-md border border-border bg-bg px-2.5 py-1 text-[11px] font-medium text-text hover:bg-surface-hover"
          >
            Deny
          </button>
        </div>
      )}
    />
  );
}
