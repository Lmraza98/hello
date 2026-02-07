import { useMemo } from 'react';
import type { ColumnFiltersState } from '@tanstack/react-table';
import type { Contact, EmailCampaign } from '../../api';
import { FilterPanelWrapper } from '../shared/FilterPanelWrapper';

type FilterPanelProps = {
  columnFilters: ColumnFiltersState;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  contacts: Contact[];
  campaigns: EmailCampaign[];
  onCampaignChange: (id: string) => void;
  activeCampaignId: string;
  onClose: () => void;
  isMobile: boolean;
};

export function FilterPanel({
  columnFilters,
  setColumnFilters,
  contacts,
  campaigns,
  onCampaignChange,
  activeCampaignId,
  onClose,
  isMobile,
}: FilterPanelProps) {
  const getFilterValue = (id: string) => (columnFilters.find((f) => f.id === id)?.value as string) ?? '';

  const uniqueVerticals = useMemo(
    () => Array.from(new Set(contacts.map((c) => c.vertical).filter(Boolean))).sort() as string[],
    [contacts]
  );

  const setFilter = (id: string, value: string) => {
    setColumnFilters((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (value) next.push({ id, value });
      return next;
    });
  };

  const activeCount = columnFilters.length + (activeCampaignId ? 1 : 0);

  const selectClass =
    'w-full px-2.5 py-2.5 md:py-1.5 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent appearance-none';
  const inputClass =
    'w-full px-2.5 py-2.5 md:py-1.5 text-sm bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent';

  return (
    <FilterPanelWrapper
      isMobile={isMobile}
      onClose={onClose}
      filterCount={activeCount}
      onClearAll={() => {
        setColumnFilters([]);
        onCampaignChange('');
      }}
    >
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Name</label>
        <input
          type="text"
          placeholder="Filter by name..."
          value={getFilterValue('name')}
          onChange={(e) => setFilter('name', e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Title</label>
        <input
          type="text"
          placeholder="Filter by title..."
          value={getFilterValue('title')}
          onChange={(e) => setFilter('title', e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Company</label>
        <input
          type="text"
          placeholder="Filter by company..."
          value={getFilterValue('company_name')}
          onChange={(e) => setFilter('company_name', e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Email</label>
        <div className="flex gap-1.5">
          {[
            { label: 'All', value: '' },
            { label: 'Has email', value: 'yes' },
            { label: 'No email', value: 'no' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter('hasEmail', opt.value)}
              className={`flex-1 px-2 py-2 md:py-1.5 rounded-lg text-xs font-medium transition-colors ${
                getFilterValue('hasEmail') === opt.value
                  ? 'bg-accent text-white'
                  : 'bg-bg border border-border text-text-muted hover:text-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Salesforce</label>
        <select
          value={getFilterValue('salesforce_status')}
          onChange={(e) => setFilter('salesforce_status', e.target.value)}
          className={selectClass}
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="uploaded">Uploaded</option>
          <option value="completed">Completed</option>
          <option value="denied">Denied</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Vertical</label>
        <select value={getFilterValue('vertical')} onChange={(e) => setFilter('vertical', e.target.value)} className={selectClass}>
          <option value="">All</option>
          {uniqueVerticals.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Campaign</label>
        <select value={activeCampaignId} onChange={(e) => onCampaignChange(e.target.value)} className={selectClass}>
          <option value="">All</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </FilterPanelWrapper>
  );
}
