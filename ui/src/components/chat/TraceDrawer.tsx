import { X } from 'lucide-react';
import { RunTracePanel } from './RunTracePanel';

export function TraceDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Close trace drawer backdrop"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/20"
      />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-border bg-surface shadow-2xl">
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          <p className="text-sm font-semibold text-text">Trace</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-[calc(100%-3rem)] overflow-y-auto p-3">
          <RunTracePanel expanded inDrawer />
        </div>
      </aside>
    </>
  );
}

