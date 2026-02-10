import { useState, useCallback, useMemo } from 'react';
import { api, type ReplyPreview } from '../api';
import { useDashboard } from '../hooks/useDashboard';
import { useToasts } from '../hooks/useToasts';
import { useDerivedDashboardData } from '../hooks/useDerivedDashboardData';
import { useAlerts } from '../hooks/useAlerts';
import { useChat } from '../hooks/useChat';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { ConnectionStatus } from '../components/dashboard/ConnectionStatus';
import { ConversationPanel } from '../components/dashboard/ConversationPanel';
import { ToastContainer } from '../components/dashboard/Toast';
import { ChatContainer } from '../components/chat/ChatContainer';
import { BrowserViewer } from '../components/chat/BrowserViewer';
import { SectionBar } from '../components/chat/SectionBar';
import type { DashboardDataBridge } from '../types/chat';

/* ── Main Dashboard ────────────────────────────────────── */

export default function Dashboard() {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ReplyPreview | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set());

  const {
    stats, emailStats, todaysContacts, scheduledEmails,
    clearTodaysContacts, outlookAuthFlow,
    connectOutlook, connectOutlookLoading, disconnectOutlook, cancelOutlookAuth,
    pollReplies, pollRepliesLoading, markConversationHandled,
  } = useDashboard();

  const { toasts, addToast, dismissToast } = useToasts();

  const {
    replyRate,
    meetingRate,
    activeConversations,
    daily,
    recentReplies,
    outlookConnected,
    nextSends,
  } = useDerivedDashboardData(emailStats, scheduledEmails);

  const {
    messages,
    isTyping,
    sendMessage,
    handleAction,
    handleSectionClick,
    browserViewerOpen,
    closeBrowserViewer,
    salesforceSaveUrl,
    salesforceSearch,
    salesforceSkip,
    backgroundTasks,
  } = useChat({
    recentReplies,
    stats,
    emailStats,
    onBrowserViewerOpen: () => {},
    onBrowserViewerClose: () => {},
  });

  const { alerts, markSeen } = useAlerts({
    recentReplies,
    nextSends,
    todaysContacts,
    daily,
    backgroundTasks,
  });

  const handleMarkDone = useCallback(async (replyId: number) => {
    setRemovingIds((prev) => new Set(prev).add(replyId));
    if (selectedConversation?.reply_id === replyId) {
      setSelectedConversation(null);
    }
    try {
      await markConversationHandled(replyId);
      addToast('Conversation marked as handled');
    } catch {
      addToast('Failed to mark as handled', 'info');
    }
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(replyId);
        return next;
      });
    }, 400);
  }, [markConversationHandled, addToast, selectedConversation]);

  /* ── Dashboard data bridge (live data for embedded components) ── */
  const dashboardData: DashboardDataBridge = useMemo(() => ({
    stats: stats ?? null,
    replyRate,
    meetingRate,
    activeConversations,
    recentReplies,
    outlookConnected,
    pollReplies,
    pollRepliesLoading,
    disconnectOutlook,
    onSelectConversation: setSelectedConversation,
    onMarkDone: handleMarkDone,
    removingIds: Array.from(removingIds),
    nextSends,
    totalScheduled: scheduledEmails?.length ?? 0,
    daily,
    todaysContacts,
    onExportContacts: () => api.exportContacts(true),
    onClearContacts: () => setShowClearConfirm(true),
    outlookAuthFlow,
    connectOutlook,
    connectOutlookLoading,
    cancelOutlookAuth,
  }), [
    stats, replyRate, meetingRate, activeConversations,
    recentReplies, outlookConnected, pollReplies, pollRepliesLoading,
    disconnectOutlook, handleMarkDone, removingIds,
    nextSends, scheduledEmails, daily, todaysContacts,
    outlookAuthFlow, connectOutlook, connectOutlookLoading, cancelOutlookAuth,
  ]);

  /* ── Section bar badges ── */
  const sectionBadges = useMemo(() => ({
    conversations: activeConversations > 0 ? activeConversations : undefined,
    scheduled: nextSends.length > 0 ? nextSends.length : undefined,
    contacts: todaysContacts.length > 0 ? todaysContacts.length : undefined,
    emailDays: daily.length > 0 ? daily.length : undefined,
  }), [activeConversations, nextSends.length, todaysContacts.length, daily.length]);

  const handleSectionClickWithAlerts = useCallback((section: string) => {
    markSeen(section);
    handleSectionClick(section);
  }, [markSeen, handleSectionClick]);

  return (
    <div className="flex h-full max-w-7xl flex-col p-4 md:p-6">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg md:text-xl font-semibold text-text">Dashboard</h1>
        <ConnectionStatus />
      </div>

      {/* Browser Viewer (shown above chat when active) */}
      {browserViewerOpen && (
        <div className="mb-2">
          <BrowserViewer isOpen={browserViewerOpen} onClose={closeBrowserViewer} />
        </div>
      )}

      {/* Chat — takes all remaining space */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatContainer
          messages={messages}
          isTyping={isTyping}
          onSendMessage={sendMessage}
          onAction={handleAction}
          onSalesforceSaveUrl={salesforceSaveUrl}
          onSalesforceSearch={salesforceSearch}
          onSalesforceSkip={salesforceSkip}
          dashboardData={dashboardData}
          sectionBar={
            <SectionBar
              onSectionClick={handleSectionClickWithAlerts}
              badges={sectionBadges}
              alerts={alerts}
            />
          }
        />
      </div>

      {/* Conversation Side Panel */}
      {selectedConversation && (
        <ConversationPanel
          reply={selectedConversation}
          onClose={() => setSelectedConversation(null)}
          onMarkDone={(replyId) => {
            handleMarkDone(replyId);
            setSelectedConversation(null);
          }}
        />
      )}

      {/* Toast notifications */}
      <ToastContainer messages={toasts} onDismiss={dismissToast} />

      {/* Confirm dialog */}
      <ConfirmDialog
        open={showClearConfirm}
        title="Clear today's contacts?"
        message="All contacts scraped today will be permanently deleted."
        confirmLabel="Clear"
        variant="danger"
        onConfirm={async () => {
          await clearTodaysContacts();
          setShowClearConfirm(false);
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
}
