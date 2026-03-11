import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ExternalLink, Filter } from 'lucide-react';
import { api, type Contact, type ConversationThread } from '../../api';
import {
  SHARED_TABLE_ROW_HEIGHT_CLASS,
  SharedTableColGroupWithWidths,
  SharedTableHeader,
  sharedCellClassName,
  usePersistentColumnSizing,
} from '../shared/resizableDataTable';
import { EngagementStatusBadge } from './SalesforceStatusBadge';
import { getContactSourceLabel } from './sourceLabel';

type ContactDetailsContentProps = {
  contact: Contact;
  onClose: () => void;
  onAddToCampaign: (contact: Contact) => void;
};

type ContactActivityType =
  | 'email_sent'
  | 'email_scheduled'
  | 'email_opened'
  | 'email_replied'
  | 'note'
  | 'status_change';

type ContactActivity = {
  id: string;
  type: ContactActivityType;
  ts: string;
  subject?: string;
  campaignName?: string;
  status?: string;
  step?: number;
};

type ActivityStatusFilter = 'all' | 'failed' | 'sent' | 'opened' | 'replied' | 'scheduled';

type SentEmailActivityRow = {
  id: number;
  step_number?: number | null;
  subject?: string | null;
  rendered_subject?: string | null;
  sent_at?: string | null;
  scheduled_send_time?: string | null;
  campaign_name?: string | null;
  status?: string | null;
  review_status?: string | null;
  opened?: number | null;
  replied?: number | null;
};

type CampaignEnrollmentRow = {
  id: number;
  campaign_id: number;
  campaign_name?: string | null;
  status?: string | null;
  current_step?: number | null;
  next_email_at?: string | null;
  enrolled_at?: string | null;
};

const ACTIVITY_SIZING_STORAGE_KEY = 'contact-activity-table-v3';
const activityColumnHelper = createColumnHelper<ContactActivity>();
const ACTIVITY_COLUMN_IDS = ['type', 'activity', 'date', 'status'] as const;
const ACTIVITY_SHRINK_PRIORITY = ['activity', 'date', 'type', 'status'] as const;
const ACTIVITY_COLUMN_MIN_WIDTHS: Record<(typeof ACTIVITY_COLUMN_IDS)[number], number> = {
  type: 72,
  activity: 96,
  date: 88,
  status: 84,
};

function formatCompactDate(value?: string | null) {
  if (!value) return '-';
  const d = parseTimestamp(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

function parseTimestamp(value: string) {
  const raw = value.trim();
  // App/backend often stores UTC as naive strings (no zone). Normalize those to UTC.
  const hasZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
  if (hasZone) return new Date(raw);
  const isoLike = raw.replace(' ', 'T');
  return new Date(`${isoLike}Z`);
}

function toMillis(value?: string | null) {
  if (!value) return 0;
  const ms = parseTimestamp(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function compactActivityLabel(type: ContactActivityType) {
  if (type === 'email_replied') return 'Replied';
  if (type === 'email_sent') return 'Email sent';
  if (type === 'email_opened') return 'Opened';
  if (type === 'email_scheduled') return 'Scheduled';
  if (type === 'status_change') return 'Status';
  return 'Note';
}

function activityStatusTone(status?: string) {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'sent' || normalized === 'active') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (normalized === 'replied') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (normalized === 'opened') return 'border-sky-300 bg-sky-50 text-sky-700';
  if (normalized === 'scheduled') return 'border-amber-300 bg-amber-50 text-amber-700';
  if (normalized.startsWith('failed')) return 'border-rose-300 bg-rose-50 text-rose-700';
  return 'border-border bg-surface text-text-muted';
}

function activityPriority(item: ContactActivity) {
  const s = (item.status || '').toLowerCase();
  if (s === 'replied') return 4;
  if (s === 'opened') return 3;
  if (s === 'sent') return 2;
  if (s === 'scheduled') return 1;
  return 1;
}

function inferEngagementStatusFromTimeline(timeline: ContactActivity[], contact: Contact): string {
  const statuses = timeline.map((item) => String(item.status || '').trim().toLowerCase()).filter(Boolean);
  if (statuses.includes('replied')) return 'replied';
  if (statuses.some((s) => s.startsWith('failed'))) return 'failed';
  if (statuses.includes('scheduled')) return 'scheduled';
  if (statuses.includes('opened') || statuses.includes('sent')) return 'in_sequence';
  if (statuses.includes('active')) return 'enrolled';
  if ((contact.salesforce_url || '').trim()) return 'synced';
  return 'needs_sync';
}

function dedupeActivities(items: ContactActivity[]) {
  const map = new Map<string, ContactActivity>();
  for (const item of items) {
    const subject = (item.subject || '').trim().toLowerCase();
    const campaign = (item.campaignName || '').trim().toLowerCase();
    const ts = item.ts || '';
    const key = `${item.type}|${ts}|${campaign}|${subject}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const keepCurrent =
      activityPriority(item) > activityPriority(existing) ||
      ((item.subject || '').length > (existing.subject || '').length);
    if (keepCurrent) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function buildActivitySummary(item: ContactActivity) {
  const parts = [];
  if (item.subject) parts.push(item.subject);
  if (item.campaignName) parts.push(item.campaignName);
  return parts.join(' - ') || 'No subject';
}

function ActivityFilterMenu({
  open,
  active,
  onToggle,
  children,
}: {
  open: boolean;
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onToggle();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onToggle]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        aria-label="Filter activity status"
        className={`inline-flex h-4 w-4 items-center justify-center rounded-none transition-colors ${active ? 'text-text' : 'text-text-dim hover:text-text'}`}
      >
        <Filter className="h-3 w-3" />
      </button>
      {open ? (
        <div className="absolute right-0 top-6 z-40 w-36 rounded-none border border-border bg-surface p-2 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ContactDetailsContent({
  contact,
  onClose,
  onAddToCampaign,
}: ContactDetailsContentProps) {
  void onClose;
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [campaignEnrollments, setCampaignEnrollments] = useState<CampaignEnrollmentRow[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityStatusFilter>('all');
  const [showActivityFilter, setShowActivityFilter] = useState(false);
  const activityContainerRef = useRef<HTMLDivElement | null>(null);
  const [activityContainerWidth, setActivityContainerWidth] = useState(0);
  useEffect(() => {
    const element = activityContainerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setActivityContainerWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    setActivityContainerWidth(Math.round(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function loadActivities() {
      setLoadingActivities(true);
      try {
        const [thread, sentRes, enrollments] = await Promise.all([
          api.getConversationThread(contact.id),
          fetch(`/api/emails/sent?contact_id=${contact.id}&limit=25`),
          api.getContactCampaignEnrollments(contact.id),
        ]);

        const mappedThread: ContactActivity[] = ((thread as ConversationThread).thread || [])
          .filter((item) => !!item.timestamp)
          .map((item) => ({
            id: `thread-${item.msg_type}-${item.id}`,
            type: item.msg_type === 'reply' ? 'email_replied' : 'email_sent',
            ts: item.timestamp || '',
            subject: item.subject || undefined,
            campaignName: item.campaign_name || undefined,
            status: item.msg_type === 'reply' ? 'replied' : 'sent',
          }));

        let mappedSent: ContactActivity[] = [];
        if (sentRes.ok) {
          const sentRows = (await sentRes.json()) as SentEmailActivityRow[];
          const stepGrouped = new Map<string, SentEmailActivityRow>();
          for (const row of sentRows) {
            const key = `${row.campaign_name || ''}|${row.step_number ?? row.id}`;
            const rowTs = toMillis(row.sent_at || row.scheduled_send_time);
            const prev = stepGrouped.get(key);
            if (!prev || rowTs >= toMillis(prev.sent_at || prev.scheduled_send_time)) {
              stepGrouped.set(key, row);
            }
          }
          mappedSent = Array.from(stepGrouped.values())
            .filter((row) => !!(row.sent_at || row.scheduled_send_time))
            .map((row) => {
              const rawStatus = (row.review_status || row.status || '').trim().toLowerCase();
              const status = row.replied
                ? 'replied'
                : row.opened
                ? 'opened'
                : rawStatus.startsWith('failed')
                ? 'failed'
                : (rawStatus === 'approved' || rawStatus === 'scheduled' || (!!row.scheduled_send_time && !row.sent_at))
                ? 'scheduled'
                : row.status || row.review_status || 'sent';
              const type: ContactActivityType =
                status === 'replied'
                  ? 'email_replied'
                  : status === 'opened'
                  ? 'email_opened'
                  : status === 'scheduled'
                  ? 'email_scheduled'
                  : 'email_sent';
              return {
                id: `sent-${row.id}`,
                type,
                ts: row.sent_at || row.scheduled_send_time || '',
                subject: row.rendered_subject || row.subject || (row.step_number ? `Email step ${row.step_number}` : undefined),
                campaignName: row.campaign_name || undefined,
                status,
                step: row.step_number || undefined,
              } satisfies ContactActivity;
            });
        }

        const mappedEnrollments: ContactActivity[] = (enrollments || [])
          .flatMap((row: CampaignEnrollmentRow) => {
            const out: ContactActivity[] = [];
            if (row.enrolled_at) {
              out.push({
                id: `enrolled-${row.id}`,
                type: 'status_change',
                ts: row.enrolled_at || '',
                subject: 'Enrolled in campaign',
                campaignName: row.campaign_name || `Campaign ${row.campaign_id}`,
                status: row.status || 'active',
              });
            }
            if ((row.status || '').toLowerCase() === 'active' && row.next_email_at) {
              const nextStep = (Number(row.current_step || 0) || 0) + 1;
              out.push({
                id: `upcoming-${row.id}`,
                type: 'email_scheduled',
                ts: row.next_email_at,
                subject: `Upcoming campaign email${nextStep > 0 ? ` (Step ${nextStep})` : ''}`,
                campaignName: row.campaign_name || `Campaign ${row.campaign_id}`,
                status: 'scheduled',
                step: nextStep > 0 ? nextStep : undefined,
              });
            }
            return out;
          });

        if (!cancelled) {
          setCampaignEnrollments((enrollments || []) as CampaignEnrollmentRow[]);
          setActivities(dedupeActivities([...mappedSent, ...mappedThread, ...mappedEnrollments]));
        }
      } catch {
        if (!cancelled) {
          setCampaignEnrollments([]);
          setActivities([]);
        }
      } finally {
        if (!cancelled) setLoadingActivities(false);
      }
    }
    loadActivities();
    return () => {
      cancelled = true;
    };
  }, [contact.id]);

  const fallbackActivities = useMemo(() => {
    const items: ContactActivity[] = [];
    if (contact.salesforce_uploaded_at) {
      items.push({
        id: `sf-upload-${contact.id}`,
        type: 'status_change',
        ts: contact.salesforce_uploaded_at,
        subject: 'Lead synced to Salesforce',
        status: 'sent',
      });
    }
    return items;
  }, [contact.id, contact.salesforce_uploaded_at]);

  const timeline = useMemo(
    () => [...activities, ...fallbackActivities].sort((a, b) => toMillis(b.ts) - toMillis(a.ts)),
    [activities, fallbackActivities]
  );
  const filteredTimeline = useMemo(() => {
    if (activityFilter === 'all') return timeline;
    return timeline.filter((item) => {
      const s = (item.status || '').trim().toLowerCase();
      return activityFilter === 'failed' ? s.startsWith('failed') : s === activityFilter;
    });
  }, [activityFilter, timeline]);
  const effectiveEngagementStatus = useMemo(() => {
    const explicit = String(contact.engagement_status || '').trim().toLowerCase();
    if (explicit) return explicit;
    return inferEngagementStatusFromTimeline(timeline, contact);
  }, [contact, timeline]);
  const normalizedEnrollments = useMemo(
    () =>
      campaignEnrollments.map((row) => ({
        ...row,
        normalizedStatus: String(row.status || '').trim().toLowerCase(),
        displayName: (row.campaign_name || `Campaign ${row.campaign_id}`).trim(),
      })),
    [campaignEnrollments]
  );
  const firstActiveEnrollment = useMemo(
    () => normalizedEnrollments.find((row) => row.normalizedStatus === 'active') || null,
    [normalizedEnrollments]
  );
  const activityColumns = useMemo<ColumnDef<ContactActivity, any>[]>(() => [
    activityColumnHelper.accessor('type', {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">{compactActivityLabel(row.original.type)}</div>,
      enableResizing: true,
      size: 96,
      minSize: 72,
      meta: { label: 'Type', minWidth: 72, defaultWidth: 96, resizable: true, align: 'left', measureValue: (row: ContactActivity) => compactActivityLabel(row.type) },
    }),
    activityColumnHelper.display({
      id: 'activity',
      header: 'Activity',
      cell: ({ row }) => <div className="truncate text-[12px] leading-4 text-text">{row.original.step ? `${buildActivitySummary(row.original)} - Step ${row.original.step}` : buildActivitySummary(row.original)}</div>,
      enableResizing: true,
      size: 160,
      minSize: 96,
      meta: { label: 'Activity', minWidth: 96, defaultWidth: 160, resizable: true, align: 'left', grow: 1, measureValue: (row: ContactActivity) => row.step ? `${buildActivitySummary(row)} - Step ${row.step}` : buildActivitySummary(row) },
    }),
    activityColumnHelper.accessor('ts', {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => <div className="text-[11px] text-text-muted">{formatCompactDate(row.original.ts)}</div>,
      enableResizing: true,
      size: 104,
      minSize: 88,
      meta: { label: 'Date', minWidth: 88, defaultWidth: 104, resizable: true, align: 'left', measureValue: (row: ContactActivity) => formatCompactDate(row.ts) },
    }),
    activityColumnHelper.display({
      id: 'status',
      header: () => (
        <div className="flex items-center justify-start gap-1">
          <span className="truncate">Status</span>
          <ActivityFilterMenu open={showActivityFilter} active={activityFilter !== 'all'} onToggle={() => setShowActivityFilter((v) => !v)}>
            <div className="space-y-1">
              {(['all', 'failed', 'sent', 'opened', 'replied', 'scheduled'] as ActivityStatusFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setActivityFilter(value);
                    setShowActivityFilter(false);
                  }}
                  className={`block h-7 w-full rounded-none px-2 text-left text-[11px] ${activityFilter === value ? 'bg-surface-hover text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'}`}
                >
                  {value === 'all' ? 'All' : value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </ActivityFilterMenu>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex justify-start">
          <span className={`inline-flex min-h-4.5 shrink-0 items-center rounded-full border px-1 text-[9px] ${activityStatusTone(row.original.status)}`}>
            {row.original.status || 'logged'}
          </span>
        </div>
      ),
      enableResizing: true,
      size: 96,
      minSize: 84,
      meta: {
        label: 'Status',
        minWidth: 84,
        defaultWidth: 96,
        resizable: true,
        align: 'left',
        headerClassName: 'px-1.5',
        cellClassName: 'px-1.5',
        measureValue: (row: ContactActivity) => row.status || 'logged',
      },
    }),
  ], [activityFilter, showActivityFilter]);

  const { columnSizing: activityColumnSizing, setColumnSizing: setActivityColumnSizing, autoFitColumn: autoFitActivityColumn } = usePersistentColumnSizing({
    columns: activityColumns,
    rows: filteredTimeline,
    storageKey: ACTIVITY_SIZING_STORAGE_KEY,
  });

  const normalizeActivitySizing = useCallback((sizing: Record<string, number>) => {
    const next = { ...sizing };
    for (const columnId of ACTIVITY_COLUMN_IDS) {
      const minWidth = ACTIVITY_COLUMN_MIN_WIDTHS[columnId];
      const otherMinWidth = ACTIVITY_COLUMN_IDS
        .filter((id) => id !== columnId)
        .reduce((sum, id) => sum + ACTIVITY_COLUMN_MIN_WIDTHS[id], 0);
      const maxWidth =
        activityContainerWidth > 0 ? Math.max(minWidth, activityContainerWidth - otherMinWidth) : Number.POSITIVE_INFINITY;
      const width = next[columnId] ?? minWidth;
      next[columnId] = Math.min(Math.max(width, minWidth), maxWidth);
    }
    if (activityContainerWidth > 0) {
      let totalWidth = ACTIVITY_COLUMN_IDS.reduce((sum, columnId) => sum + (next[columnId] ?? ACTIVITY_COLUMN_MIN_WIDTHS[columnId]), 0);
      let overflow = Math.max(totalWidth - activityContainerWidth, 0);
      for (const columnId of ACTIVITY_SHRINK_PRIORITY) {
        if (overflow <= 0) break;
        const minWidth = ACTIVITY_COLUMN_MIN_WIDTHS[columnId];
        const currentWidth = next[columnId] ?? minWidth;
        const shrinkCapacity = Math.max(currentWidth - minWidth, 0);
        if (shrinkCapacity <= 0) continue;
        const shrinkBy = Math.min(shrinkCapacity, overflow);
        next[columnId] = currentWidth - shrinkBy;
        overflow -= shrinkBy;
      }
    }
    return next;
  }, [activityContainerWidth]);

  const handleActivityColumnSizingChange = useCallback((updater: Record<string, number> | ((old: Record<string, number>) => Record<string, number>)) => {
    setActivityColumnSizing((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeActivitySizing(next);
    });
  }, [normalizeActivitySizing, setActivityColumnSizing]);

  useEffect(() => {
    if (activityContainerWidth <= 0) return;
    setActivityColumnSizing((prev) => {
      const normalized = normalizeActivitySizing(prev);
      const changed = ACTIVITY_COLUMN_IDS.some((columnId) => normalized[columnId] !== prev[columnId]);
      return changed ? normalized : prev;
    });
  }, [activityContainerWidth, normalizeActivitySizing, setActivityColumnSizing]);

  const activityTable = useReactTable({
    data: filteredTimeline,
    columns: activityColumns,
    state: { columnSizing: activityColumnSizing },
    onColumnSizingChange: handleActivityColumnSizingChange,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    autoResetAll: false,
  });
  const activityColumnWidths = Object.fromEntries(
    activityTable.getVisibleLeafColumns().map((column) => [column.id, column.getSize()])
  ) as Record<string, number>;
  const activityVisibleColumnIds = activityTable.getVisibleLeafColumns().map((column) => column.id);
  const activityBaseTableWidth = useMemo(
    () => activityVisibleColumnIds.reduce((sum, columnId) => sum + (activityColumnWidths[columnId] ?? 0), 0),
    [activityColumnWidths, activityVisibleColumnIds]
  );
  const activityFillWidth = Math.max(0, activityContainerWidth - activityBaseTableWidth);
  const activityTableStyle = useMemo(
    () => ({
      width: `${activityBaseTableWidth + activityFillWidth}px`,
      minWidth: `${activityBaseTableWidth + activityFillWidth}px`,
      tableLayout: 'fixed' as const,
    }),
    [activityBaseTableWidth, activityFillWidth]
  );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <section ref={activityContainerRef} className="min-h-0 flex-1 overflow-x-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto text-xs">
            {loadingActivities ? (
              <div className="border-b border-border px-3 py-2 text-xs text-text-dim">Loading activity...</div>
            ) : filteredTimeline.length === 0 ? (
              <div className="border-b border-border px-3 py-2">
                <p className="text-xs text-text-dim">No activity for this filter.</p>
                <button
                  type="button"
                  onClick={() => onAddToCampaign(contact)}
                  className="mt-1 text-xs text-accent hover:underline"
                >
                  Add to campaign
                </button>
              </div>
            ) : (
              <table className="border-collapse" style={activityTableStyle}>
                <SharedTableColGroupWithWidths table={activityTable} columnWidths={activityColumnWidths} visibleColumnIds={activityVisibleColumnIds} fillerWidth={activityFillWidth} controlWidth={0} />
                <SharedTableHeader
                  table={activityTable}
                  onAutoFitColumn={autoFitActivityColumn}
                  visibleColumnIds={activityVisibleColumnIds}
                  columnWidths={activityColumnWidths}
                  fillerWidth={activityFillWidth}
                  controlWidth={0}
                />
                <tbody>
                  {activityTable.getRowModel().rows.map((row) => {
                    const cells = row.getVisibleCells();
                    return (
                      <tr key={row.id} className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} border-b border-border-subtle transition-colors`}>
                        {cells.map((cell, index) => (
                          <td key={cell.id} className={sharedCellClassName(cell, `${SHARED_TABLE_ROW_HEIGHT_CLASS} ${index === cells.length - 1 ? '__shared-last__' : ''}`)}>
                            <div className={cell.column.id === 'activity' ? 'min-w-0 truncate' : 'min-w-0'}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          </td>
                        ))}
                        {activityFillWidth > 0 ? <td aria-hidden="true" className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} px-0 py-0`} /> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {/* TODO: migrate to dedicated contact activities API once backend provides unified timeline payload. */}
        </div>
      </section>

      <details className="shrink-0 border-t border-border bg-bg/30 px-3 py-1.5 text-xs">
        <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Details
        </summary>
        <dl className="mt-1.5 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <dt className="text-text-muted">Email</dt>
          <dd className="min-w-0 truncate text-text">{contact.email || '-'}</dd>
          <dt className="text-text-muted">Phone</dt>
          <dd className="min-w-0 truncate text-text">{contact.phone || '-'}</dd>
          <dt className="text-text-muted">LinkedIn</dt>
          <dd className="min-w-0 truncate text-text">
            {contact.linkedin_url ? (
              <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Open <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              '-'
            )}
          </dd>
          <dt className="text-text-muted">CRM</dt>
          <dd className="min-w-0 truncate text-text">
            {contact.salesforce_url ? (
              <a href={contact.salesforce_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Salesforce <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              '-'
            )}
          </dd>
          <dt className="text-text-muted">Created</dt>
          <dd className="min-w-0 truncate text-text">{formatCompactDate(contact.scraped_at)}</dd>
          <dt className="text-text-muted">Source</dt>
          <dd className="min-w-0 truncate text-text">{getContactSourceLabel(contact)}</dd>
          <dt className="text-text-muted">Status</dt>
          <dd className="min-w-0 truncate text-text">
            <EngagementStatusBadge status={effectiveEngagementStatus} />
          </dd>
          <dt className="text-text-muted">Campaign</dt>
          <dd className="min-w-0 truncate text-text">
            {firstActiveEnrollment ? (
              <a
                href={`/email?view=campaigns&q=${encodeURIComponent(firstActiveEnrollment.displayName)}`}
                className="text-accent hover:underline"
                title={`Open ${firstActiveEnrollment.displayName} in Email campaigns`}
              >
                {firstActiveEnrollment.displayName}
              </a>
            ) : (
              <button type="button" onClick={() => onAddToCampaign(contact)} className="text-accent hover:underline">
                Not enrolled
              </button>
            )}
          </dd>
        </dl>
      </details>
    </div>
  );
}
