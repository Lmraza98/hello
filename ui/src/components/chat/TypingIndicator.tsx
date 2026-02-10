export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-1 rounded-2xl border border-border bg-surface px-3 py-2">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-dim [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-dim [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-dim" />
      </div>
    </div>
  );
}
