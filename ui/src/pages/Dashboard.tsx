import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Mail, MessageCircle, Users } from 'lucide-react';
import type { ReplyPreview } from '../api';
import type { EmailCampaign, SentEmail } from '../types/email';
import { useDashboard } from '../hooks/useDashboard';
import { useDerivedDashboardData } from '../hooks/useDerivedDashboardData';
import { useToasts } from '../hooks/useToasts';
import { ConversationPanel } from '../components/dashboard/ConversationPanel';
import { ToastContainer } from '../components/dashboard/Toast';
import { usePageContext } from '../contexts/PageContextProvider';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';
import { getOllamaReadyFast } from '../chat/ollamaStatus';
import { SystemStatusStrip } from '../components/dashboard/page/SystemStatusStrip';
import { type Timeframe } from '../components/dashboard/page/TimeframeToggle';
import { type PerformanceMode } from '../components/dashboard/page/PerformanceModeToggle';
import { SlideOverPanel } from '../components/dashboard/page/SlideOverPanel';
import { EmailPerformanceSection } from '../components/dashboard/page/EmailPerformanceSection';
import { PerformanceDrilldownContent } from '../components/dashboard/page/PerformanceDrilldownContent';
import { DashboardStatsGrid } from '../components/dashboard/page/DashboardStatsGrid';
import { DashboardWorkspaceGrid } from '../components/dashboard/page/DashboardWorkspaceGrid';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import {
  aggregateEntities,
  buildDailyForEntity,
  buildDailyWindow,
  calculateReplyRate,
  formatDelta,
  formatPercent,
  inLastDays,
  normalizeTemplateName,
} from '../components/dashboard/page/performanceUtils';

export default function Dashboard() {
  const router = useRouter();
  const { setPageContext } = usePageContext();
  const [selectedConversation, setSelectedConversation] = useState<ReplyPreview | null>(null);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>('overall');
  const [focusMetric, setFocusMetric] = useState<'sent' | 'viewed' | 'responded' | null>(null);
  const [selectedEntityKey, setSelectedEntityKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelEntityType, setPanelEntityType] = useState<'campaign' | 'template'>('campaign');
  const [timeframe, setTimeframe] = useState<Timeframe>(30);
  useRegisterCapabilities(getPageCapability('dashboard'));
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set());
  const { toasts, addToast, dismissToast } = useToasts();

  const {
    stats,
    emailStats,
    todaysContacts,
    scheduledEmails,
    campaigns,
    sentEmails,
    pipelineStatus,
    pollReplies,
    pollRepliesLoading,
    disconnectOutlook,
    markConversationHandled,
  } = useDashboard();

  const {
    replyRate,
    activeConversations,
    daily,
    recentReplies,
    outlookConnected,
    nextSends,
  } = useDerivedDashboardData(emailStats, scheduledEmails);

  const totalScheduled = scheduledEmails?.length ?? 0;
  const aiReady = getOllamaReadyFast();

  const filteredDaily = useMemo(() => buildDailyWindow(daily, timeframe), [daily, timeframe]);
  const current7 = useMemo(() => daily.slice(-7), [daily]);
  const previous7 = useMemo(() => daily.slice(-14, -7), [daily]);

  const replyRateDelta = useMemo(() => {
    const current = calculateReplyRate(current7);
    const previous = calculateReplyRate(previous7);
    if (current === null || previous === null) return '--';
    return formatDelta(current - previous);
  }, [current7, previous7]);

  const emailKpis = useMemo(() => {
    const sent = filteredDaily.reduce((sum, point) => sum + point.sent, 0);
    const viewed = filteredDaily.reduce((sum, point) => sum + point.viewed, 0);
    const responded = filteredDaily.reduce((sum, point) => sum + point.responded, 0);
    const windowReplyRate = sent > 0 ? (responded / sent) * 100 : 0;
    return { sent, viewed, responded, windowReplyRate };
  }, [filteredDaily]);

  const campaignAggregates = useMemo(
    () => aggregateEntities(sentEmails as SentEmail[], 'campaign', timeframe),
    [sentEmails, timeframe]
  );
  const templateAggregates = useMemo(
    () => aggregateEntities(sentEmails as SentEmail[], 'template', timeframe),
    [sentEmails, timeframe]
  );

  const activeAggregates = performanceMode === 'template' ? templateAggregates : campaignAggregates;
  const topSummaryEntity = activeAggregates[0] || null;
  const selectedAggregate =
    performanceMode === 'overall'
      ? null
      : activeAggregates.find((item) => item.key === selectedEntityKey) || topSummaryEntity || null;
  const chartPrimaryData = useMemo(
    () =>
      performanceMode === 'overall'
        ? filteredDaily
        : buildDailyForEntity(filteredDaily, selectedAggregate),
    [filteredDaily, performanceMode, selectedAggregate]
  );
  const templatesInUse = useMemo(
    () => new Set((sentEmails as SentEmail[]).map((email) => normalizeTemplateName(email))).size,
    [sentEmails]
  );
  const activeCampaignCount = useMemo(
    () => (campaigns as EmailCampaign[]).filter((item) => item.status === 'active').length,
    [campaigns]
  );
  const modeKpis = useMemo(() => {
    if (performanceMode === 'overall') {
      return {
        sent: emailKpis.sent,
        viewed: emailKpis.viewed,
        responded: emailKpis.responded,
        windowReplyRate: emailKpis.windowReplyRate,
      };
    }
    const current = selectedAggregate || topSummaryEntity;
    if (!current) return { sent: 0, viewed: 0, responded: 0, windowReplyRate: 0 };
    return {
      sent: current.sent,
      viewed: current.viewed,
      responded: current.responded,
      windowReplyRate: current.replyRate,
    };
  }, [emailKpis, performanceMode, selectedAggregate, topSummaryEntity]);
  const panelSource = panelEntityType === 'template' ? templateAggregates : campaignAggregates;
  const panelEntity = panelSource.find((item) => item.key === selectedEntityKey) || null;
  const panelTemplateUsage = useMemo(() => {
    if (!panelEntity || panelEntityType !== 'campaign') return [];
    const byTemplate = new Map<string, { sent: number; replied: number }>();
    (sentEmails as SentEmail[])
      .filter((email) => String(email.campaign_id) === panelEntity.key && inLastDays(email.sent_at, timeframe))
      .forEach((email) => {
        const key = normalizeTemplateName(email);
        const current = byTemplate.get(key) || { sent: 0, replied: 0 };
        current.sent += 1;
        current.replied += email.replied ? 1 : 0;
        byTemplate.set(key, current);
      });
    return Array.from(byTemplate.entries())
      .map(([name, value]) => ({
        name,
        sent: value.sent,
        replyRate: value.sent ? (value.replied / value.sent) * 100 : 0,
      }))
      .sort((a, b) => b.replyRate - a.replyRate)
      .slice(0, 6);
  }, [panelEntity, panelEntityType, sentEmails, timeframe]);
  const panelCampaignUsage = useMemo(() => {
    if (!panelEntity || panelEntityType !== 'template') return [];
    const byCampaign = new Map<string, { sent: number; replied: number }>();
    (sentEmails as SentEmail[])
      .filter((email) => {
        const templateName = normalizeTemplateName(email);
        return `${templateName}::${email.step_number}` === panelEntity.key && inLastDays(email.sent_at, timeframe);
      })
      .forEach((email) => {
        const key = email.campaign_name || `Campaign ${email.campaign_id}`;
        const current = byCampaign.get(key) || { sent: 0, replied: 0 };
        current.sent += 1;
        current.replied += email.replied ? 1 : 0;
        byCampaign.set(key, current);
      });
    return Array.from(byCampaign.entries())
      .map(([name, value]) => ({
        name,
        sent: value.sent,
        replyRate: value.sent ? (value.replied / value.sent) * 100 : 0,
      }))
      .sort((a, b) => b.replyRate - a.replyRate)
      .slice(0, 6);
  }, [panelEntity, panelEntityType, sentEmails, timeframe]);

  const handleMarkDone = async (replyId: number) => {
    setRemovingIds((prev) => new Set(prev).add(replyId));
    if (selectedConversation?.reply_id === replyId) {
      setSelectedConversation(null);
    }
    try {
      await markConversationHandled(replyId);
      addToast('Conversation marked as handled');
    } catch {
      addToast('Failed to mark as handled', 'info');
    } finally {
      setTimeout(() => {
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(replyId);
          return next;
        });
      }, 300);
    }
  };

  const statItems = useMemo(() => {
    // TODO: Replace placeholder deltas with API-backed trend values when available.
    return [
      {
        label: 'Companies',
        value: stats?.total_companies ?? 0,
        delta: '--',
        icon: Building2,
        onClick: () => router.push('/contacts'),
      },
      {
        label: 'Contacts',
        value: stats?.total_contacts ?? 0,
        delta: '--',
        icon: Users,
        onClick: () => router.push('/contacts'),
      },
      {
        label: 'Reply Rate',
        value: formatPercent(replyRate),
        delta: replyRateDelta,
        icon: Mail,
        onClick: () => router.push('/email?view=history'),
      },
      {
        label: 'Active Conversations',
        value: activeConversations,
        delta: '--',
        icon: MessageCircle,
        onClick: () => router.push('/email?view=review'),
      },
    ];
  }, [
    activeConversations,
    router,
    replyRate,
    replyRateDelta,
    stats?.total_companies,
    stats?.total_contacts,
  ]);

  const systemStatusItems = useMemo(() => {
    const scraperTone: 'good' | 'unknown' = pipelineStatus?.running ? 'good' : 'unknown';
    return [
      { key: 'ai' as const, state: aiReady ? 'Online' : 'Degraded', tone: aiReady ? 'good' as const : 'warn' as const },
      { key: 'linkedin' as const, state: 'Unknown', tone: 'unknown' as const },
      { key: 'smtp' as const, state: outlookConnected ? 'Healthy' : 'Issue', tone: outlookConnected ? 'good' as const : 'warn' as const },
      {
        key: 'scraper' as const,
        state: pipelineStatus ? (pipelineStatus.running ? 'Running' : 'Idle') : 'Unknown',
        tone: scraperTone,
      },
    ];
  }, [aiReady, outlookConnected, pipelineStatus]);

  useEffect(() => {
    setPageContext({ listContext: 'dashboard' });
  }, [setPageContext]);

  useEffect(() => {
    if (performanceMode === 'overall') return;
    if (!selectedEntityKey && topSummaryEntity) {
      setSelectedEntityKey(topSummaryEntity.key);
      return;
    }
    const exists = activeAggregates.some((item) => item.key === selectedEntityKey);
    if (!exists) {
      setSelectedEntityKey(topSummaryEntity?.key || null);
    }
  }, [activeAggregates, performanceMode, selectedEntityKey, topSummaryEntity]);

  return (
    <WorkspacePageShell
      title="Dashboard"
      subtitle={`${stats?.total_companies ?? 0} companies - ${stats?.total_contacts ?? 0} contacts`}
      stickyHeader={false}
    >
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <div className="shrink-0">
          <SystemStatusStrip items={systemStatusItems} />
          <DashboardStatsGrid items={statItems} />
          <EmailPerformanceSection
            performanceMode={performanceMode}
            onChangeMode={(mode) => {
              setPerformanceMode(mode);
              setFocusMetric(null);
            }}
            timeframe={timeframe}
            onChangeTimeframe={setTimeframe}
            hasCampaigns={campaigns.length > 0}
            onCreateCampaign={() => router.push('/email?view=campaigns')}
            focusMetric={focusMetric}
            onToggleFocusMetric={(metric) => setFocusMetric((prev) => (prev === metric ? null : metric))}
            modeKpis={modeKpis}
            templatesInUse={templatesInUse}
            activeCampaignCount={activeCampaignCount}
            chartPrimaryData={chartPrimaryData}
            chartBaselineData={performanceMode === 'overall' ? undefined : filteredDaily}
          />
        </div>
        <div className="min-h-0 flex-1">
          <DashboardWorkspaceGrid
            activeConversations={activeConversations}
            recentReplies={recentReplies}
            outlookConnected={outlookConnected}
            pollReplies={pollReplies}
            pollRepliesLoading={pollRepliesLoading}
            disconnectOutlook={disconnectOutlook}
            onSelectConversation={setSelectedConversation}
            onMarkDone={handleMarkDone}
            removingIds={Array.from(removingIds)}
            todaysContacts={todaysContacts}
            onNavigateCompanies={() => router.push('/contacts')}
            onNavigateEmailHome={() => router.push('/email')}
            onNavigateEmailScheduled={() => router.push('/email?view=scheduled')}
            nextSends={nextSends}
            totalScheduled={totalScheduled}
          />
        </div>
      </div>
      <SlideOverPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={panelEntity?.label || (panelEntityType === 'template' ? 'Template' : 'Campaign')}
        subtitle={panelEntityType === 'template' ? 'Template performance drilldown' : 'Campaign performance drilldown'}
      >
        <PerformanceDrilldownContent
          panelEntity={panelEntity}
          panelEntityType={panelEntityType}
          panelTemplateUsage={panelTemplateUsage}
          panelCampaignUsage={panelCampaignUsage}
          onSelectTemplate={(templateName) => {
            setPerformanceMode('template');
            const match = templateAggregates.find((entry) => entry.label === templateName);
            setSelectedEntityKey(match?.key || null);
            setPanelEntityType('template');
          }}
          onSelectCampaign={(campaignName) => {
            setPerformanceMode('campaign');
            const match = campaignAggregates.find((entry) => entry.label === campaignName);
            setSelectedEntityKey(match?.key || null);
            setPanelEntityType('campaign');
          }}
          onOpenEmailCampaigns={() => router.push('/email?view=campaigns')}
        />
      </SlideOverPanel>

      {selectedConversation ? (
        <ConversationPanel
          reply={selectedConversation}
          onClose={() => setSelectedConversation(null)}
          onMarkDone={(replyId) => void handleMarkDone(replyId)}
        />
      ) : null}

      <ToastContainer messages={toasts} onDismiss={dismissToast} />
    </WorkspacePageShell>
  );
}
