import { MiniLineChart } from '../../components/dashboard/MiniLineChart';
import { CampaignSummaryStrip, type PerformanceSummary } from './CampaignSummaryStrip';
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
  summaryStrip: PerformanceSummary | null;
  summaryCollapsed: boolean;
  onToggleSummaryCollapse: () => void;
  onOpenSummaryDetail: () => void;
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
      className={`rounded-md border bg-bg p-1.5 text-left ${
        active ? 'border-accent/40 ring-1 ring-accent/30' : 'border-border'
      }`}
      data-component="dashboard-email-kpi"
      data-kpi={label.toLowerCase()}
    >
      <p className="text-[10px] text-text-muted">{label}</p>
      <p className="text-xs font-semibold text-text tabular-nums">{value}</p>
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
  summaryStrip,
  summaryCollapsed,
  onToggleSummaryCollapse,
  onOpenSummaryDetail,
  focusMetric,
  onToggleFocusMetric,
  modeKpis,
  templatesInUse,
  activeCampaignCount,
  chartPrimaryData,
  chartBaselineData,
}: EmailPerformanceSectionProps) {
  return (
    <section className="rounded-xl border border-border bg-surface p-2.5 md:p-3" data-component="dashboard-email-performance">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-text">Email Performance</h3>
          <p className="text-xs text-text-muted">AI outreach performance by timeframe</p>
        </div>
        <div className="flex items-center gap-1.5">
          <PerformanceModeToggle value={performanceMode} onChange={onChangeMode} />
          <TimeframeToggle value={timeframe} onChange={onChangeTimeframe} />
        </div>
      </div>

      {!hasCampaigns ? (
        <div className="mb-1.5 rounded-md border border-dashed border-border/70 bg-bg/40 px-2 py-1.5 text-xs text-text-muted">
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
      ) : (
        <CampaignSummaryStrip
          mode={performanceMode}
          summary={summaryStrip}
          collapsed={summaryCollapsed}
          onToggleCollapse={onToggleSummaryCollapse}
          onOpenDetail={onOpenSummaryDetail}
        />
      )}

      <div className="mb-1.5 grid grid-cols-2 gap-1.5 md:grid-cols-5">
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
        <div className="rounded-md border border-border bg-bg p-1.5">
          <p className="text-[10px] text-text-muted">Reply Rate</p>
          <p className="text-xs font-semibold text-text tabular-nums">{formatPercent(modeKpis.windowReplyRate)}</p>
        </div>
        <div className="rounded-md border border-border bg-bg p-1.5">
          <p className="text-[10px] text-text-muted">
            {performanceMode === 'template' ? 'Templates in Use' : 'Active Campaigns'}
          </p>
          <p className="text-xs font-semibold text-text tabular-nums">
            {performanceMode === 'template' ? templatesInUse : activeCampaignCount}
          </p>
        </div>
      </div>

      {chartPrimaryData.length > 1 ? (
        <div className="h-32">
          <MiniLineChart
            data={chartPrimaryData}
            secondaryData={chartBaselineData}
            focusMetric={focusMetric}
            compact
            hideLegend
          />
        </div>
      ) : (
        <p className="text-xs text-text-muted">Send campaigns to generate performance trends.</p>
      )}
    </section>
  );
}
