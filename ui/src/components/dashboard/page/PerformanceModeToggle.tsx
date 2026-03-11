export type PerformanceMode = 'overall' | 'campaign' | 'template';

type PerformanceModeToggleProps = {
  value: PerformanceMode;
  onChange: (mode: PerformanceMode) => void;
};

const OPTIONS: Array<{ value: PerformanceMode; label: string }> = [
  { value: 'overall', label: 'Overall' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'template', label: 'Template' },
];

export function PerformanceModeToggle({ value, onChange }: PerformanceModeToggleProps) {
  return (
    <label className="inline-flex items-center gap-1.5 border border-border bg-surface px-2 py-1 text-xs text-text-muted">
      <span className="hidden sm:inline">Performance by:</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as PerformanceMode)}
        className="bg-transparent text-xs font-medium text-text outline-none"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
