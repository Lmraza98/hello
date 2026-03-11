import type { Contact } from '../../api';
import { Cloud, ExternalLink } from 'lucide-react';

type LiveContactsProps = {
  contacts: Contact[];
};

export function LiveContacts({ contacts }: LiveContactsProps) {
  const grouped = contacts.reduce((acc, c) => {
    const company = c.company_name || 'Unknown';
    if (!acc[company]) acc[company] = [];
    acc[company].push(c);
    return acc;
  }, {} as Record<string, Contact[]>);

  if (contacts.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-text-muted">No contacts scraped today</p>;
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      {Object.entries(grouped).map(([company, list]) => (
        <div key={company} className="border-b border-border">
          <div className="flex h-[31px] items-center justify-between bg-bg px-2.5">
            <span className="truncate text-[11px] font-medium text-text">{company}</span>
            <span className="ml-2 shrink-0 text-[10px] text-text-muted">{list.length}</span>
          </div>
          <div>
            {list.slice(0, 5).map((c) => (
              <div key={c.id} className="flex min-h-[31px] items-center justify-between gap-2 border-t border-border-subtle px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-text">{c.name}</span>
                  {c.title ? <span className="block truncate text-[10px] text-text-dim">{c.title}</span> : null}
                </div>
                {c.salesforce_url ? (
                  <a
                    href={c.salesforce_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-5 shrink-0 items-center gap-1 border border-border bg-surface px-1.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text"
                    title="Open in Salesforce"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Cloud className="h-3 w-3 text-blue-600" />
                    SF <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                {c.email && (
                  <span className="hidden max-w-[140px] shrink-0 truncate text-[10px] text-success lg:block">{c.email}</span>
                )}
              </div>
            ))}
            {list.length > 5 && <div className="border-t border-border-subtle px-2.5 py-2 text-[10px] text-text-muted">+{list.length - 5} more</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
