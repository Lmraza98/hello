import { useState } from 'react';
import type { EmailCampaign } from '../../types/email';
import { BaseModal } from '../shared/BaseModal';

type TemplateEditorModalProps = {
  campaign: EmailCampaign;
  onClose: () => void;
  onSave: (templates: Array<{ step_number: number; subject_template: string; body_template: string }>) => void;
};

export function TemplateEditorModal({ campaign, onClose, onSave }: TemplateEditorModalProps) {
  const [activeStep, setActiveStep] = useState(1);
  const [templates, setTemplates] = useState<Array<{ subject: string; body: string }>>(() => {
    const t: Array<{ subject: string; body: string }> = [];
    for (let i = 0; i < campaign.num_emails; i++) {
      const existing = campaign.templates?.find(tmpl => tmpl.step_number === i + 1);
      t.push({
        subject: existing?.subject_template || `Follow up - {company}`,
        body: existing?.body_template || `Hi {name},\n\nJust following up on my previous email.\n\n{personalization}\n\nBest regards`
      });
    }
    return t;
  });

  const stepTabs = (
    <div className="flex items-center gap-1 md:gap-1.5 overflow-x-auto w-full sm:w-auto">
      {Array.from({ length: campaign.num_emails }).map((_, i) => (
        <button
          key={i}
          onClick={() => setActiveStep(i + 1)}
          className={`px-2.5 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
            activeStep === i + 1
              ? 'bg-accent text-white'
              : 'bg-surface-hover text-text-muted hover:text-text'
          }`}
        >
          Email {i + 1}
        </button>
      ))}
    </div>
  );

  return (
    <BaseModal
      title={`Templates — ${campaign.name}`}
      onClose={onClose}
      maxWidth="max-w-4xl"
      headerExtra={stepTabs}
      footer={
        <>
          <button onClick={onClose} className="hidden md:block px-4 py-2 text-text-muted hover:text-text transition-colors">
            Cancel
          </button>
          <button
            onClick={() => {
              const formatted = templates.map((t, i) => ({
                step_number: i + 1,
                subject_template: t.subject,
                body_template: t.body
              }));
              onSave(formatted);
            }}
            className="w-full md:w-auto px-6 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Save Templates
          </button>
        </>
      }
    >
      <div className="bg-bg rounded-lg p-3 text-sm text-text-muted">
        <strong className="text-text">Variables:</strong> Use <code className="bg-surface-hover px-1.5 py-0.5 rounded text-xs">{'{name}'}</code>,{' '}
        <code className="bg-surface-hover px-1.5 py-0.5 rounded text-xs">{'{company}'}</code>,{' '}
        <code className="bg-surface-hover px-1.5 py-0.5 rounded text-xs">{'{title}'}</code>,{' '}
        <code className="bg-surface-hover px-1.5 py-0.5 rounded text-xs">{'{personalization}'}</code> in your templates.
      </div>

      <div>
        <label className="block text-sm font-medium text-text mb-2">Subject Line</label>
        <input
          type="text"
          value={templates[activeStep - 1]?.subject || ''}
          onChange={e => {
            const newTemplates = [...templates];
            newTemplates[activeStep - 1] = { ...newTemplates[activeStep - 1], subject: e.target.value };
            setTemplates(newTemplates);
          }}
          placeholder="e.g., Quick question for {company}"
          className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text mb-2">Email Body</label>
        <textarea
          value={templates[activeStep - 1]?.body || ''}
          onChange={e => {
            const newTemplates = [...templates];
            newTemplates[activeStep - 1] = { ...newTemplates[activeStep - 1], body: e.target.value };
            setTemplates(newTemplates);
          }}
          placeholder="Write your email template..."
          rows={12}
          className="w-full px-4 py-3 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent resize-none font-mono text-sm"
        />
      </div>
    </BaseModal>
  );
}
