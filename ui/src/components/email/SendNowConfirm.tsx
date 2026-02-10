import { Send, Loader2, ExternalLink } from 'lucide-react';
import type { ScheduledEmail } from '../../types/email';

type SendNowConfirmProps = {
  email: ScheduledEmail;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SendNowConfirm({ email, isSending, onConfirm, onCancel }: SendNowConfirmProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-surface rounded-xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <Send className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text">Send Now via Salesforce?</h2>
              <p className="text-xs text-text-muted">This will open Salesforce automation to deliver this email</p>
            </div>
          </div>
        </div>

        {/* Email details */}
        <div className="px-5 pb-4">
          <div className="bg-bg rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-text">{email.contact_name}</p>
                <p className="text-xs text-text-muted">{email.contact_title} @ {email.company_name}</p>
              </div>
              <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">
                {email.campaign_name} &middot; Email {email.step_number}
              </span>
            </div>
            <div className="border-t border-border pt-2">
              <p className="text-xs text-text-muted mb-0.5">To: {email.contact_email}</p>
              <p className="text-xs text-text-muted">Subject: <span className="text-text">{email.rendered_subject || email.subject}</span></p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 px-1 text-[10px] text-text-dim">
            <ExternalLink className="w-3 h-3" />
            A Salesforce browser window will open to send this email
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border bg-bg">
          <button
            onClick={onCancel}
            disabled={isSending}
            className="flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium text-text hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSending}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Launching...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Now
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
