import { useState } from 'react';
import { Mail, ArrowRight } from 'lucide-react';
import type { EmailCampaign } from '../../types/email';
import { BaseModal } from '../shared/BaseModal';

type CampaignModalProps = {
  campaign?: EmailCampaign;
  onClose: () => void;
  onSave: (data: Partial<EmailCampaign>) => void;
};

export function CampaignModal({ campaign, onClose, onSave }: CampaignModalProps) {
  const [name, setName] = useState(campaign?.name || '');
  const [description, setDescription] = useState(campaign?.description || '');
  const [numEmails, setNumEmails] = useState(campaign?.num_emails || 3);
  const [daysBetween, setDaysBetween] = useState(campaign?.days_between_emails || 3);
  const [activeStep, setActiveStep] = useState(1);

  const updateNumEmails = (n: number) => {
    setNumEmails(n);
    if (activeStep > n) setActiveStep(n);
  };

  return (
    <BaseModal
      title={campaign ? 'Edit Campaign' : 'Create Campaign'}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <>
          <button onClick={onClose} className="hidden md:block px-4 py-2 text-text-muted hover:text-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onSave({ name, description, num_emails: numEmails, days_between_emails: daysBetween })}
            disabled={!name}
            className="w-full md:w-auto px-6 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {campaign ? 'Save Changes' : 'Create Campaign'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text mb-2">Campaign Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Q1 Outreach"
            className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-2">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description of this campaign..."
            rows={2}
            className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent resize-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text mb-2">Number of Emails</label>
          <select
            value={numEmails}
            onChange={e => updateNumEmails(Number(e.target.value))}
            className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          >
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <option key={n} value={n}>{n} email{n > 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-2">Days Between Emails</label>
          <select
            value={daysBetween}
            onChange={e => setDaysBetween(Number(e.target.value))}
            className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
          >
            {[1, 2, 3, 4, 5, 7, 10, 14].map(n => (
              <option key={n} value={n}>{n} day{n > 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-bg rounded-lg p-4">
        <label className="block text-sm font-medium text-text mb-3">Email Sequence</label>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {Array.from({ length: numEmails }).map((_, i) => (
            <div key={i} className="flex items-center">
              <div className={`flex flex-col items-center px-4 py-2 rounded-lg min-w-[80px] border ${
                activeStep === i + 1 ? 'bg-indigo-50 border-accent' : 'bg-surface border-border'
              }`}>
                <Mail className={`w-5 h-5 mb-1 ${activeStep === i + 1 ? 'text-accent' : 'text-text-dim'}`} />
                <span className={`text-xs font-medium ${activeStep === i + 1 ? 'text-accent' : 'text-text'}`}>
                  Email {i + 1}
                </span>
                <span className="text-xs text-text-dim">
                  {i === 0 ? 'Day 0' : `Day ${i * daysBetween}`}
                </span>
              </div>
              {i < numEmails - 1 && (
                <ArrowRight className="w-4 h-4 text-text-dim mx-1 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    </BaseModal>
  );
}
