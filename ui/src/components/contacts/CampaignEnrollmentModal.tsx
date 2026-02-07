import { Mail } from 'lucide-react';
import type { EmailCampaign } from '../../api';
import { BaseModal } from '../shared/BaseModal';

type CampaignEnrollmentModalProps = {
  campaigns: EmailCampaign[];
  selectedCount: number;
  onEnroll: (campaignId: number) => void;
  onClose: () => void;
  isEnrolling: boolean;
};

export function CampaignEnrollmentModal({
  campaigns,
  selectedCount,
  onEnroll,
  onClose,
  isEnrolling,
}: CampaignEnrollmentModalProps) {
  return (
    <BaseModal
      title="Enroll in Email Campaign"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <button onClick={onClose} className="px-4 py-2.5 md:py-2 text-text-muted hover:text-text transition-colors">
          Cancel
        </button>
      }
    >
      <p className="text-sm text-text-muted">
        Select a campaign to enroll {selectedCount} contact{selectedCount > 1 ? 's' : ''} in:
      </p>
      {campaigns.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <Mail className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>No campaigns available</p>
          <p className="text-sm mt-1">Create a campaign in the Email tab first</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {campaigns.map((campaign) => (
            <button
              key={campaign.id}
              onClick={() => onEnroll(campaign.id)}
              disabled={isEnrolling}
              className="w-full text-left px-4 py-3 bg-bg hover:bg-surface-hover rounded-lg transition-colors disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-text">{campaign.name}</p>
                  <p className="text-xs text-text-muted">
                    {campaign.num_emails} emails &bull; {campaign.days_between_emails} days apart
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                    campaign.status === 'active'
                      ? 'bg-green-50 text-green-700'
                      : campaign.status === 'paused'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {campaign.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </BaseModal>
  );
}
