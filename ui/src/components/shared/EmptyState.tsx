/**
 * Centered empty state placeholder with an icon, title, description,
 * and an optional call-to-action button.
 * Used inside scroll containers when a list/table has no rows.
 *
 * @example
 * <EmptyState
 *   icon={Building2}
 *   title="No companies found"
 *   description="Try adjusting your filters or add a new company"
 *   action={{ label: 'Add Company', icon: Plus, onClick: () => setShowAddModal(true) }}
 * />
 */
export type EmptyStateProps = {
  /** Large icon displayed above the title */
  icon: React.ElementType;
  /** Main heading */
  title: string;
  /** Supporting text */
  description: string;
  /** Optional action button */
  action?: {
    label: string;
    icon?: React.ElementType;
    onClick: () => void;
  };
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 md:py-20 text-text-muted px-4">
      <Icon className="w-10 h-10 md:w-12 md:h-12 mb-3 opacity-50" />
      <p className="text-base md:text-lg font-medium">{title}</p>
      <p className="text-xs md:text-sm mt-1 text-center">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          {action.icon && <action.icon className="w-4 h-4" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
