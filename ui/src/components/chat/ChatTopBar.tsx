export function ChatTopBar({
  traceOpen,
  onToggleTrace,
}: {
  traceOpen: boolean;
  onToggleTrace: () => void;
}) {
  return (
    <div className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-surface px-3 md:px-4">
      <h2 className="text-sm font-semibold text-text">Assistant</h2>
      <button
        type="button"
        onClick={onToggleTrace}
        className="rounded-md border border-border/70 bg-bg px-2.5 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
      >
        {traceOpen ? 'Hide Trace' : 'Show Trace'}
      </button>
    </div>
  );
}
