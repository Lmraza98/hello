import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Check, CheckCircle, Clock, ExternalLink, Loader2, Send, X } from 'lucide-react';
import { emailApi } from '../../api/emailApi';
import type { EmailDetail, ReviewQueueItem, ScheduledEmail, SentEmail } from '../../types/email';
import { LoadingSpinner } from '../shared/LoadingSpinner';

type EmailPanelMode = 'review' | 'scheduled' | 'history';

type EmailDetailsPanelProps = {
  mode: EmailPanelMode;
  email: ReviewQueueItem | ScheduledEmail | SentEmail;
  onClose: () => void;
  onApproveEmail?: (emailId: number, subject?: string, body?: string) => void;
  onRejectEmail?: (emailId: number) => void;
  onSendNow?: (email: ScheduledEmail) => void;
  onReschedule?: (email: ScheduledEmail) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  isSendingNow?: boolean;
  isRescheduling?: boolean;
};

function formatDateTime(value?: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStatusTone(status?: string | null) {
  const value = String(status || '').toLowerCase();
  if (value === 'approved' || value === 'sent') return 'bg-emerald-500/15 text-emerald-700';
  if (value === 'pending' || value === 'queued') return 'bg-amber-500/15 text-amber-700';
  if (value === 'rejected' || value === 'failed') return 'bg-red-500/15 text-red-700';
  return 'bg-accent/10 text-accent';
}

function getSubject(email: ReviewQueueItem | ScheduledEmail | SentEmail, detail: EmailDetail | null | undefined) {
  return detail?.rendered_subject || detail?.subject || email.rendered_subject || email.subject || '';
}

function getBody(email: ReviewQueueItem | ScheduledEmail | SentEmail, detail: EmailDetail | null | undefined) {
  return detail?.rendered_body || detail?.body || email.rendered_body || email.body || '';
}

function getContactTitle(email: ReviewQueueItem | ScheduledEmail | SentEmail, detail: EmailDetail | null | undefined) {
  if ('contact_title' in email && email.contact_title) return email.contact_title;
  return detail?.contact_title || '';
}

function getContactEmail(email: ReviewQueueItem | ScheduledEmail | SentEmail, detail: EmailDetail | null | undefined) {
  if ('contact_email' in email && email.contact_email) return email.contact_email;
  return detail?.contact_email || '';
}

function getContactLinkedIn(email: ReviewQueueItem | ScheduledEmail | SentEmail, detail: EmailDetail | null | undefined) {
  if ('contact_linkedin' in email) return email.contact_linkedin || detail?.contact_linkedin || '';
  return detail?.contact_linkedin || '';
}

function getScheduledEmail(email: ReviewQueueItem | ScheduledEmail | SentEmail): ScheduledEmail | null {
  if ('scheduled_send_time' in email && typeof email.scheduled_send_time === 'string' && 'campaign_contact_id' in email) {
    return email as ScheduledEmail;
  }
  return null;
}

export function EmailDetailsPanel({
  mode,
  email,
  onClose,
  onApproveEmail,
  onRejectEmail,
  onSendNow,
  onReschedule,
  isApproving = false,
  isRejecting = false,
  isSendingNow = false,
  isRescheduling = false,
}: EmailDetailsPanelProps) {
  const detailQuery = useQuery({
    queryKey: ['emailDetail', email.id],
    queryFn: () => emailApi.getEmailDetail(email.id),
  });

  const detail = detailQuery.data;
  const subject = useMemo(() => getSubject(email, detail), [detail, email]);
  const body = useMemo(() => getBody(email, detail), [detail, email]);
  const scheduledEmail = getScheduledEmail(detail || email);
  const [draftSubject, setDraftSubject] = useState(subject);
  const [draftBody, setDraftBody] = useState(body);

  const contactTitle = getContactTitle(email, detail);
  const contactEmail = getContactEmail(email, detail);
  const contactLinkedIn = getContactLinkedIn(email, detail);
  const sequenceEmails = detail?.sequence_emails || [];
  const reviewStatus = detail?.review_status || email.review_status || '';
  const deliveryStatus = detail?.status || ('status' in email ? email.status || '' : '');
  const sentAt = detail?.sent_at || ('sent_at' in email ? email.sent_at : null);
  const scheduledAt = detail?.scheduled_send_time || ('scheduled_send_time' in email ? email.scheduled_send_time : null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{email.contact_name}</h3>
            <p className="truncate text-xs text-text-dim">
              {contactTitle ? `${contactTitle} · ` : ''}
              {email.company_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close email details"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${formatStatusTone(reviewStatus || deliveryStatus)}`}>
            {reviewStatus || deliveryStatus || 'draft'}
          </span>
          <span className="inline-flex rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
            {email.campaign_name} · Email {email.step_number}
          </span>
          {contactLinkedIn ? (
            <a
              href={contactLinkedIn}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-text hover:bg-surface-hover"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              LinkedIn
            </a>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-bg/40 p-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
              {contactEmail ? <span>{contactEmail}</span> : null}
              {scheduledAt ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(scheduledAt)}
                </span>
              ) : null}
              {sentAt ? (
                <span className="inline-flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Sent {formatDateTime(sentAt)}
                </span>
              ) : null}
            </div>
          </section>

          {mode === 'review' ? (
            <section className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-muted">Subject</label>
                <input
                  value={draftSubject}
                  onChange={(event) => setDraftSubject(event.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-muted">Body</label>
                <textarea
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  rows={14}
                  className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
                />
              </div>
            </section>
          ) : (
            <>
              <section>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">Subject</p>
                <div className="rounded-lg border border-border bg-bg/40 p-3 text-text">{subject || 'No subject'}</div>
              </section>

              <section>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">Body</p>
                <pre className="whitespace-pre-wrap rounded-lg border border-border bg-bg/40 p-3 font-sans text-text">
                  {body || 'No body preview available.'}
                </pre>
              </section>
            </>
          )}

          {detailQuery.isLoading ? (
            <LoadingSpinner />
          ) : detailQuery.isError ? (
            <section className="rounded-lg border border-border bg-bg/40 p-3 text-xs text-text-muted">
              Additional detail could not be loaded. Core row data is still shown here.
            </section>
          ) : null}

          {mode === 'history' ? (
            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-bg/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Opened</p>
                <p className="mt-1 text-sm font-medium text-text">{detail?.open_count ?? email.open_count ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border bg-bg/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Replies</p>
                <p className="mt-1 text-sm font-medium text-text">{detail?.replied ? 'Yes' : email.replied ? 'Yes' : 'No'}</p>
              </div>
            </section>
          ) : null}

          {sequenceEmails.length > 0 ? (
            <section>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">Sequence History</p>
              <div className="space-y-2">
                {sequenceEmails.map((sequenceEmail) => {
                  const isCurrent = sequenceEmail.id === email.id;
                  return (
                    <div
                      key={sequenceEmail.id}
                      className={`rounded-lg border p-3 ${isCurrent ? 'border-accent/30 bg-accent/5' : 'border-border bg-bg/40'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text">
                            Email {sequenceEmail.step_number ?? '?'}
                            {sequenceEmail.rendered_subject ? ` · ${sequenceEmail.rendered_subject}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-text-muted">
                            {sequenceEmail.review_status || sequenceEmail.status || 'draft'}
                          </p>
                        </div>
                        <span className="text-[11px] text-text-dim">
                          {formatDateTime(sequenceEmail.sent_at || sequenceEmail.scheduled_send_time)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border bg-bg/50 px-4 py-3">
        {mode === 'review' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRejectEmail?.(email.id)}
              disabled={isRejecting}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-text hover:bg-surface-hover disabled:opacity-60"
            >
              {isRejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Reject
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onApproveEmail?.(email.id, draftSubject, draftBody)}
              disabled={isApproving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve
            </button>
          </div>
        ) : mode === 'scheduled' && scheduledEmail ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onReschedule?.(scheduledEmail)}
              disabled={isRescheduling}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-text hover:bg-surface-hover disabled:opacity-60"
            >
              {isRescheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Reschedule
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onSendNow?.(scheduledEmail)}
              disabled={isSendingNow}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isSendingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Now
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
