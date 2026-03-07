type EmailTabItem = {
  id: string;
  label: string;
  count?: number;
};

type EmailTabsProps = {
  tabs: EmailTabItem[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  className?: string;
};

export function EmailTabs({ tabs, activeTab, onSelectTab, className = '' }: EmailTabsProps) {
  return (
    <div className={`min-w-0 overflow-x-auto no-scrollbar ${className}`.trim()}>
      <div className="inline-flex min-w-full items-end gap-1 border-b border-border">
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`relative -mb-px inline-flex h-8 items-center gap-1.5 rounded-t-md border px-3 text-[13px] font-medium transition-colors ${
                active
                  ? 'border-border border-b-bg bg-bg text-text'
                  : 'border-transparent text-text-muted hover:bg-surface-hover/60 hover:text-text'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' ? (
                <span
                  className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${
                    active ? 'bg-accent/10 text-accent' : 'bg-surface-hover/80 text-text-muted'
                  }`}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
