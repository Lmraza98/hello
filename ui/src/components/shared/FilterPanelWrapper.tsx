import { X } from 'lucide-react';

/**
 * Responsive filter panel shell.
 * On **mobile**: renders as a bottom sheet with a backdrop overlay.
 * On **desktop**: renders as a dropdown positioned below its parent.
 *
 * Provides a standard header with "Filters" title, "Clear all" button,
 * and a close button. The actual filter controls are passed as children.
 *
 * @example
 * <FilterPanelWrapper
 *   isMobile={isMobile}
 *   onClose={() => setShowFilters(false)}
 *   filterCount={columnFilters.length}
 *   onClearAll={() => setColumnFilters([])}
 * >
 *   <TierFilter ... />
 *   <StatusFilter ... />
 * </FilterPanelWrapper>
 */
export type FilterPanelWrapperProps = {
  /** Whether to render as a mobile bottom sheet or desktop dropdown */
  isMobile: boolean;
  /** Close handler */
  onClose: () => void;
  /** Number of active filters (shows "Clear all" when > 0) */
  filterCount: number;
  /** Callback to clear all active filters */
  onClearAll: () => void;
  /** The domain-specific filter controls */
  children: React.ReactNode;
};

export function FilterPanelWrapper({
  isMobile,
  onClose,
  filterCount,
  onClearAll,
  children,
}: FilterPanelWrapperProps) {
  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <span className="text-sm font-medium text-text">Filters</span>
      <div className="flex items-center gap-2">
        {filterCount > 0 && (
          <button onClick={onClearAll} className="text-xs text-accent hover:underline">
            Clear all
          </button>
        )}
        <button onClick={onClose} className="p-0.5 hover:bg-surface-hover rounded">
          <X className="w-4 h-4 text-text-muted" />
        </button>
      </div>
    </div>
  );

  const body = (
    <div className="p-4 space-y-4 max-h-[60vh] md:max-h-[400px] overflow-y-auto">
      {children}
    </div>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
        <div
          className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-xl shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {header}
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border rounded-lg shadow-lg z-30">
      {header}
      {body}
    </div>
  );
}
