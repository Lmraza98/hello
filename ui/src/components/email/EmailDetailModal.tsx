import { useState, useEffect } from 'react';
import { X, Clock, Send, SkipForward, CheckCircle, Eye, MessageSquare, ExternalLink, CalendarClock } from 'lucide-react';
import { emailApi } from '../../api/emailApi';
import type { EmailDetail, ScheduledEmail } from '../../types/email';

type EmailDetailModalProps = {
  email: ScheduledEmail;
  onClose: () => void;
  onReschedule: (email: ScheduledEmail) => void;
  onSendNow: (emailId: number) => void;
};

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

export function EmailDetailModal({ email, onClose, onReschedule, onSendNow }: EmailDetailModalProps) {
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    emailApi.getEmailDetail(email.id).then(data => {
      setDetail(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [email.id]);

  const subject = detail?.rendered_subject || detail?.subject || email.rendered_subject || email.subject;
  const body = detail?.rendered_body || detail?.body || email.rendered_body || email.body;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base md:text-lg font-semibold text-text">Email Details</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Contact Info */}
              <div className="bg-bg rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm md:text-base font-semibold text-text">{email.contact_name}</h3>
                    <p className="text-xs md:text-sm text-text-muted">{email.contact_title} @ {email.company_name}</p>
                    <p className="text-xs text-text-dim mt-1">{email.contact_email}</p>
                  </div>
                  {email.contact_linkedin && (
                    <a
                      href={email.contact_linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors shrink-0"
                      title="View LinkedIn"
                    >
                      <ExternalLink className="w-4 h-4 text-text-muted" />
                    </a>
                  )}
                </div>
              </div>

              {/* Campaign Context */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="bg-indigo-50 text-accent px-2.5 py-1 rounded-md text-xs font-medium">
                  {email.campaign_name}
                </span>
                <span className="text-xs text-text-muted">
                  Email {email.step_number} of {email.num_emails}
                </span>
              </div>

              {/* Scheduled Time */}
              <div className="flex items-center gap-2 bg-amber-50 px-4 py-2.5 rounded-lg">
                <Clock className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">
                  {formatDateTime(email.scheduled_send_time)}
                </span>
              </div>

              {/* Email Preview */}
              <div className="space-y-2">
                <div>
                  <span className="text-[10px] md:text-xs font-medium text-text-muted uppercase tracking-wider">Subject</span>
                  <p className="text-sm font-medium text-text mt-1">{subject}</p>
                </div>
                <div>
                  <span className="text-[10px] md:text-xs font-medium text-text-muted uppercase tracking-wider">Body</span>
                  <pre className="text-sm text-text mt-1 whitespace-pre-wrap font-sans bg-bg p-3 rounded-lg leading-relaxed">
                    {body}
                  </pre>
                </div>
              </div>

              {/* Sequence History */}
              {detail?.sequence_emails && detail.sequence_emails.length > 0 && (
                <div>
                  <span className="text-[10px] md:text-xs font-medium text-text-muted uppercase tracking-wider">Email Sequence</span>
                  <div className="mt-2 space-y-1.5">
                    {detail.sequence_emails.map(seqEmail => {
                      const isCurrent = seqEmail.id === email.id;
                      const isSent = seqEmail.review_status === 'sent' || seqEmail.status === 'sent';
                      return (
                        <div
                          key={seqEmail.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs md:text-sm ${
                            isCurrent ? 'bg-accent/10 border border-accent/20' : 'bg-bg'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                            isSent ? 'bg-green-100' : isCurrent ? 'bg-accent/20' : 'bg-surface'
                          }`}>
                            {isSent ? (
                              <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <span className={`text-[10px] font-medium ${isCurrent ? 'text-accent' : 'text-text-dim'}`}>
                                {seqEmail.step_number}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={`font-medium ${isCurrent ? 'text-accent' : 'text-text'}`}>
                              Email {seqEmail.step_number}
                            </span>
                            {seqEmail.rendered_subject && (
                              <span className="text-text-muted ml-2 truncate">
                                — {seqEmail.rendered_subject}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isSent && seqEmail.sent_at && (
                              <span className="text-text-dim text-[10px]">
                                {new Date(seqEmail.sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                            {isSent && seqEmail.opened ? (
                              <Eye className="w-3 h-3 text-blue-500" />
                            ) : null}
                            {isSent && seqEmail.replied ? (
                              <MessageSquare className="w-3 h-3 text-green-500" />
                            ) : null}
                            {!isSent && seqEmail.scheduled_send_time && (
                              <span className="text-text-dim text-[10px]">
                                {formatDateTime(seqEmail.scheduled_send_time)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border bg-bg">
          <button
            onClick={() => onReschedule(email)}
            className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs md:text-sm font-medium text-text hover:bg-surface-hover transition-colors"
          >
            <CalendarClock className="w-3.5 h-3.5" />
            Reschedule
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs md:text-sm font-medium text-text hover:bg-surface-hover transition-colors"
            title="Skip this email"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip
          </button>
          <div className="flex-1" />
          <button
            onClick={() => onSendNow(email.id)}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-xs md:text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            Send Now
          </button>
        </div>
      </div>
    </div>
  );
}
