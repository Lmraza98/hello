import type { Contact } from '../../api';

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
    return <p className="text-xs text-text-muted text-center py-6">No contacts scraped today</p>;
  }

  return (
    <div className="space-y-2 max-h-72 md:max-h-96 overflow-y-auto">
      {Object.entries(grouped).map(([company, list]) => (
        <div key={company} className="border border-border rounded-lg overflow-hidden">
          <div className="px-2.5 md:px-3 py-1.5 bg-surface-hover flex justify-between items-center">
            <span className="font-medium text-text text-xs md:text-sm truncate">{company}</span>
            <span className="text-[10px] text-text-muted shrink-0 ml-2">{list.length}</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {list.slice(0, 5).map((c) => (
              <div key={c.id} className="px-2.5 md:px-3 py-1.5 flex justify-between items-center gap-2">
                <span className="text-xs text-text truncate flex-1 min-w-0">{c.name}</span>
                {c.email && (
                  <span className="text-[10px] text-success shrink-0 truncate max-w-[100px] md:max-w-none">{c.email}</span>
                )}
              </div>
            ))}
            {list.length > 5 && <div className="px-2.5 md:px-3 py-1.5 text-[10px] text-text-muted">+{list.length - 5} more</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
