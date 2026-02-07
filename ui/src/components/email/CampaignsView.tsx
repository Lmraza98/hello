import { useState } from 'react';
import { Mail, Plus } from 'lucide-react';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { CampaignCard } from './CampaignCard';
import type { EmailCampaign } from '../../types/email';

type CampaignsViewProps = {
  campaigns: EmailCampaign[];
  isLoading: boolean;
  onCreateCampaign: () => void;
  onEditTemplates: (campaign: EmailCampaign) => void;
  onDelete: (campaignId: number) => void;
  onActivate: (campaignId: number) => void;
  onPause: (campaignId: number) => void;
  onViewContacts: () => void;
  onSendEmails: (campaignId: number) => void;
  onUploadToSalesforce: (campaignId: number) => void;
  uploadingCampaignId: number | null;
};

export function CampaignsView({
  campaigns,
  isLoading,
  onCreateCampaign,
  onEditTemplates,
  onDelete,
  onActivate,
  onPause,
  onViewContacts,
  onSendEmails,
  onUploadToSalesforce,
  uploadingCampaignId
}: CampaignsViewProps) {
  const [deleteId, setDeleteId] = useState<number | null>(null);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12 md:py-20">
        <Mail className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-3 md:mb-4 text-text-dim opacity-50" />
        <h3 className="text-base md:text-lg font-medium text-text mb-2">No campaigns yet</h3>
        <p className="text-xs md:text-sm text-text-muted mb-3 md:mb-4 px-4">Create your first email campaign to get started</p>
        <button
          onClick={onCreateCampaign}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Campaign
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {campaigns.map(campaign => (
          <CampaignCard
            key={campaign.id}
            campaign={campaign}
            onEditTemplates={() => onEditTemplates(campaign)}
            onDelete={() => setDeleteId(campaign.id)}
            onActivate={() => onActivate(campaign.id)}
            onPause={() => onPause(campaign.id)}
            onViewContacts={onViewContacts}
            onSendEmails={() => onSendEmails(campaign.id)}
            onUploadToSalesforce={() => onUploadToSalesforce(campaign.id)}
            isUploading={uploadingCampaignId === campaign.id}
          />
        ))}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete campaign?"
        message="This campaign and all its email data will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteId !== null) onDelete(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}
