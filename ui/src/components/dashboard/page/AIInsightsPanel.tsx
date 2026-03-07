import { Lightbulb, ArrowRight } from 'lucide-react';

type AIInsightsPanelProps = {
  insights: string[];
  ctaLabel: string;
  onCta: () => void;
};

export function AIInsightsPanel({ insights, ctaLabel, onCta }: AIInsightsPanelProps) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">AI Insights</p>
          <h2 className="mt-1 text-base font-semibold text-text">Suggested next moves</h2>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-text-muted">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          Assistant
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {insights.map((insight, idx) => (
          <li key={`${insight}-${idx}`} className="flex items-start gap-2 text-sm text-text">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
            <span>{insight}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onCta}
        className="mt-4 inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        {ctaLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}
