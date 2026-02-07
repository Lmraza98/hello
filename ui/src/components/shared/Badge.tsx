/**
 * Generic colored badge/pill component.
 * Maps a label to a Tailwind color class via a color map.
 * Domain-specific badges (TierBadge, StatusBadge, etc.) are thin wrappers
 * that pass their own color map.
 *
 * @example
 * <Badge label="A" colorMap={{ A: 'bg-green-50 text-green-700' }} />
 *
 * @example With capitalize
 * <Badge label="pending" colorMap={STATUS_COLORS} className="capitalize" />
 */
export type BadgeProps = {
  /** Text displayed inside the badge */
  label: string;
  /** Maps label values to Tailwind bg + text color classes */
  colorMap: Record<string, string>;
  /** Fallback color when the label is not in the colorMap */
  defaultColor?: string;
  /** Extra Tailwind classes (e.g. "capitalize") */
  className?: string;
};

export function Badge({
  label,
  colorMap,
  defaultColor = 'bg-gray-100 text-gray-600',
  className = '',
}: BadgeProps) {
  const color = colorMap[label] || defaultColor;
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${color} ${className}`}>
      {label}
    </span>
  );
}
