import { flexRender, getCoreRowModel, type ColumnDef, useReactTable } from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Check, ExternalLink, Loader2, Send, X } from 'lucide-react';
import { emailApi } from '../../api/emailApi';
import type { EmailDetail, ReviewQueueItem, ScheduledEmail, SentEmail } from '../../types/email';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import {
  SharedTableColGroupWithWidths,
  SharedTableHeader,
  useFittedTableLayout,
  usePersistentColumnSizing,
} from '../shared/resizableDataTable';

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

type SequenceHistoryRow = {
  id: number;
  step: string;
  subject: string;
  status: string;
  dateTime: string;
  isCurrent: boolean;
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
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
  if (value === 'pending' || value === 'queued' || value === 'scheduled') return 'bg-amber-500/15 text-amber-700';
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
  const panelStatus = reviewStatus || deliveryStatus || 'draft';
  const sentAt = detail?.sent_at || ('sent_at' in email ? email.sent_at : null);
  const scheduledAt = detail?.scheduled_send_time || ('scheduled_send_time' in email ? email.scheduled_send_time : null);
  const openCount = detail?.open_count ?? ('open_count' in email ? email.open_count ?? 0 : 0);
  const hasReply = Boolean(detail?.replied ?? ('replied' in email ? email.replied : 0));
  const sequenceScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [sequenceScrollThumb, setSequenceScrollThumb] = useState<{ height: number; top: number; visible: boolean }>({
    height: 0,
    top: 0,
    visible: false,
  });
  const sequenceRows = useMemo<SequenceHistoryRow[]>(
    () =>
      sequenceEmails.map((sequenceEmail) => ({
        id: sequenceEmail.id,
        step: `Email ${sequenceEmail.step_number ?? '?'}`,
        subject: sequenceEmail.rendered_subject || sequenceEmail.subject || '-',
        status: sequenceEmail.review_status || sequenceEmail.status || 'draft',
        dateTime: formatDateTime(sequenceEmail.sent_at || sequenceEmail.scheduled_send_time),
        isCurrent: sequenceEmail.id === email.id,
      })),
    [email.id, sequenceEmails],
  );
  const sequenceColumns = useMemo<ColumnDef<SequenceHistoryRow>[]>(
    () => [
      {
        id: 'step',
        accessorKey: 'step',
        header: 'Step',
        size: 78,
        minSize: 70,
        maxSize: 96,
        cell: ({ row }) => <span className="block truncate text-[11px] text-text">{row.original.step}</span>,
      },
      {
        id: 'subject',
        accessorKey: 'subject',
        header: 'Subject',
        size: 220,
        minSize: 160,
        maxSize: 420,
        cell: ({ row }) => (
          <span className={`block truncate text-[11px] ${row.original.isCurrent ? 'font-medium text-text' : 'text-text'}`}>
            {row.original.subject}
          </span>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        size: 86,
        minSize: 74,
        maxSize: 120,
        cell: ({ row }) => <span className="block truncate text-[11px] text-text-muted">{row.original.status}</span>,
      },
      {
        id: 'dateTime',
        accessorKey: 'dateTime',
        header: 'Date & Time',
        size: 122,
        minSize: 108,
        maxSize: 180,
        cell: ({ row }) => <span className="block truncate text-[11px] text-text-muted">{row.original.dateTime}</span>,
      },
    ],
    [],
  );
  const { columnSizing: sequenceColumnSizing, setColumnSizing: setSequenceColumnSizing, autoFitColumn: autoFitSequenceColumn } =
    usePersistentColumnSizing({
      columns: sequenceColumns,
      rows: sequenceRows,
      storageKey: 'email-details-sequence-history',
    });
  const sequenceTable = useReactTable({
    data: sequenceRows,
    columns: sequenceColumns,
    state: { columnSizing: sequenceColumnSizing },
    onColumnSizingChange: setSequenceColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
    columnResizeMode: 'onChange',
  });
  const {
    containerRef: sequenceTableContainerRef,
    columnWidths: sequenceColumnWidths,
    visibleColumnIds: sequenceVisibleColumnIds,
    tableStyle: sequenceTableStyle,
    fillWidth: sequenceFillWidth,
  } = useFittedTableLayout(sequenceTable, { controlWidth: 0 });

  useEffect(() => {
    const container = sequenceScrollContainerRef.current;
    if (!container) return;

    const updateThumb = () => {
      const { scrollHeight, clientHeight, scrollTop } = container;
      if (scrollHeight <= clientHeight + 1) {
        setSequenceScrollThumb((prev) =>
          prev.visible || prev.height !== 0 || prev.top !== 0 ? { height: 0, top: 0, visible: false } : prev,
        );
        return;
      }

      const ratio = clientHeight / scrollHeight;
      const height = Math.max(40, Math.round(clientHeight * ratio));
      const maxTop = Math.max(0, clientHeight - height);
      const top = maxTop * (scrollTop / Math.max(1, scrollHeight - clientHeight));
      setSequenceScrollThumb((prev) =>
        prev.height === height && prev.top === top && prev.visible ? prev : { height, top, visible: true },
      );
    };

    updateThumb();
    container.addEventListener('scroll', updateThumb, { passive: true });
    window.addEventListener('resize', updateThumb);
    return () => {
      container.removeEventListener('scroll', updateThumb);
      window.removeEventListener('resize', updateThumb);
    };
  }, [sequenceRows.length]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-surface">
        <div className="px-3 pb-2 pt-3">
          <h3 className="truncate text-sm font-semibold text-text">{email.contact_name}</h3>
          <p className="truncate text-xs text-text-dim">
            {contactTitle ? `${contactTitle} - ` : ''}
            {email.company_name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${formatStatusTone(panelStatus)}`}>
            {panelStatus}
          </span>
          <span className="inline-flex rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
            {email.campaign_name} - Email {email.step_number}
          </span>
          {contactEmail ? (
            <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-text-muted">
              {contactEmail}
            </span>
          ) : null}
          {scheduledAt ? (
            <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-text-muted">
              Scheduled {formatDateTime(scheduledAt)}
            </span>
          ) : null}
          {sentAt ? (
            <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-text-muted">
              Sent {formatDateTime(sentAt)}
            </span>
          ) : null}
          {mode === 'history' ? (
            <>
              <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-text-muted">
                Opens {openCount}
              </span>
              <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-text-muted">
                Replies {hasReply ? 'Yes' : 'No'}
              </span>
            </>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close email details"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-border px-3 py-2 whitespace-nowrap">
          {contactLinkedIn ? (
            <a
              href={contactLinkedIn}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover"
              title="Open LinkedIn"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              LinkedIn
            </a>
          ) : null}
          {mode === 'scheduled' && scheduledEmail ? (
            <button
              type="button"
              onClick={() => onReschedule?.(scheduledEmail)}
              disabled={isRescheduling}
              className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-60"
            >
              {isRescheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
              Reschedule
            </button>
          ) : null}
          {mode === 'scheduled' && scheduledEmail ? (
            <button
              type="button"
              onClick={() => onSendNow?.(scheduledEmail)}
              disabled={isSendingNow}
              className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-60"
            >
              {isSendingNow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send Now
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar text-sm">
        <div className="flex min-h-full flex-col">
          {mode === 'review' ? (
            <>
              <div className="shrink-0">
                <label className="block border-b border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Subject
                </label>
                <input
                  value={draftSubject}
                  onChange={(event) => setDraftSubject(event.target.value)}
                  className="h-8 w-full border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <label className="block border-b border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Body
                </label>
                <textarea
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  rows={1}
                  className="block h-full min-h-[220px] w-full resize-none overflow-y-auto no-scrollbar border-x-0 border-t-0 border-b border-border bg-bg px-2.5 py-2 text-xs text-text focus:outline-none"
                />
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0">
                <p className="border-b border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Subject
                </p>
                <div className="border-x-0 border-b border-border bg-bg px-2.5 py-2 text-xs text-text">{subject || 'No subject'}</div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <p className="border-b border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Body
                </p>
                <pre className="h-full min-h-[220px] overflow-y-auto no-scrollbar whitespace-pre-wrap border-x-0 border-b border-border bg-bg px-2.5 py-2 font-sans text-xs text-text">
                  {body || 'No body preview available.'}
                </pre>
              </div>
            </>
          )}

          {detailQuery.isLoading ? (
            <div className="shrink-0 border-b border-border bg-bg/30 px-2.5 py-3">
              <LoadingSpinner />
            </div>
          ) : detailQuery.isError ? (
            <section className="shrink-0 border-b border-border bg-bg/30 px-2.5 py-2 text-xs text-text-muted">
              Additional detail could not be loaded. Core row data is still shown here.
            </section>
          ) : null}

          {mode === 'history' ? (
            <section className="shrink-0 grid grid-cols-2 border-b border-border">
              <div className="border-r border-border bg-bg px-2.5 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Opened</p>
                <p className="mt-1 text-xs font-medium text-text">{openCount}</p>
              </div>
              <div className="bg-bg px-2.5 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Replies</p>
                <p className="mt-1 text-xs font-medium text-text">{hasReply ? 'Yes' : 'No'}</p>
              </div>
            </section>
          ) : null}

          {sequenceEmails.length > 0 ? (
            <section className="shrink-0 border-b border-border">
              <div ref={sequenceTableContainerRef} className="flex h-[190px] min-h-0 flex-col border-t border-border bg-bg/30 overflow-hidden">
                <div className="flex h-[31px] shrink-0 items-center border-b border-border bg-surface px-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Sequence History</span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <div className="flex h-full min-h-0 flex-col">
                    <table className="w-full border-collapse" style={sequenceTableStyle}>
                      <SharedTableColGroupWithWidths
                        table={sequenceTable}
                        columnWidths={sequenceColumnWidths}
                        visibleColumnIds={sequenceVisibleColumnIds}
                        fillerWidth={sequenceFillWidth}
                        controlWidth={0}
                      />
                      <SharedTableHeader
                        table={sequenceTable}
                        onAutoFitColumn={autoFitSequenceColumn}
                        visibleColumnIds={sequenceVisibleColumnIds}
                        columnWidths={sequenceColumnWidths}
                        fillerWidth={sequenceFillWidth}
                        controlWidth={0}
                      />
                    </table>
                    <div className="relative min-h-0 flex-1">
                      <div ref={sequenceScrollContainerRef} className="no-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden">
                        <table className="w-full border-collapse" style={sequenceTableStyle}>
                          <SharedTableColGroupWithWidths
                            table={sequenceTable}
                            columnWidths={sequenceColumnWidths}
                            visibleColumnIds={sequenceVisibleColumnIds}
                            fillerWidth={sequenceFillWidth}
                            controlWidth={0}
                          />
                          <tbody>
                            {sequenceTable.getRowModel().rows.map((row) => (
                              <tr
                                key={row.id}
                                className={`h-[31px] border-b border-border-subtle ${row.original.isCurrent ? 'bg-accent/5' : 'hover:bg-surface-hover/60'}`}
                              >
                                {row
                                  .getVisibleCells()
                                  .filter((cell) => sequenceVisibleColumnIds.includes(cell.column.id))
                                  .map((cell, index, cells) => (
                                    <td
                                      key={cell.id}
                                      className={`min-w-0 overflow-hidden px-3 py-0 align-middle text-[11px] leading-tight ${
                                        index === cells.length - 1 ? '__shared-last__' : ''
                                      }`}
                                    >
                                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                  ))}
                                {sequenceFillWidth > 0 ? <td aria-hidden="true" className="h-[31px] px-0 py-0" /> : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {sequenceScrollThumb.visible ? (
                        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-2">
                          <div
                            className="absolute right-0 w-1.5 rounded-full bg-slate-200/75"
                            style={{ top: `${sequenceScrollThumb.top}px`, height: `${sequenceScrollThumb.height}px` }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-bg/50 px-3 py-2">
        {mode === 'review' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRejectEmail?.(email.id)}
              disabled={isRejecting}
              className="inline-flex h-7 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-60"
            >
              {isRejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Reject
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onApproveEmail?.(email.id, draftSubject, draftBody)}
              disabled={isApproving}
              className="inline-flex h-7 items-center gap-1 border border-emerald-700 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {isApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Approve
            </button>
          </div>
        ) : mode === 'scheduled' && scheduledEmail ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onReschedule?.(scheduledEmail)}
              disabled={isRescheduling}
              className="inline-flex h-7 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-60"
            >
              {isRescheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
              Reschedule
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onSendNow?.(scheduledEmail)}
              disabled={isSendingNow}
              className="inline-flex h-7 items-center gap-1 border border-accent bg-accent px-2.5 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isSendingNow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send Now
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
