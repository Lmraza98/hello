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
};

export function CollapsibleSection({
  title,
  icon: Icon,
  storageKey,
  defaultCollapsed = false,
  badge,
  headerRight,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(`dash-collapse-${storageKey}`);
      return stored !== null ? stored === 'true' : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });

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
    <div className="border border-border rounded-lg overflow-hidden bg-surface">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-text-dim" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-text-dim" />
          )}
          {Icon && <Icon className="w-4 h-4 text-text-muted" />}
          <span className="text-sm font-semibold text-text">{title}</span>
          {badge}
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          <span className="text-[10px] text-text-dim">
            {collapsed ? 'Expand' : 'Collapse'}
          </span>
        </div>
      </button>
      <div
        style={{
          maxHeight: collapsed ? 0 : height ?? 'none',
          opacity: collapsed ? 0 : 1,
          transition: 'max-height 200ms ease, opacity 150ms ease',
          overflow: 'hidden',
        }}
      >
        <div ref={contentRef} className="px-4 pb-4">
          {children}
        </div>
      </div>
    </div>
  );
}
