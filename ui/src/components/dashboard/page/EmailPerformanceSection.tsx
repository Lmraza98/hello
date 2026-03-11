import { MiniLineChart } from '../MiniLineChart';
import { PerformanceModeToggle, type PerformanceMode } from './PerformanceModeToggle';
import { TimeframeToggle, type Timeframe } from './TimeframeToggle';
import { formatPercent, type DailyPoint } from './performanceUtils';

type KpiKey = 'sent' | 'viewed' | 'responded';

type EmailPerformanceSectionProps = {
  performanceMode: PerformanceMode;
  onChangeMode: (mode: PerformanceMode) => void;
  timeframe: Timeframe;
  onChangeTimeframe: (timeframe: Timeframe) => void;
  hasCampaigns: boolean;
  onCreateCampaign: () => void;
  focusMetric: KpiKey | null;
  onToggleFocusMetric: (key: KpiKey) => void;
  modeKpis: {
    sent: number;
    viewed: number;
    responded: number;
    windowReplyRate: number;
  };
  templatesInUse: number;
  activeCampaignCount: number;
  chartPrimaryData: DailyPoint[];
  chartBaselineData?: DailyPoint[];
};

function MetricButton({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-surface px-2 py-1.5 text-left transition-colors ${
        active ? 'bg-accent/10 text-text' : 'text-text hover:bg-surface-hover'
      }`}
      data-component="dashboard-email-kpi"
      data-kpi={label.toLowerCase()}
    >
      <p className="text-[9px] uppercase tracking-wide text-text-dim">{label}</p>
      <p className="text-xs font-semibold text-text tabular-nums md:text-sm">{value}</p>
    </button>
  );
}

export function EmailPerformanceSection({
  performanceMode,
  onChangeMode,
  timeframe,
  onChangeTimeframe,
  hasCampaigns,
  onCreateCampaign,
  focusMetric,
  onToggleFocusMetric,
  modeKpis,
  templatesInUse,
  activeCampaignCount,
  chartPrimaryData,
  chartBaselineData,
}: EmailPerformanceSectionProps) {
  return (
    <section className="border border-border bg-surface" data-component="dashboard-email-performance">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="min-w-0">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Email Performance</h3>
          <p className="text-[10px] text-text-muted">AI outreach performance by timeframe</p>
        </div>
        <div className="flex items-center gap-1.5">
          <PerformanceModeToggle value={performanceMode} onChange={onChangeMode} />
          <TimeframeToggle value={timeframe} onChange={onChangeTimeframe} />
        </div>
      </div>
      <div>
        {!hasCampaigns ? (
          <div className="border border-dashed border-border px-2.5 py-2 text-[11px] text-text-muted">
            No campaigns yet.{' '}
            <button
              type="button"
              onClick={onCreateCampaign}
              className="font-medium text-accent hover:text-accent-hover"
              data-component="dashboard-email-empty-cta"
            >
              Create your first campaign.
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-2 border border-border bg-border md:grid-cols-5">
          <MetricButton
            label="Sent"
            value={modeKpis.sent}
            active={focusMetric === 'sent'}
            onClick={() => onToggleFocusMetric('sent')}
          />
          <MetricButton
            label="Viewed"
            value={modeKpis.viewed}
            active={focusMetric === 'viewed'}
            onClick={() => onToggleFocusMetric('viewed')}
          />
          <MetricButton
            label="Responded"
            value={modeKpis.responded}
            active={focusMetric === 'responded'}
            onClick={() => onToggleFocusMetric('responded')}
          />
          <div className="bg-surface px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-text-dim">Reply Rate</p>
            <p className="text-xs font-semibold text-text tabular-nums md:text-sm">{formatPercent(modeKpis.windowReplyRate)}</p>
          </div>
          <div className="bg-surface px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-text-dim">
              {performanceMode === 'template' ? 'Templates in Use' : 'Active Campaigns'}
            </p>
            <p className="text-xs font-semibold text-text tabular-nums md:text-sm">
              {performanceMode === 'template' ? templatesInUse : activeCampaignCount}
            </p>
          </div>
        </div>

        {chartPrimaryData.length > 1 ? (
          <div className="h-28 border border-border bg-bg px-2 py-1.5 md:h-32">
            <MiniLineChart
              data={chartPrimaryData}
              secondaryData={chartBaselineData}
              focusMetric={focusMetric}
              compact
              hideLegend
            />
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">Send campaigns to generate performance trends.</p>
        )}
      </div>
    </section>
  );
}
