import { useEffect, useMemo, useState } from 'react';
import { Building2, Mail, MessageCircle, TrendingUp, Users } from 'lucide-react';
import type { ReplyPreview } from '../api';
import { useDashboard } from '../hooks/useDashboard';
import { useDerivedDashboardData } from '../hooks/useDerivedDashboardData';
import { useToasts } from '../hooks/useToasts';
import { ConnectionStatus } from '../components/dashboard/ConnectionStatus';
import { ActiveConversationsCard } from '../components/dashboard/ActiveConversationsCard';
import { ScheduledSendsCard } from '../components/dashboard/ScheduledSendsCard';
import { MiniLineChart } from '../components/dashboard/MiniLineChart';
import { LiveContacts } from '../components/dashboard/LiveContacts';
import { ConversationPanel } from '../components/dashboard/ConversationPanel';
import { ToastContainer } from '../components/dashboard/Toast';
import { StatCard } from '../components/dashboard/StatCard';
import { usePageContext } from '../contexts/PageContextProvider';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

export default function Dashboard() {
  const { setPageContext } = usePageContext();
  const [selectedConversation, setSelectedConversation] = useState<ReplyPreview | null>(null);
  useRegisterCapabilities(getPageCapability('dashboard'));
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set());
  const { toasts, addToast, dismissToast } = useToasts();

  const {
    stats,
    emailStats,
    todaysContacts,
    scheduledEmails,
    pollReplies,
    pollRepliesLoading,
    disconnectOutlook,
    markConversationHandled,
  } = useDashboard();

  const {
    replyRate,
    meetingRate,
    activeConversations,
    daily,
    recentReplies,
    outlookConnected,
    nextSends,
  } = useDerivedDashboardData(emailStats, scheduledEmails);

  const totalScheduled = scheduledEmails?.length ?? 0;

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

  const statItems = useMemo(
    () => [
      { label: 'Companies', value: stats?.total_companies ?? 0, icon: Building2 },
      { label: 'Contacts', value: stats?.total_contacts ?? 0, icon: Users },
      { label: 'Reply Rate %', value: replyRate, icon: Mail },
      { label: 'Active Conversations', value: activeConversations, icon: MessageCircle },
      { label: 'Meeting Rate %', value: meetingRate, icon: TrendingUp },
    ],
    [activeConversations, meetingRate, replyRate, stats?.total_companies, stats?.total_contacts]
  );

  useEffect(() => {
    setPageContext({ listContext: 'dashboard' });
  }, [setPageContext]);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-semibold text-text">Dashboard</h1>
        <ConnectionStatus />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {statItems.map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} icon={item.icon} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-lg p-3">
          <ActiveConversationsCard
            activeConversations={activeConversations}
            recentReplies={recentReplies}
            outlookConnected={outlookConnected}
            pollReplies={pollReplies}
            pollRepliesLoading={pollRepliesLoading}
            disconnectOutlook={disconnectOutlook}
            onSelectConversation={setSelectedConversation}
            onMarkDone={handleMarkDone}
            removingIds={Array.from(removingIds)}
          />
        </div>

        <div className="bg-surface border border-border rounded-lg p-3">
          <ScheduledSendsCard nextSends={nextSends} totalScheduled={totalScheduled} />
        </div>

        <div className="bg-surface border border-border rounded-lg p-3">
          <h3 className="text-sm font-medium text-text mb-2">Email Performance</h3>
          {daily.length > 1 ? (
            <MiniLineChart data={daily} />
          ) : (
            <p className="text-xs text-text-muted">Send campaigns to generate performance trends.</p>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg p-3">
          <h3 className="text-sm font-medium text-text mb-2">Today&apos;s Contacts</h3>
          <LiveContacts contacts={todaysContacts} />
        </div>
      </div>

      {selectedConversation ? (
        <ConversationPanel
          reply={selectedConversation}
          onClose={() => setSelectedConversation(null)}
          onMarkDone={(replyId) => void handleMarkDone(replyId)}
        />
      ) : null}

      <ToastContainer messages={toasts} onDismiss={dismissToast} />
    </div>
  );
}
