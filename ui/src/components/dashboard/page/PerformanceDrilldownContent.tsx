import type { EntityAggregate } from './performanceUtils';

type UsageItem = {
  name: string;
  sent: number;
  replyRate: number;
};

type PerformanceDrilldownContentProps = {
  panelEntity: EntityAggregate | null;
  panelEntityType: 'campaign' | 'template';
  panelTemplateUsage: UsageItem[];
  panelCampaignUsage: UsageItem[];
  onSelectTemplate: (templateName: string) => void;
  onSelectCampaign: (campaignName: string) => void;
  onOpenEmailCampaigns: () => void;
};

export function PerformanceDrilldownContent({
  panelEntity,
  panelEntityType,
  panelTemplateUsage,
  panelCampaignUsage,
  onSelectTemplate,
  onSelectCampaign,
  onOpenEmailCampaigns,
}: PerformanceDrilldownContentProps) {
  if (!panelEntity) {
    return <p className="text-xs text-text-muted">No details available for this selection.</p>;
  }

  return (
    <div className="space-y-3" data-component="dashboard-performance-drilldown">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <p className="text-[10px] text-text-muted">Sent</p>
          <p className="text-sm font-semibold text-text tabular-nums">{panelEntity.sent}</p>
        </div>
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <p className="text-[10px] text-text-muted">Replies</p>
          <p className="text-sm font-semibold text-text tabular-nums">{panelEntity.responded}</p>
        </div>
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <p className="text-[10px] text-text-muted">Reply Rate</p>
          <p className="text-sm font-semibold text-text tabular-nums">{panelEntity.replyRate.toFixed(1)}%</p>
        </div>
      </div>

      {panelEntityType === 'campaign' ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-dim">Template Usage</h4>
          {panelTemplateUsage.length > 0 ? (
            <div className="space-y-1.5">
              {panelTemplateUsage.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onSelectTemplate(item.name)}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-2 py-1.5 text-left hover:bg-surface-hover"
                >
                  <span className="truncate text-xs text-text">{item.name}</span>
                  <span className="text-[11px] text-text-muted">{item.replyRate.toFixed(1)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No template usage in this window.</p>
          )}
        </div>
      ) : (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-dim">Campaigns Using Template</h4>
          {panelCampaignUsage.length > 0 ? (
            <div className="space-y-1.5">
              {panelCampaignUsage.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onSelectCampaign(item.name)}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-2 py-1.5 text-left hover:bg-surface-hover"
                >
                  <span className="truncate text-xs text-text">{item.name}</span>
                  <span className="text-[11px] text-text-muted">{item.replyRate.toFixed(1)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No campaign usage in this window.</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenEmailCampaigns}
        className="text-xs font-medium text-accent hover:text-accent-hover"
      >
        Open Email Campaigns
      </button>
    </div>
  );
}
