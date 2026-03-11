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
    <div className="flex h-full min-h-0 flex-col items-start justify-center px-3 py-3">
      {Icon ? (
        <div className="mb-2 inline-flex h-7 w-7 items-center justify-center border border-border bg-bg text-text-muted">
          <Icon className="h-3.5 w-3.5" />
        </div>
      ) : null}
      <p className="text-xs font-medium text-text">{title}</p>
      <p className="mt-1 max-w-sm text-[11px] leading-5 text-text-muted">{description}</p>
      <button
        type="button"
        onClick={onCta}
        className="mt-2 inline-flex h-7 items-center gap-1 border border-border bg-bg px-2.5 text-[11px] font-medium text-text transition-colors hover:bg-surface-hover focus:outline-none"
      >
        {ctaLabel}
        <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}
