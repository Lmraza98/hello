import type { LucideIcon } from 'lucide-react';

type StatCardProps = {
  label: string;
  value: string | number;
  delta?: string;
  Icon: LucideIcon;
  onClick?: () => void;
};

export function StatCard({
  label,
  value,
  delta = '--',
  Icon,
  onClick,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wide text-text-dim">
            <span>{label}</span>
            <span className="font-medium text-text">{delta} 7d</span>
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-text md:text-xl">{value}</p>
        </div>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-border bg-bg text-text-muted">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus:outline-none"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="w-full border border-border bg-surface px-2.5 py-2 text-left">
      {content}
    </div>
  );
}
