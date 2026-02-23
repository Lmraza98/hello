import { Search, SlidersHorizontal } from 'lucide-react';

/**
 * Unified search + filter toolbar used at the top of data pages.
 * Includes a select-all checkbox, search input, and filter toggle button.
 * Domain-agnostic -- does not depend on TanStack Table or any entity type.
 *
 * @example
 * <SearchToolbar
 *   allSelected={table.getIsAllRowsSelected()}
 *   onToggleSelectAll={table.getToggleAllRowsSelectedHandler()}
 *   indeterminate={table.getIsSomeRowsSelected()}
 *   displayCount={selectedCount > 0 ? selectedCount : filteredCount}
 *   globalFilter={globalFilter}
 *   onGlobalFilterChange={setGlobalFilter}
 *   activeFilterCount={columnFilters.length}
 *   showFilters={showFilters}
 *   onToggleFilters={() => setShowFilters(v => !v)}
 *   filterPanelContent={<MyFilterPanel />}
 * />
 */
export type SearchToolbarProps = {
  /** Whether all rows are currently selected */
  allSelected: boolean;
  /** Callback to toggle select-all */
  onToggleSelectAll: (event?: unknown) => void;
  /** Show indeterminate state on the checkbox (some, but not all selected) */
  indeterminate?: boolean;
  /** Number shown next to the checkbox (selected count or total) */
  displayCount: number;
  /** Current search text */
  globalFilter: string;
  /** Callback when search text changes */
  onGlobalFilterChange: (value: string) => void;
  /** Number of active column/filter-panel filters */
  activeFilterCount: number;
  /** Whether the filter panel is currently visible */
  showFilters: boolean;
  /** Callback to toggle filter panel visibility */
  onToggleFilters: () => void;
  /** The filter panel to render when showFilters is true */
  filterPanelContent?: React.ReactNode;
};

export function SearchToolbar({
  allSelected,
  onToggleSelectAll,
  indeterminate,
  displayCount,
  globalFilter,
  onGlobalFilterChange,
  activeFilterCount,
  showFilters,
  onToggleFilters,
  filterPanelContent,
}: SearchToolbarProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(input) => {
            if (input) input.indeterminate = !!indeterminate;
          }}
          onChange={onToggleSelectAll}
          className="w-3.5 h-3.5 rounded border-gray-300 text-accent focus:ring-accent"
        />
        <span className="text-[11px] md:text-xs text-text-muted tabular-nums">
          {displayCount}
        </span>
      </div>

      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim" />
        <input
          type="text"
          placeholder="Search..."
          value={globalFilter}
          onChange={(e) => onGlobalFilterChange(e.target.value)}
          className="h-9 w-full pl-7 pr-2.5 bg-surface border border-border rounded-md text-[13px] text-text placeholder:text-[12px] placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
      </div>

      <div className="relative shrink-0">
        <button
          onClick={onToggleFilters}
          className={`inline-flex h-9 items-center gap-1 px-2.5 md:px-3 border rounded-md text-xs font-medium transition-colors ${
            activeFilterCount > 0
              ? 'border-accent text-accent bg-accent/5'
              : 'border-border text-text-muted hover:text-text hover:bg-surface-hover'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
        {showFilters && filterPanelContent}
      </div>
    </div>
  );
}
