type Timeframe = 7 | 30 | 90;

type TimeframeToggleProps = {
  value: Timeframe;
  onChange: (next: Timeframe) => void;
};

const options: Timeframe[] = [7, 30, 90];

export function TimeframeToggle({ value, onChange }: TimeframeToggleProps) {
  return (
    <div
      className="inline-flex items-center gap-px border border-border bg-border"
      role="tablist"
      aria-label="Email performance timeframe"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={value === option}
          onClick={() => onChange(option)}
          className={`px-2.5 py-1 text-xs font-medium transition-colors ${
            value === option
              ? 'bg-accent text-white'
              : 'bg-surface text-text-muted hover:bg-surface-hover hover:text-text'
          }`}
        >
          {option}d
        </button>
      ))}
    </div>
  );
}

export type { Timeframe };
