export function SystemEventMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-center">
      <span className="mx-auto inline-flex items-center rounded-full border border-border/70 bg-bg px-2 py-0.5 text-[11px] text-text-dim">
        {text}
      </span>
    </div>
  );
}
