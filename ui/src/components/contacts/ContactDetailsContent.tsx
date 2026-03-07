import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, MoreHorizontal, Phone, X } from 'lucide-react';
import { api, type Contact, type ConversationThread } from '../../api';
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

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = parseTimestamp(value);
  if (Number.isNaN(d.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || '';
  return `${get('month')}/${get('day')}/${get('year')}, ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')} ${get('timeZoneName')}`.trim();
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

function humanActivityLabel(type: ContactActivityType) {
  if (type === 'email_replied') return 'Email replied';
  if (type === 'email_sent') return 'Email sent';
  if (type === 'email_opened') return 'Email opened';
  if (type === 'email_scheduled') return 'Email scheduled';
  if (type === 'status_change') return 'Status update';
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

export function ContactDetailsContent({
  contact,
  onClose,
  onAddToCampaign,
}: ContactDetailsContentProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [campaignEnrollments, setCampaignEnrollments] = useState<CampaignEnrollmentRow[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityStatusFilter>('all');
  const detailsHref = useMemo(
    () => contact.salesforce_url || contact.linkedin_url || (contact.domain ? `https://${contact.domain}` : ''),
    [contact.salesforce_url, contact.linkedin_url, contact.domain]
  );
  const titleCompany = useMemo(() => {
    const title = (contact.title || '').trim();
    const company = (contact.company_name || '').trim();
    if (title && company) return `${title} - ${company}`;
    return title || company || '-';
  }, [contact.title, contact.company_name]);

  const copyValue = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1400);
    } catch {
      setCopiedField(null);
    }
  };

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{contact.name}</h3>
            <p className="truncate text-xs text-text-muted">{titleCompany}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contact details"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
          <EngagementStatusBadge status={effectiveEngagementStatus} />
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted">
            {getContactSourceLabel(contact)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAddToCampaign(contact)}
            className="h-7 rounded-md border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover"
          >
            Add to campaign
          </button>
          <button
            type="button"
            onClick={() => {
              if (detailsHref) window.open(detailsHref, '_blank', 'noopener,noreferrer');
            }}
            disabled={!detailsHref}
            aria-label="Open external details"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            title="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1">
          {detailsHref ? (
            <a href={detailsHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
              Open full details <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="text-[11px] text-text-dim">Open full details unavailable</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs">
        <section className="space-y-1 rounded-md border border-border bg-bg p-2">
          <dl className="divide-y divide-border">
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[72px] shrink-0 text-text-muted">Email</dt>
              <dd className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-text">{contact.email || '-'}</span>
                <span className="flex items-center gap-1">
                  {contact.email ? (
                    <>
                      <a
                        href={`mailto:${contact.email}`}
                        aria-label={`Send email to ${contact.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                        title="Send email"
                      >
                        <Mail className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => copyValue(contact.email!, 'email')}
                        aria-label={`Copy email for ${contact.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                        title="Copy email"
                      >
                        {copiedField === 'email' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </>
                  ) : null}
                </span>
              </dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[72px] shrink-0 text-text-muted">Phone</dt>
              <dd className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-text">{contact.phone || '-'}</span>
                <span className="flex items-center gap-1">
                  {contact.phone ? (
                    <>
                      <a
                        href={`tel:${contact.phone}`}
                        aria-label={`Call ${contact.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                        title="Call"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => copyValue(contact.phone!, 'phone')}
                        aria-label={`Copy phone for ${contact.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                        title="Copy phone"
                      >
                        {copiedField === 'phone' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </>
                  ) : null}
                </span>
              </dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[72px] shrink-0 text-text-muted">LinkedIn</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text">
                {contact.linkedin_url ? (
                  <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  '-'
                )}
              </dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[72px] shrink-0 text-text-muted">CRM</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text">
                {contact.salesforce_url ? (
                  <a href={contact.salesforce_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Salesforce <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  '-'
                )}
              </dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[72px] shrink-0 text-text-muted">Source</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text">{getContactSourceLabel(contact)}</dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[72px] shrink-0 text-text-muted">Status</dt>
              <dd className="flex min-w-0 flex-1 justify-end text-right text-text">
                <EngagementStatusBadge status={effectiveEngagementStatus} />
              </dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[72px] shrink-0 text-text-muted">Created</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text">{formatDateTime(contact.scraped_at)}</dd>
            </div>
            <div className="flex items-start justify-between gap-2 py-2">
              <dt className="w-[72px] shrink-0 text-text-muted">Campaigns</dt>
              <dd className="flex min-w-0 flex-1 flex-col items-end gap-1 text-right text-text">
                {firstActiveEnrollment ? (
                  <a
                    href={`/email?view=campaigns&q=${encodeURIComponent(firstActiveEnrollment.displayName)}`}
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-accent hover:bg-surface-hover"
                    title={`Open ${firstActiveEnrollment.displayName} in Email campaigns`}
                  >
                    {firstActiveEnrollment.displayName}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAddToCampaign(contact)}
                    className="text-[11px] text-accent hover:underline"
                  >
                    Not enrolled in any campaign
                  </button>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Activities</h4>
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value as ActivityStatusFilter)}
              className="h-7 rounded-md border border-border bg-bg px-2 text-[11px] text-text-muted focus:border-accent focus:outline-none"
              aria-label="Filter activity status"
            >
              <option value="all">All</option>
              <option value="failed">Failed</option>
              <option value="sent">Sent</option>
              <option value="opened">Opened</option>
              <option value="replied">Replied</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </div>
          {loadingActivities ? (
            <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs text-text-dim">Loading activity...</div>
          ) : filteredTimeline.length === 0 ? (
            <div className="rounded-md border border-border bg-bg px-3 py-2">
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
            <ol className="space-y-2">
              {filteredTimeline.map((item) => (
                <li key={item.id} className="rounded-md border border-border bg-bg px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-border" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-text">
                        {humanActivityLabel(item.type)}: {item.subject || 'No subject'}
                      </p>
                      <p className="truncate text-[11px] text-text-muted">
                        {item.campaignName ? `${item.campaignName} - ` : ''}
                        {formatDateTime(item.ts)}
                      </p>
                    </div>
                    <span className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] ${activityStatusTone(item.status)}`}>
                      {item.status || 'logged'}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {/* TODO: migrate to dedicated contact activities API once backend provides unified timeline payload. */}
        </section>
      </div>
    </div>
  );
}
