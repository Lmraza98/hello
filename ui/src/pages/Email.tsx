import { useState, useEffect } from 'react';
import { Mail, Plus, Clock, CheckCircle, FileText, Settings } from 'lucide-react';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useEmailCampaigns } from '../hooks/useEmailCampaigns';
import { CampaignModal } from '../components/email/CampaignModal';
import { TemplateEditorModal } from '../components/email/TemplateEditorModal';
import { CampaignsView } from '../components/email/CampaignsView';
import { ReviewQueueView } from '../components/email/ReviewQueueView';
import { SentEmailsList } from '../components/email/SentEmailsList';
import { QueueView } from '../components/email/QueueView';
import { SettingsPanel } from '../components/email/SettingsPanel';
import type { EmailCampaign } from '../types/email';

/* ── Main Email Page ───────────────────────────────────── */

export default function Email({ openAddModal, onModalOpened }: { openAddModal?: boolean; onModalOpened?: () => void }) {
  const isMobile = useIsMobile();
  const { addNotification } = useNotificationContext();
  const [view, setView] = useState<'campaigns' | 'review' | 'history' | 'queue'>('campaigns');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplates, setEditingTemplates] = useState<EmailCampaign | null>(null);
  const [uploadingCampaignId, setUploadingCampaignId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const {
    campaigns,
    campaignsLoading,
    sentEmails,
    stats,
    queue,
    reviewQueue,
    scheduled,
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
    uploadToSalesforce
  } = useEmailCampaigns();

  // Open create modal from sidebar quick-add
  useEffect(() => {
    if (openAddModal) {
      setShowCreateModal(true);
      onModalOpened?.();
    }
  }, [openAddModal, onModalOpened]);

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

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 md:mb-6 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-text mb-0.5">Email Campaigns</h1>
          <p className="text-xs md:text-sm text-text-muted">
            {stats?.total_campaigns || 0} campaigns • {stats?.total_sent || 0} sent • {stats?.sent_today || 0} today
          </p>
        </div>
        
        {/* Desktop button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="hidden md:flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
        {/* Mobile button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex md:hidden p-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-1 mb-4 md:mb-6 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1 shrink-0">
          {[
            { id: 'campaigns', label: 'Campaigns', icon: Mail, shortLabel: 'All' },
            { id: 'review', label: `Review${reviewQueue.length > 0 ? ` (${reviewQueue.length})` : ''}`, icon: CheckCircle, shortLabel: reviewQueue.length > 0 ? `Review (${reviewQueue.length})` : 'Review' },
            { id: 'history', label: 'Sent History', icon: FileText, shortLabel: 'Sent' },
            { id: 'queue', label: `Queue (${queue.length + scheduled.length})`, icon: Clock, shortLabel: `Queue (${queue.length + scheduled.length})` }
          ].map(tab => {
            const Icon = tab.icon;
            const displayLabel = isMobile ? tab.shortLabel : tab.label;
            return (
              <button
                key={tab.id}
                onClick={() => setView(tab.id as typeof view)}
                className={`flex items-center gap-1.5 px-2.5 md:px-4 py-1.5 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                  view === tab.id
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text hover:bg-surface-hover'
                } ${tab.id === 'review' && reviewQueue.length > 0 && view !== 'review' ? 'text-amber-600' : ''}`}
              >
                <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className={isMobile ? 'text-[11px]' : ''}>{displayLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Settings gear button */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-md transition-colors shrink-0 ${showSettings ? 'bg-accent text-white' : 'text-text-muted hover:text-text hover:bg-surface-hover'}`}
          title="Email Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && emailConfig && (
        <SettingsPanel 
          emailConfig={emailConfig} 
          onUpdateConfig={(data) => updateConfig.mutate(data)} 
        />
      )}

      {/* Content */}
      {view === 'campaigns' && (
        <CampaignsView
          campaigns={campaigns}
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
      )}

      {view === 'review' && (
        <ReviewQueueView
          reviewQueue={reviewQueue}
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

      {view === 'queue' && (
        <QueueView
          queue={queue}
          scheduled={scheduled}
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
    </div>
  );
}
