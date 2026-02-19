import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { usePageContext } from '../contexts/PageContextProvider';
import { Mail, Plus, CalendarClock, CheckCircle, FileText, Settings } from 'lucide-react';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useEmailCampaigns } from '../hooks/useEmailCampaigns';
import { CampaignModal } from '../components/email/CampaignModal';
import { TemplateEditorModal } from '../components/email/TemplateEditorModal';
import { CampaignsView } from '../components/email/CampaignsView';
import { ReviewQueueView } from '../components/email/ReviewQueueView';
import { SentEmailsList } from '../components/email/SentEmailsList';
import { ScheduledView } from '../components/email/ScheduledView';
import { SettingsPanel } from '../components/email/SettingsPanel';
import { EmailDetailModal } from '../components/email/EmailDetailModal';
import { SendNowConfirm } from '../components/email/SendNowConfirm';
import { PageHeader } from '../components/shared/PageHeader';
import type { EmailCampaign, ScheduledEmail } from '../types/email';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

/* ── Main Email Page ───────────────────────────────── */

export default function Email({ openAddModal, onModalOpened }: { openAddModal?: boolean; onModalOpened?: () => void }) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { setPageContext } = usePageContext();
  const { addNotification } = useNotificationContext();
  const [view, setView] = useState<'campaigns' | 'review' | 'history' | 'scheduled'>('campaigns');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplates, setEditingTemplates] = useState<EmailCampaign | null>(null);
  const [uploadingCampaignId, setUploadingCampaignId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [viewingEmail, setViewingEmail] = useState<ScheduledEmail | null>(null);
  const [sendNowTarget, setSendNowTarget] = useState<ScheduledEmail | null>(null);
  useRegisterCapabilities(getPageCapability(`email.${view}`));

  const {
    campaigns,
    campaignsLoading,
    sentEmails,
    stats,
    queue,
    reviewQueue,
    allScheduled,
    campaignScheduleSummary,
    emailConfig,
    createCampaign,
    deleteCampaign,
    activateCampaign,
    pauseCampaign,
    saveTemplates,
    sendEmails,
    approveEmail,
    rejectEmail,
    approveAll,
    prepareBatch,
    updateConfig,
    uploadToSalesforce,
    sendEmailNow,
    rescheduleEmail,
    reorderEmails
  } = useEmailCampaigns();

  // Open create modal from sidebar quick-add
  useEffect(() => {
    if (openAddModal) {
      setShowCreateModal(true);
      onModalOpened?.();
    }
  }, [openAddModal, onModalOpened]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextView = params.get('view');
    if (nextView === 'campaigns' || nextView === 'review' || nextView === 'history' || nextView === 'scheduled') {
      setView(nextView);
    }
  }, [location.search]);

  useEffect(() => {
    setPageContext({
      listContext: 'email',
      loadedIds: { campaignIds: campaigns.slice(0, 200).map((c) => c.id) },
    });
  }, [campaigns, setPageContext]);

  const handleCreateCampaign = (data: Partial<EmailCampaign>) => {
    createCampaign.mutate(data);
    setShowCreateModal(false);
  };

  const handleSaveTemplates = (templates: Array<{ step_number: number; subject_template: string; body_template: string }>) => {
    if (editingTemplates) {
      saveTemplates.mutate({ campaignId: editingTemplates.id, templates });
      setEditingTemplates(null);
    }
  };

  const handleUploadToSalesforce = (campaignId: number) => {
    setUploadingCampaignId(campaignId);
    uploadToSalesforce.mutate(campaignId, {
      onSettled: () => setUploadingCampaignId(null)
    });
  };

  // "Send Now" shows a confirmation dialog first
  const handleSendNowRequest = useCallback((emailId: number) => {
    const email = allScheduled.find(e => e.id === emailId);
    if (email) {
      setSendNowTarget(email);
    }
  }, [allScheduled]);

  const handleSendNowConfirm = useCallback(() => {
    if (!sendNowTarget) return;
    sendEmailNow.mutate(sendNowTarget.id);
    setSendNowTarget(null);
    setViewingEmail(null);
  }, [sendNowTarget, sendEmailNow]);

  const handleReschedule = (email: ScheduledEmail) => {
    // Simple reschedule: prompt for new time
    const currentTime = new Date(email.scheduled_send_time);
    const newTimeStr = prompt(
      'Enter new send time (e.g., "2026-02-10 14:30"):',
      currentTime.toLocaleString()
    );
    if (newTimeStr) {
      const parsed = new Date(newTimeStr);
      if (!isNaN(parsed.getTime())) {
        rescheduleEmail.mutate({ emailId: email.id, sendTime: parsed.toISOString() });
      } else {
        addNotification({ type: 'error', title: 'Invalid date format' });
      }
    }
  };

  const handleReorder = (emailIds: number[], startTime?: string) => {
    reorderEmails.mutate({ emailIds, startTime });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="pt-5 px-4 md:pt-8 md:px-8 pb-4 md:pb-8">
        <div className="flex flex-row justify between md:justify-between">
        <PageHeader
        title="Email"
        subtitle={`${stats?.total_campaigns || 0} campaigns � ${stats?.total_sent || 0} sent � ${stats?.sent_today || 0} today`}
        mobileActions={(
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex md:hidden p-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      />

      {/* View Tabs */}
      <div className="flex items-center justify-between gap-1.5 md:gap-2 mb-3 md:mb-6">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
          <div className="flex items-center gap-0.5 md:gap-1 bg-surface border border-border rounded-lg p-0.5 md:p-1 shrink-0">
            {[
              { id: 'campaigns', label: 'Campaigns', icon: Mail, shortLabel: 'All' },
              { id: 'review', label: `Review${reviewQueue.length > 0 ? ` (${reviewQueue.length})` : ''}`, icon: CheckCircle, shortLabel: reviewQueue.length > 0 ? `Review (${reviewQueue.length})` : 'Review' },
              { id: 'scheduled', label: `Scheduled (${allScheduled.length})`, icon: CalendarClock, shortLabel: `Sched (${allScheduled.length})` },
              { id: 'history', label: 'Sent History', icon: FileText, shortLabel: 'Sent' }
            ].map(tab => {
              const Icon = tab.icon;
              const displayLabel = isMobile ? tab.shortLabel : tab.label;
              return (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id as typeof view)}
                  className={`flex items-center gap-1 px-2 md:px-4 py-1 md:py-2 rounded-md text-[11px] md:text-sm font-medium transition-colors whitespace-nowrap ${
                    view === tab.id
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:text-text hover:bg-surface-hover'
                  } ${tab.id === 'review' && reviewQueue.length > 0 && view !== 'review' ? 'text-amber-600' : ''}`}
                >
                  <Icon className="w-3 h-3 md:w-4 md:h-4" />
                  <span>{displayLabel}</span>
                </button>
              );
            })}
          </div>

          {/* Settings gear button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 md:p-2 rounded-md transition-colors shrink-0 ${showSettings ? 'bg-accent text-white' : 'text-text-muted hover:text-text hover:bg-surface-hover'}`}
            title="Email Settings"
          >
            <Settings className="w-3.5 h-3.5 md:w-4 md:h-4" />
          </button>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="hidden md:flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && emailConfig && (
        <SettingsPanel 
          emailConfig={emailConfig} 
          onUpdateConfig={(data) => updateConfig.mutate(data)} 
        />
      )}
      </div>
      </div>
      {/* Content */}
      {view === 'campaigns' && (
        <>
          {/* Next Scheduled Sends Widget */}
          {/* <NextScheduledSends
            scheduledEmails={allScheduled}
            onViewEmail={setViewingEmail}
            onEditEmail={setViewingEmail}
            onSendNow={handleSendNowRequest}
            onViewAll={() => setView('scheduled')}
          /> */}

          <CampaignsView
            campaigns={campaigns}
            campaignScheduleSummary={campaignScheduleSummary}
            isLoading={campaignsLoading}
            onCreateCampaign={() => setShowCreateModal(true)}
            onEditTemplates={setEditingTemplates}
            onDelete={(id) => deleteCampaign.mutate(id)}
            onActivate={(id) => activateCampaign.mutate(id)}
            onPause={(id) => pauseCampaign.mutate(id)}
            onViewContacts={() => {
              addNotification({ type: 'info', title: 'View contacts', message: 'Go to Contacts tab and filter by this campaign' });
            }}
            onSendEmails={(id) => sendEmails.mutate(id)}
            onUploadToSalesforce={handleUploadToSalesforce}
            uploadingCampaignId={uploadingCampaignId}
          />
        </>
      )}

      {view === 'review' && (
        <ReviewQueueView
          reviewQueue={reviewQueue}
          scheduledCount={allScheduled.length}
          onPrepareBatch={() => prepareBatch.mutate()}
          onApproveEmail={(emailId, subject, body) => approveEmail.mutate({ emailId, subject, body })}
          onRejectEmail={(emailId) => rejectEmail.mutate(emailId)}
          onApproveAll={(emailIds) => approveAll.mutate(emailIds)}
          isPreparingBatch={prepareBatch.isPending}
          isApprovingEmail={approveEmail.isPending}
          isRejectingEmail={rejectEmail.isPending}
          isApprovingAll={approveAll.isPending}
        />
      )}

      {view === 'history' && (
        <div className="bg-surface border border-border rounded-lg p-4 md:p-6">
          <h3 className="text-base md:text-lg font-semibold text-text mb-3 md:mb-4">Sent Email History</h3>
          <SentEmailsList emails={sentEmails} />
        </div>
      )}

      {view === 'scheduled' && (
        <ScheduledView
          allScheduled={allScheduled}
          queue={queue}
          onViewEmail={setViewingEmail}
          onEditEmail={setViewingEmail}
          onSendNow={handleSendNowRequest}
          onReschedule={handleReschedule}
          onReorder={handleReorder}
          onSendAll={() => sendEmails.mutate(undefined)}
          isSending={sendEmails.isPending}
        />
      )}

      {/* Modals */}
      {showCreateModal && (
        <CampaignModal
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreateCampaign}
        />
      )}

      {editingTemplates && (
        <TemplateEditorModal
          campaign={editingTemplates}
          onClose={() => setEditingTemplates(null)}
          onSave={handleSaveTemplates}
        />
      )}

      {viewingEmail && (
        <EmailDetailModal
          email={viewingEmail}
          onClose={() => setViewingEmail(null)}
          onReschedule={handleReschedule}
          onSendNow={handleSendNowRequest}
        />
      )}

      {/* Send Now confirmation dialog */}
      {sendNowTarget && (
        <SendNowConfirm
          email={sendNowTarget}
          isSending={sendEmailNow.isPending}
          onConfirm={handleSendNowConfirm}
          onCancel={() => setSendNowTarget(null)}
        />
      )}
    </div>
  );
}
