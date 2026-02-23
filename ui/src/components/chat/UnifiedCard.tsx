import type { ReactNode } from 'react';

export interface UnifiedCardProps {
  title?: string;
  icon?: ReactNode;
  statusIcon?: ReactNode;
  statusLabel?: string;
  statusClass?: string;
  timestamp?: string;
  roleLabel?: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function UnifiedCard({
  title,
  icon,
  statusIcon,
  statusLabel,
  statusClass,
  timestamp,
  roleLabel,
  children,
  actions,
}: UnifiedCardProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[76ch] rounded-xl border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
        {(roleLabel || timestamp) && (
          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-text-dim">
            <span className="uppercase tracking-wide">{roleLabel}</span>
            <span>{timestamp}</span>
          </div>
        )}

        {(title || statusLabel) && (
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0 flex items-center gap-2">
              {icon}
              {title && <p className="text-sm font-semibold text-text">{title}</p>}
            </div>
            {statusLabel && (
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>
                {statusIcon}
                {statusLabel}
              </span>
            )}
          </div>
        )}

        <div className="text-sm text-text-muted">
          {children}
        </div>

        {actions && (
          <div className="mt-3 flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
