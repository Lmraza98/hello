import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PerformanceMode } from './PerformanceModeToggle';

export type PerformanceSummary = {
  key: string;
  label: string;
  sent: number;
  replies: number;
  replyRate: number;
};

type CampaignSummaryStripProps = {
  mode: PerformanceMode;
  summary: PerformanceSummary | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenDetail: () => void;
};

function modeLabel(mode: PerformanceMode): string {
  if (mode === 'template') return 'Top Template';
  if (mode === 'campaign') return 'Top Campaign';
  return 'Top Campaign';
}

export function CampaignSummaryStrip({
  mode,
  summary,
  collapsed,
  onToggleCollapse,
  onOpenDetail,
}: CampaignSummaryStripProps) {
  if (!summary) return null;
  return (
    <div className="border border-border bg-bg/60 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="inline-flex min-w-0 items-center gap-1 text-left text-[11px] text-text-muted hover:text-text"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span className="whitespace-nowrap">{modeLabel(mode)} (30d)</span>
        </button>
        <button
          type="button"
          onClick={onOpenDetail}
          className="truncate text-xs font-medium text-text hover:text-accent"
          title={summary.label}
        >
          {summary.label}
        </button>
      </div>
      {!collapsed ? (
        <div className="mt-1.5 grid grid-cols-3 gap-px border border-border bg-border text-[11px]">
          <div className="bg-surface px-1.5 py-1">
            <p className="text-text-dim">Reply rate</p>
            <p className="font-semibold text-text">{summary.replyRate.toFixed(1)}%</p>
          </div>
          <div className="bg-surface px-1.5 py-1">
            <p className="text-text-dim">Sent</p>
            <p className="font-semibold text-text tabular-nums">{summary.sent}</p>
          </div>
          <div className="bg-surface px-1.5 py-1">
            <p className="text-text-dim">Replies</p>
            <p className="font-semibold text-text tabular-nums">{summary.replies}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
