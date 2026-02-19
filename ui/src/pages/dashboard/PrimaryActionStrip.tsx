import type { LucideIcon } from 'lucide-react';

type PrimaryAction = {
  label: string;
  description: string;
  onClick: () => void;
  Icon: LucideIcon;
};

type PrimaryActionStripProps = {
  actions: PrimaryAction[];
};

export function PrimaryActionStrip({ actions }: PrimaryActionStripProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">
        What should I do right now?
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="group rounded-md border border-border bg-bg px-3 py-2 text-left transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <div className="flex items-start gap-2">
              <action.Icon className="mt-0.5 h-4 w-4 text-accent" />
              <div>
                <p className="text-sm font-medium text-text">{action.label}</p>
                <p className="text-xs text-text-muted">{action.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
