import { useMemo, useState } from 'react';
import type { EmailCampaign } from '../../types/email';

type CampaignTemplateEditorPaneProps = {
  campaign: EmailCampaign;
  onClose: () => void;
  onSave: (templates: Array<{ step_number: number; subject_template: string; body_template: string }>) => void;
};

export function CampaignTemplateEditorPane({ campaign, onClose, onSave }: CampaignTemplateEditorPaneProps) {
  const [activeStep, setActiveStep] = useState(1);
  const [templates, setTemplates] = useState<Array<{ subject: string; body: string }>>(() => {
    const t: Array<{ subject: string; body: string }> = [];
    for (let i = 0; i < campaign.num_emails; i++) {
      const existing = campaign.templates?.find((tmpl) => tmpl.step_number === i + 1);
      t.push({
        subject: existing?.subject_template || 'Follow up - {company}',
        body: existing?.body_template || 'Hi {firstName},\n\nJust following up on my previous email.\n\n{personalization}\n\nBest regards',
      });
    }
    return t;
  });

  const current = useMemo(() => templates[activeStep - 1] || { subject: '', body: '' }, [activeStep, templates]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-text">Templates - {campaign.name}</h3>
          <p className="text-xs text-text-muted">Campaign template editor</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover"
        >
          Close
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center gap-1 overflow-x-auto">
          {Array.from({ length: campaign.num_emails }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveStep(i + 1)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeStep === i + 1 ? 'bg-accent text-white' : 'bg-surface-hover text-text-muted hover:text-text'
              }`}
            >
              Email {i + 1}
            </button>
          ))}
        </div>

        <div className="rounded-lg bg-bg p-3 text-xs text-text-muted">
          <strong className="text-text">Variables:</strong> {'{name}'}, {'{firstName}'}, {'{lastName}'}, {'{company}'}, {'{title}'}, {'{industry}'}, {'{location}'}, {'{personalization}'}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-text">Subject Line</label>
          <input
            type="text"
            value={current.subject}
            onChange={(e) => {
              const next = [...templates];
              next[activeStep - 1] = { ...next[activeStep - 1], subject: e.target.value };
              setTemplates(next);
            }}
            placeholder="e.g., Quick question for {company}"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
        </div>

        <div className="min-h-0 flex-1">
          <label className="mb-2 block text-sm font-medium text-text">Email Body</label>
          <textarea
            value={current.body}
            onChange={(e) => {
              const next = [...templates];
              next[activeStep - 1] = { ...next[activeStep - 1], body: e.target.value };
              setTemplates(next);
            }}
            placeholder="Write your email template..."
            rows={14}
            className="h-full min-h-[260px] w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const formatted = templates.map((t, i) => ({
              step_number: i + 1,
              subject_template: t.subject,
              body_template: t.body,
            }));
            onSave(formatted);
          }}
          className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        >
          Save Templates
        </button>
      </div>
    </div>
  );
}
