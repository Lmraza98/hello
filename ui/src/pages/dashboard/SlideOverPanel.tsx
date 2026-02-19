import type { ReactNode } from 'react';
import { X } from 'lucide-react';

type SlideOverPanelProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

export function SlideOverPanel({ open, title, subtitle, onClose, children }: SlideOverPanelProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/25 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md border-l border-border bg-surface shadow-xl transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        <header className="flex items-start justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="h-[calc(100%-56px)] overflow-y-auto px-4 py-3">{children}</div>
      </aside>
    </>
  );
}
