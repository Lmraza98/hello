import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type CollapsibleSectionProps = {
  title: string;
  icon?: React.ElementType;
  storageKey: string;
  defaultCollapsed?: boolean;
  badge?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function CollapsibleSection({
  title,
  icon: Icon,
  storageKey,
  defaultCollapsed = false,
  badge,
  headerRight,
  children,
  className = '',
  contentClassName = '',
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`dash-collapse-${storageKey}`);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch {
      // ignore
    }
  }, [storageKey]);

  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(`dash-collapse-${storageKey}`, String(collapsed));
    } catch { /* ignore */ }
  }, [collapsed, storageKey]);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [children]);

  return (
    <div className={`flex h-full min-h-0 flex-col border border-border bg-surface ${className}`.trim()}>
      <div className="flex h-[31px] items-center justify-between border-b border-border px-2.5">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-text"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-text-dim" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-text-dim" />
          )}
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-text-dim">{title}</span>
          {badge}
        </button>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {headerRight}
        </div>
      </div>
      <div
        style={{
          maxHeight: collapsed ? 0 : height ?? 'none',
          opacity: collapsed ? 0 : 1,
          transition: 'max-height 200ms ease, opacity 150ms ease',
          overflow: 'hidden',
        }}
        className="min-h-0 flex-1"
      >
        <div ref={contentRef} className={`min-h-0 flex-1 ${contentClassName}`.trim()}>
          {children}
        </div>
      </div>
    </div>
  );
}
