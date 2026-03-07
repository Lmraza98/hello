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
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <span>{label}</span>
            <span className="font-medium text-text">{delta} 7d</span>
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">{value}</p>
        </div>
        <span className="rounded-md border border-border bg-bg p-1.5 text-text-muted">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-lg border border-border bg-surface p-3 text-left transition duration-150 hover:-translate-y-0.5 hover:bg-surface-hover hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-border bg-surface p-3 text-left">
      {content}
    </div>
  );
}
