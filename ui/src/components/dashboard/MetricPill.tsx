export interface MetricPillProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  highlight?: boolean;
}

export function MetricPill({
  icon: Icon,
  label,
  value,
  color,
  highlight,
}: MetricPillProps) {
  const displayValue = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div
      className={`flex h-full items-center gap-2 bg-surface px-3 py-2 md:flex-1 md:px-4 md:py-2.5 min-w-0 ${
        highlight ? 'bg-amber-50' : ''
      }`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-base md:text-lg font-semibold text-text tabular-nums whitespace-nowrap">
          {displayValue}
        </span>
        <span className="text-[10px] md:text-xs text-text-dim truncate">{label}</span>
      </div>
    </div>
  );
}
