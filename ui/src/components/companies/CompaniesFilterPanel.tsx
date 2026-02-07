import { useMemo } from 'react';
import type { ColumnFiltersState } from '@tanstack/react-table';
import type { Company } from '../../api';
import { FilterPanelWrapper } from '../shared/FilterPanelWrapper';

type CompaniesFilterPanelProps = {
  columnFilters: ColumnFiltersState;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  companies: Company[];
  onClose: () => void;
  isMobile: boolean;
};

export function CompaniesFilterPanel({
  columnFilters,
  setColumnFilters,
  companies,
  onClose,
  isMobile,
}: CompaniesFilterPanelProps) {
  const tierValue = (columnFilters.find((f) => f.id === 'tier')?.value as string) ?? '';
  const statusValue = (columnFilters.find((f) => f.id === 'status')?.value as string) ?? '';
  const verticalValue = (columnFilters.find((f) => f.id === 'vertical')?.value as string) ?? '';

  const uniqueVerticals = useMemo(
    () => Array.from(new Set(companies.map((c) => c.vertical).filter(Boolean))).sort() as string[],
    [companies]
  );
  const uniqueStatuses = useMemo(
    () => Array.from(new Set(companies.map((c) => c.status || 'pending'))).sort() as string[],
    [companies]
  );

  const setFilter = (id: string, value: string) => {
    setColumnFilters((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (value) next.push({ id, value });
      return next;
    });
  };

  return (
    <FilterPanelWrapper
      isMobile={isMobile}
      onClose={onClose}
      filterCount={columnFilters.length}
      onClearAll={() => setColumnFilters([])}
    >
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Tier</label>
        <div className="flex gap-1.5">
          {['', 'A', 'B', 'C'].map((t) => (
            <button
              key={t}
              onClick={() => setFilter('tier', t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tierValue === t ? 'bg-accent text-white' : 'bg-bg border border-border text-text-muted hover:text-text'
              }`}
            >
              {t || 'All'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Status</label>
        <select
          value={statusValue}
          onChange={(e) => setFilter('status', e.target.value)}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text"
        >
          <option value="">All statuses</option>
          {uniqueStatuses.map((s) => (
            <option key={s} value={s}>
              {s === 'scraped' ? 'completed' : s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Vertical</label>
        <select
          value={verticalValue}
          onChange={(e) => setFilter('vertical', e.target.value)}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text"
        >
          <option value="">All verticals</option>
          {uniqueVerticals.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    </FilterPanelWrapper>
  );
}
