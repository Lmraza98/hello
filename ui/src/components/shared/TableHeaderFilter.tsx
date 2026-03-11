import { useEffect, useRef, type ReactNode } from 'react';
import { Filter } from 'lucide-react';

export function TableHeaderFilter({
  open,
  active,
  label,
  onToggle,
  children,
  align = 'left',
}: {
  open: boolean;
  active: boolean;
  label: string;
  onToggle: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onToggle();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [onToggle, open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        aria-label={`Filter ${label}`}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-none transition-colors ${active ? 'text-text' : 'text-text-dim hover:text-text'}`}
      >
        <Filter className="h-3 w-3" />
      </button>
      {open ? (
        <div
          className={`absolute top-6 z-40 w-40 rounded-none border border-border bg-surface p-2 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
