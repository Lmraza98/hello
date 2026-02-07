import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Expandable mobile card with a checkbox, content area, and chevron.
 * Used in virtualized lists as the mobile alternative to table rows.
 * Domain-specific cards (CompanyCard, ContactCard) wrap this and
 * pass their entity-specific content as children.
 *
 * @example
 * <MobileCard
 *   isSelected={row.getIsSelected()}
 *   isExpanded={row.getIsExpanded()}
 *   onToggleSelect={() => row.toggleSelected()}
 *   onToggleExpand={() => row.toggleExpanded()}
 *   expandedContent={<CompanyDetail company={company} />}
 * >
 *   <span>{company.name}</span>
 *   <TierBadge tier={company.tier} />
 * </MobileCard>
 */
export type MobileCardProps = {
  /** Whether the card's checkbox is checked */
  isSelected: boolean;
  /** Whether the expanded detail section is visible */
  isExpanded: boolean;
  /** Toggle the checkbox */
  onToggleSelect: () => void;
  /** Toggle the expanded section */
  onToggleExpand: () => void;
  /** Card summary content (always visible) */
  children: React.ReactNode;
  /** Detail content shown when expanded */
  expandedContent?: React.ReactNode;
};

export function MobileCard({
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  children,
  expandedContent,
}: MobileCardProps) {
  return (
    <div className="border-b border-border-subtle">
      <div className="flex items-start gap-3 px-4 py-3 active:bg-surface-hover/60" onClick={onToggleExpand}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent shrink-0"
        />
        <div className="flex-1 min-w-0">{children}</div>
        <div className="shrink-0 mt-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-text-dim" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-dim" />
          )}
        </div>
      </div>
      {isExpanded && expandedContent && (
        <div className="px-4 pb-4 pt-1 ml-7">{expandedContent}</div>
      )}
    </div>
  );
}
