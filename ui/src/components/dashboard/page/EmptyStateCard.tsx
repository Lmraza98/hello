import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';

type EmptyStateCardProps = {
  title: string;
  description: string;
  ctaLabel: string;
  onCta: () => void;
  Icon?: LucideIcon;
};

export function EmptyStateCard({
  title,
  description,
  ctaLabel,
  onCta,
  Icon,
}: EmptyStateCardProps) {
  return (
    <div className="flex min-h-28 flex-col items-start justify-center rounded-md border border-dashed border-border/80 bg-bg/20 p-2.5">
      {Icon ? (
        <div className="mb-1.5 rounded-md border border-border bg-surface px-1.5 py-0.5 text-text-muted">
          <Icon className="h-3.5 w-3.5" />
        </div>
      ) : null}
      <p className="text-xs font-medium text-text">{title}</p>
      <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">{description}</p>
      <button
        type="button"
        onClick={onCta}
        className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        {ctaLabel}
        <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}
