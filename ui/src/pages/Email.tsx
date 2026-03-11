import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePageContext } from '../contexts/PageContextProvider';
import { CheckCircle, Clock, Mail, Send } from 'lucide-react';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useEmailCampaigns } from '../hooks/useEmailCampaigns';
import { CampaignModal } from '../components/email/CampaignModal';
import { CampaignTemplateEditorPane } from '../components/email/CampaignTemplateEditorPane';
import { CampaignsView } from '../components/email/CampaignsView';
import { CampaignDetailsPanel } from '../components/email/CampaignDetailsPanel';
import { EmailDetailsPanel } from '../components/email/EmailDetailsPanel';
import { EmailTabs } from '../components/email/EmailTabs';
import { StandardEmailTable, type StandardEmailColumn } from '../components/email/StandardEmailTable';
import { SettingsPanel } from '../components/email/SettingsPanel';
import { SendNowConfirm } from '../components/email/SendNowConfirm';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import type { EmailCampaign, ReviewQueueItem, ScheduledEmail, SentEmail } from '../types/email';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';
import { useIsMobile } from '../hooks/useIsMobile';
import { useEmailDetailsRouteState } from '../hooks/useEmailDetailsRouteState';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';

type EmailView = 'campaigns' | 'review' | 'history' | 'scheduled';

function parseEmailView(value: string | null): EmailView {
  if (value === 'review' || value === 'history' || value === 'scheduled' || value === 'campaigns') return value;
  return 'campaigns';
}

function formatShortDateTime(value?: string | null) {
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

function statusTone(status?: string | null) {
  const value = String(status || '').toLowerCase();
  if (value === 'approved' || value === 'sent') return 'bg-emerald-500/15 text-emerald-700';
  if (value === 'pending' || value === 'queued') return 'bg-amber-500/15 text-amber-700';
  if (value === 'rejected' || value === 'failed') return 'bg-red-500/15 text-red-700';
  return 'bg-accent/10 text-accent';
}

export default function Email({ openAddModal, onModalOpened }: { openAddModal?: boolean; onModalOpened?: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setPageContext } = usePageContext();
  const { addNotification } = useNotificationContext();
  const isCompact = useIsMobile();
  const isPhone = useIsMobile(640);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplates, setEditingTemplates] = useState<EmailCampaign | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [uploadingCampaignId, setUploadingCampaignId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [emailSearch, setEmailSearch] = useState('');
  const [sendNowTarget, setSendNowTarget] = useState<ScheduledEmail | null>(null);
  const [scheduledCampaignFilter, setScheduledCampaignFilter] = useState<number | null>(null);
  const [viewportControlsTarget, setViewportControlsTarget] = useState<HTMLDivElement | null>(null);
  const { emailId: selectedEmailId, openEmail, closeEmail, setEmailId } = useEmailDetailsRouteState();
  const lastFocusedRowRef = useRef<HTMLElement | null>(null);
  const detailsPanelRef = useRef<HTMLDivElement>(null);
  const view = useMemo(() => parseEmailView(searchParams?.get('view') ?? null), [searchParams]);

  useRegisterCapabilities(getPageCapability(`email.${view}`));

  const {
    campaigns,
    campaignsLoading,
    sentEmails,
    stats,
    queue,
    reviewQueue,
    allScheduled,
    campaignScheduleSummary,
    emailConfig,
    createCampaign,
    deleteCampaign,
    activateCampaign,
    pauseCampaign,
    saveTemplates,
    sendEmails,
    approveEmail,
    rejectEmail,
    approveAll,
    prepareBatch,
    updateConfig,
    uploadToSalesforce,
    sendEmailNow,
    rescheduleEmail,
    processScheduled,
  } = useEmailCampaigns();

  useEffect(() => {
    if (openAddModal) {
      const id = window.requestAnimationFrame(() => {
        setShowCreateModal(true);
        onModalOpened?.();
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [openAddModal, onModalOpened]);

  const updateEmailRoute = useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      mutate(params);
      const search = params.toString();
      const nextUrl = `/email${search ? `?${search}` : ''}`;
      if (options?.replace ?? false) {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [router, searchParams]
  );

  const setEmailView = useCallback(
    (nextView: EmailView) => {
      updateEmailRoute((params) => {
        params.set('view', nextView);
        params.delete('selectedEmailId');
      });
    },
    [updateEmailRoute]
  );

  useEffect(() => {
    setPageContext({
      listContext: 'email',
      selected: selectedEmailId ? { emailId: selectedEmailId } : selectedCampaignId ? { campaignId: selectedCampaignId } : {},
      loadedIds: { campaignIds: campaigns.slice(0, 200).map((c) => c.id) },
    });
  }, [campaigns, selectedCampaignId, selectedEmailId, setPageContext]);

  const selectedCampaign = useMemo(
    () => campaigns.find((item) => item.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  const handleCreateCampaign = (data: Partial<EmailCampaign>) => {
    createCampaign.mutate(data);
    setShowCreateModal(false);
  };

  const handleSaveTemplates = (
    templates: Array<{ step_number: number; subject_template: string; body_template: string }>,
  ) => {
    if (!editingTemplates) return;
    saveTemplates.mutate({ campaignId: editingTemplates.id, templates });
    setEditingTemplates(null);
  };

  const handleUploadToSalesforce = (campaignId: number) => {
    setUploadingCampaignId(campaignId);
    uploadToSalesforce.mutate(campaignId, {
      onSettled: () => setUploadingCampaignId(null),
    });
  };

  const handleSendNowConfirm = useCallback(() => {
    if (!sendNowTarget) return;
    sendEmailNow.mutate(sendNowTarget.id);
    setSendNowTarget(null);
  }, [sendNowTarget, sendEmailNow]);

  const handleReschedule = (email: ScheduledEmail) => {
    const currentTime = new Date(email.scheduled_send_time);
    const newTimeStr = prompt('Enter new send time (e.g., "2026-02-10 14:30"):', currentTime.toLocaleString());
    if (!newTimeStr) return;
    const parsed = new Date(newTimeStr);
    if (Number.isNaN(parsed.getTime())) {
      addNotification({ type: 'error', title: 'Invalid date format' });
      return;
    }
    rescheduleEmail.mutate({ emailId: email.id, sendTime: parsed.toISOString() });
  };

  const totalCampaigns = stats?.total_campaigns ?? campaigns.length;
  const activeCampaigns =
    stats?.active_campaigns ??
    campaigns.filter((campaign) => String(campaign.status || '').toLowerCase() === 'active').length;
  const metaText = `${totalCampaigns} total · ${activeCampaigns} active`;

  const tabs = useMemo(
    () => [
      { id: 'campaigns', label: 'Campaigns' },
      { id: 'templates', label: 'Templates' },
      { id: 'review', label: 'Review', count: reviewQueue.length },
      { id: 'scheduled', label: 'Scheduled', count: allScheduled.length },
      { id: 'history', label: 'Sent History' },
    ],
    [allScheduled.length, reviewQueue.length]
  );

  const templateEditorOpen = Boolean(editingTemplates) && view === 'campaigns';
  const normalizedSearch = emailSearch.trim().toLowerCase();
  const filteredCampaigns = useMemo(() => {
    if (!normalizedSearch) return campaigns;
    return campaigns.filter((campaign) => {
      const haystack = [
        campaign.name,
        campaign.status,
        String(campaign.stats?.total_contacts ?? ''),
        String(campaign.stats?.total_sent ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [campaigns, normalizedSearch]);
  const filteredReviewQueue = useMemo(() => {
    if (!normalizedSearch) return reviewQueue;
    return reviewQueue.filter((item) =>
      [item.contact_name, item.company_name, item.contact_title, item.campaign_name, item.rendered_subject, item.rendered_body]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [normalizedSearch, reviewQueue]);
  const filteredScheduled = useMemo(() => {
    if (!normalizedSearch) return allScheduled;
    return allScheduled.filter((item) =>
      [item.contact_name, item.company_name, item.campaign_name, item.subject]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [allScheduled, normalizedSearch]);
  const scheduledCampaignOptions = useMemo(() => {
    const options = new Map<number, string>();
    allScheduled.forEach((item) => options.set(item.campaign_id, item.campaign_name));
    return Array.from(options.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allScheduled]);
  const filteredScheduledRows = useMemo(() => {
    if (!scheduledCampaignFilter) return filteredScheduled;
    return filteredScheduled.filter((item) => item.campaign_id === scheduledCampaignFilter);
  }, [filteredScheduled, scheduledCampaignFilter]);
  const filteredSentEmails = useMemo(() => {
    if (!normalizedSearch) return sentEmails;
    return sentEmails.filter((item) =>
      [item.contact_name, item.company_name, item.subject, item.body]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [normalizedSearch, sentEmails]);
  const searchPlaceholder = useMemo(() => {
    if (view === 'campaigns') return 'Search campaigns...';
    if (view === 'review') return 'Search review queue...';
    if (view === 'scheduled') return 'Search scheduled emails...';
    return 'Search sent history...';
  }, [view]);
  const pageSubtitle = useMemo(() => {
    if (view === 'review') {
      return `${filteredReviewQueue.length} pending review${filteredScheduled.length ? ` · ${filteredScheduled.length} scheduled` : ''}`;
    }
    if (view === 'scheduled') {
      return `${filteredScheduledRows.length} scheduled${queue.length ? ` · ${queue.length} waiting for next step` : ''}`;
    }
    if (view === 'history') {
      return `${filteredSentEmails.length} sent emails`;
    }
    return metaText;
  }, [filteredReviewQueue.length, filteredScheduled.length, filteredScheduledRows.length, filteredSentEmails.length, metaText, queue.length, view]);

  const selectedEmailPanel = useMemo(() => {
    if (!selectedEmailId) return null;
    if (view === 'review') {
      const email = filteredReviewQueue.find((item) => item.id === selectedEmailId) || null;
      return email ? { mode: 'review' as const, email } : null;
    }
    if (view === 'scheduled') {
      const email = filteredScheduledRows.find((item) => item.id === selectedEmailId) || null;
      return email ? { mode: 'scheduled' as const, email } : null;
    }
    if (view === 'history') {
      const email = filteredSentEmails.find((item) => item.id === selectedEmailId) || null;
      return email ? { mode: 'history' as const, email } : null;
    }
    return null;
  }, [filteredReviewQueue, filteredScheduledRows, filteredSentEmails, selectedEmailId, view]);

  useEffect(() => {
    if (view === 'campaigns') {
      if (selectedEmailId) setEmailId(null, { replace: true });
      return;
    }
    if (selectedEmailId && !selectedEmailPanel) {
      setEmailId(null, { replace: true });
    }
  }, [selectedEmailId, selectedEmailPanel, setEmailId, view]);

  useEffect(() => {
    if (isPhone || !selectedEmailPanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEmail();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeEmail, isPhone, selectedEmailPanel]);

  useEffect(() => {
    if (!selectedEmailPanel || isPhone) return;
    const id = window.requestAnimationFrame(() => detailsPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [isPhone, selectedEmailPanel]);

  useEffect(() => {
    if (selectedEmailId || isPhone) return;
    lastFocusedRowRef.current?.focus();
  }, [selectedEmailId, isPhone]);

  const openEmailDetails = useCallback(
    (emailId: number, element: HTMLElement) => {
      lastFocusedRowRef.current = element;
      openEmail(emailId);
    },
    [openEmail]
  );

  const reviewColumns = useMemo<StandardEmailColumn<ReviewQueueItem>[]>(
    () => [
      {
        key: 'contact',
        label: 'Contact',
        minWidth: 220,
        defaultWidth: 260,
        maxWidth: 360,
        measureValue: (item) => `${item.contact_name} ${item.company_name} ${item.contact_title || ''}`.trim(),
        render: (item) => (
          <div className="min-w-0">
            <p className="truncate text-xs text-text">
              <span className="font-medium text-text">{item.contact_name}</span>
              <span className="text-text-muted">{` · ${item.company_name}`}</span>
              {item.contact_title ? <span className="text-text-dim">{` · ${item.contact_title}`}</span> : null}
            </p>
          </div>
        ),
      },
      {
        key: 'campaign',
        label: 'Campaign',
        minWidth: 170,
        defaultWidth: 190,
        maxWidth: 260,
        measureValue: (item) => `${item.campaign_name} Email ${item.step_number} of ${item.num_emails}`,
        render: (item) => (
          <div className="min-w-0">
            <p className="truncate text-xs text-text">
              <span>{item.campaign_name}</span>
              <span className="text-text-muted">{` · Email ${item.step_number} of ${item.num_emails}`}</span>
            </p>
          </div>
        ),
      },
      {
        key: 'subject',
        label: 'Draft',
        minWidth: 260,
        defaultWidth: 360,
        maxWidth: 520,
        measureValue: (item) => `${item.rendered_subject || item.subject || 'No subject'} ${item.rendered_body || item.body || ''}`.trim(),
        render: (item) => (
          <div className="min-w-0">
            <p className="truncate text-xs text-text">
              <span className="font-medium text-text">{item.rendered_subject || item.subject || 'No subject'}</span>
              <span className="text-text-muted">{` · ${item.rendered_body || item.body || 'No preview available.'}`}</span>
            </p>
          </div>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        minWidth: 110,
        defaultWidth: 120,
        maxWidth: 150,
        resizable: true,
        measureValue: (item) => item.review_status || 'pending',
        render: (item) => (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(item.review_status)}`}>
            {item.review_status || 'pending'}
          </span>
        ),
      },
    ],
    []
  );

  const scheduledColumns = useMemo<StandardEmailColumn<ScheduledEmail>[]>(
    () => [
      {
        key: 'contact',
        label: 'Contact',
        minWidth: 220,
        defaultWidth: 250,
        maxWidth: 340,
        measureValue: (item) => `${item.contact_name} ${item.company_name} ${item.contact_title || ''}`.trim(),
        render: (item) => (
          <p className="truncate text-xs text-text">
            <span className="font-medium text-text">{item.contact_name}</span>
            <span className="text-text-muted">{` · ${item.company_name}`}</span>
            {item.contact_title ? <span className="text-text-dim">{` · ${item.contact_title}`}</span> : null}
          </p>
        ),
      },
      {
        key: 'campaign',
        label: 'Campaign',
        minWidth: 170,
        defaultWidth: 190,
        maxWidth: 260,
        measureValue: (item) => `${item.campaign_name} Email ${item.step_number}`,
        render: (item) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-text">{item.campaign_name}</p>
            <p className="text-xs text-text-muted">Email {item.step_number}</p>
          </div>
        ),
      },
      {
        key: 'subject',
        label: 'Subject',
        minWidth: 220,
        defaultWidth: 280,
        maxWidth: 420,
        measureValue: (item) => item.rendered_subject || item.subject || 'No subject',
        render: (item) => (
          <p className="truncate text-sm text-text">{item.rendered_subject || item.subject || 'No subject'}</p>
        ),
      },
      {
        key: 'scheduled',
        label: 'Scheduled',
        minWidth: 140,
        defaultWidth: 156,
        maxWidth: 200,
        align: 'right',
        measureValue: (item) => formatShortDateTime(item.scheduled_send_time),
        render: (item) => <span className="text-xs text-text-muted">{formatShortDateTime(item.scheduled_send_time)}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        minWidth: 110,
        defaultWidth: 120,
        maxWidth: 150,
        measureValue: (item) => item.review_status || item.status || 'scheduled',
        render: (item) => (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(item.review_status || item.status)}`}>
            {item.review_status || item.status || 'scheduled'}
          </span>
        ),
      },
    ],
    []
  );

  const historyColumns = useMemo<StandardEmailColumn<SentEmail>[]>(
    () => [
      {
        key: 'contact',
        label: 'Contact',
        minWidth: 220,
        defaultWidth: 250,
        maxWidth: 320,
        measureValue: (item) => `${item.contact_name} ${item.company_name}`.trim(),
        render: (item) => (
          <p className="truncate text-xs text-text">
            <span className="font-medium text-text">{item.contact_name}</span>
            <span className="text-text-muted">{` · ${item.company_name}`}</span>
          </p>
        ),
      },
      {
        key: 'campaign',
        label: 'Campaign',
        minWidth: 170,
        defaultWidth: 190,
        maxWidth: 240,
        measureValue: (item) => `${item.campaign_name} Email ${item.step_number}`,
        render: (item) => (
          <p className="truncate text-xs text-text">
            <span>{item.campaign_name}</span>
            <span className="text-text-muted">{` · Email ${item.step_number}`}</span>
          </p>
        ),
      },
      {
        key: 'subject',
        label: 'Subject',
        minWidth: 220,
        defaultWidth: 300,
        maxWidth: 420,
        measureValue: (item) => item.rendered_subject || item.subject || 'No subject',
        render: (item) => (
          <p className="truncate text-xs text-text">{item.rendered_subject || item.subject || 'No subject'}</p>
        ),
      },
      {
        key: 'engagement',
        label: 'Engagement',
        minWidth: 130,
        defaultWidth: 140,
        maxWidth: 200,
        measureValue: (item) => `${item.open_count || 0} opens ${item.replied ? 'Reply' : ''}`.trim(),
        render: (item) => (
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <span>{item.open_count || 0} opens</span>
            {item.replied ? <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700">Reply</span> : null}
          </div>
        ),
      },
      {
        key: 'sent',
        label: 'Sent',
        minWidth: 130,
        defaultWidth: 144,
        maxWidth: 190,
        align: 'right',
        measureValue: (item) => formatShortDateTime(item.sent_at),
        render: (item) => <span className="text-xs text-text-muted">{formatShortDateTime(item.sent_at)}</span>,
      },
    ],
    []
  );

  const emailDetailsContent = selectedEmailPanel ? (
    <EmailDetailsPanel
      key={`${selectedEmailPanel.mode}-${selectedEmailPanel.email.id}`}
      mode={selectedEmailPanel.mode}
      email={selectedEmailPanel.email}
      onClose={closeEmail}
      onApproveEmail={(emailId, subject, body) => approveEmail.mutate({ emailId, subject, body })}
      onRejectEmail={(emailId) => rejectEmail.mutate(emailId)}
      onSendNow={(email) => setSendNowTarget(email)}
      onReschedule={handleReschedule}
      isApproving={approveEmail.isPending}
      isRejecting={rejectEmail.isPending}
      isSendingNow={sendEmailNow.isPending}
      isRescheduling={rescheduleEmail.isPending}
    />
  ) : null;

  const renderCompactReviewRow = useCallback((item: ReviewQueueItem) => {
    return (
      <div className="min-w-0">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{item.contact_name}</p>
            <p className="truncate text-xs text-text-muted">
              {item.company_name}
              {item.contact_title ? ` · ${item.contact_title}` : ''}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(item.review_status)}`}>
            {item.review_status || 'pending'}
          </span>
        </div>
        <p className="truncate text-xs font-medium text-accent">
          {item.campaign_name} · Email {item.step_number} of {item.num_emails}
        </p>
        <p className="mt-1 truncate text-sm text-text">{item.rendered_subject || item.subject || 'No subject'}</p>
        <p className="mt-1 line-clamp-2 text-xs text-text-muted">{item.rendered_body || item.body || 'No preview available.'}</p>
      </div>
    );
  }, []);

  const renderCompactScheduledRow = useCallback((item: ScheduledEmail) => {
    return (
      <div className="min-w-0">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{item.contact_name}</p>
            <p className="truncate text-xs text-text-muted">
              {item.company_name}
              {item.contact_title ? ` · ${item.contact_title}` : ''}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(item.review_status || item.status)}`}>
            {item.review_status || item.status || 'scheduled'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="truncate text-accent">{item.campaign_name}</span>
          <span>·</span>
          <span>Email {item.step_number}</span>
        </div>
        <p className="mt-1 truncate text-sm text-text">{item.rendered_subject || item.subject || 'No subject'}</p>
        <p className="mt-1 text-xs text-text-muted">{formatShortDateTime(item.scheduled_send_time)}</p>
      </div>
    );
  }, []);

  const renderCompactHistoryRow = useCallback((item: SentEmail) => {
    return (
      <div className="min-w-0">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{item.contact_name}</p>
            <p className="truncate text-xs text-text-muted">
              {item.company_name}
              {item.company_name && item.campaign_name ? ' - ' : ''}
              {item.campaign_name}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(item.review_status || item.status)}`}>
            {item.review_status || item.status || 'sent'}
          </span>
        </div>
        <p className="truncate text-xs text-text">
          {item.rendered_subject || item.subject || 'No subject'}
          <span className="ml-1 text-text-muted">- Email {item.step_number}</span>
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
          <span>{item.open_count || 0} opens</span>
          <span>{item.replied ? 'Replied' : 'No reply'}</span>
          <span className="truncate">{formatShortDateTime(item.sent_at)}</span>
        </div>
      </div>
    );
  }, []);

  const inlineControls = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-[220px] flex-1">
        <PageSearchInput value={emailSearch} onChange={setEmailSearch} placeholder={searchPlaceholder} />
      </div>
      {view === 'scheduled' ? (
        <div className="shrink-0">
          <select
            value={scheduledCampaignFilter ?? ''}
            onChange={(event) => setScheduledCampaignFilter(event.target.value ? Number(event.target.value) : null)}
            className="h-8 rounded-none border border-border bg-surface px-2.5 text-xs text-text"
            aria-label="Filter scheduled emails by campaign"
          >
            <option value="">All campaigns</option>
            {scheduledCampaignOptions.map(([campaignId, campaignName]) => (
              <option key={campaignId} value={campaignId}>
                {campaignName}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div ref={setViewportControlsTarget} className="flex h-8 w-14 shrink-0 items-center justify-center" />
    </div>
  );

  return (
    <>
      <WorkspacePageShell
        title="Email"
        subtitle={pageSubtitle}
        contentClassName=""
        hideHeader
        preHeader={
          <EmailTabs
            tabs={tabs}
            activeTab={view}
            onSelectTab={(tabId) => {
              if (tabId === 'templates') {
                router.push('/templates');
                return;
              }
              if (tabId === 'campaigns' || tabId === 'review' || tabId === 'scheduled' || tabId === 'history') {
                setEmailView(tabId);
              }
            }}
          />
        }
        preHeaderAffectsLayout
        preHeaderClassName="h-14 flex items-end"
        toolbar={inlineControls}
      >
        {showSettings && emailConfig ? (
          <SettingsPanel emailConfig={emailConfig} onUpdateConfig={(data) => updateConfig.mutate(data)} />
        ) : null}

        {view === 'campaigns' && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 overflow-hidden bg-surface">
              <div className="min-h-0 min-w-0 flex-1">
                <CampaignsView
                  campaigns={filteredCampaigns}
                  campaignScheduleSummary={campaignScheduleSummary}
                  isLoading={campaignsLoading}
                  searchQuery={emailSearch}
                  viewportControlsTarget={viewportControlsTarget}
                  renderHeaderActionsMenu={(closeMenu) => (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettings((prev) => !prev);
                          closeMenu();
                        }}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                      >
                        {showSettings ? 'Hide settings' : 'Email settings'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateModal(true);
                          closeMenu();
                        }}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                      >
                        New campaign
                      </button>
                    </>
                  )}
                  withinCard
                  selectedCampaignId={selectedCampaign?.id ?? null}
                  onSelectCampaign={(campaign) => setSelectedCampaignId(campaign.id)}
                  onCreateCampaign={() => setShowCreateModal(true)}
                  onEditTemplates={setEditingTemplates}
                  onDelete={(id) => deleteCampaign.mutate(id)}
                  onActivate={(id) => activateCampaign.mutate(id)}
                  onPause={(id) => pauseCampaign.mutate(id)}
                  onViewContacts={() => {
                    addNotification({
                      type: 'info',
                      title: 'View contacts',
                      message: 'Go to Contacts tab and filter by this campaign',
                    });
                  }}
                  onSendEmails={(id) => sendEmails.mutate({ campaignId: id, limit: 500, reviewMode: true })}
                  onUploadToSalesforce={handleUploadToSalesforce}
                  uploadingCampaignId={uploadingCampaignId}
                />
              </div>
              {!isPhone && templateEditorOpen && editingTemplates ? (
                <SidePanelContainer ariaLabel="Campaign template editor panel">
                  <CampaignTemplateEditorPane
                    campaign={editingTemplates}
                    onClose={() => setEditingTemplates(null)}
                    onSave={handleSaveTemplates}
                  />
                </SidePanelContainer>
              ) : !isPhone && selectedCampaign ? (
                <SidePanelContainer ariaLabel="Campaign details panel">
                  <CampaignDetailsPanel
                    campaign={selectedCampaign}
                    onClose={() => setSelectedCampaignId(null)}
                    onEditTemplates={setEditingTemplates}
                  />
                </SidePanelContainer>
              ) : null}
            </div>
          </div>
        )}

        {view === 'review' && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 overflow-hidden bg-surface">
              <div className="flex min-w-0 min-h-0 flex-1 flex-col">
                <StandardEmailTable
                  columns={reviewColumns}
                  rows={filteredReviewQueue}
                  storageKey="review-table-v2"
                  viewportControlsTarget={viewportControlsTarget}
                  renderHeaderActionsMenu={(closeMenu) => (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          prepareBatch.mutate();
                          closeMenu();
                        }}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                      >
                        Prepare batch
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          approveAll.mutate(filteredReviewQueue.map((item) => item.id));
                          closeMenu();
                        }}
                        disabled={filteredReviewQueue.length === 0 || approveAll.isPending}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover disabled:opacity-50"
                      >
                        Approve all
                      </button>
                    </>
                  )}
                  rowId={(item) => item.id}
                  selectedId={selectedEmailPanel?.mode === 'review' ? selectedEmailPanel.email.id : null}
                  isCompact={isCompact}
                  renderCompactRow={renderCompactReviewRow}
                  onSelectRow={(item, element) => openEmailDetails(item.id, element)}
                  getRowAriaLabel={(item) => `Open review details for ${item.contact_name}`}
                  renderRowActionsMenu={(item, closeMenu) => (
                    <button
                      type="button"
                      data-row-control
                      onClick={() => {
                        const element = lastFocusedRowRef.current ?? document.body;
                        openEmailDetails(item.id, element as HTMLElement);
                        closeMenu();
                      }}
                      className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                    >
                      Open details
                    </button>
                  )}
                  emptyState={
                    <div className="text-center text-text-muted">
                      <CheckCircle className="mx-auto mb-3 h-10 w-10 opacity-50" />
                      <p className="text-sm font-medium text-text">No emails pending review</p>
                      <p className="mt-1 text-xs">Prepare a batch to generate fresh drafts.</p>
                    </div>
                  }
                />
              </div>
              {!isPhone && emailDetailsContent ? (
                <SidePanelContainer ref={detailsPanelRef} ariaLabel="Email details panel">
                  <div id="email-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                    {emailDetailsContent}
                  </div>
                </SidePanelContainer>
              ) : null}
            </div>
          </div>
        )}

        {view === 'history' && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 overflow-hidden bg-surface">
              <div className="flex min-w-0 min-h-0 flex-1 flex-col">
                <StandardEmailTable
                  columns={historyColumns}
                  rows={filteredSentEmails}
                  storageKey="history-table"
                  viewportControlsTarget={viewportControlsTarget}
                  renderHeaderActionsMenu={(closeMenu) => (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettings((prev) => !prev);
                          closeMenu();
                        }}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                      >
                        {showSettings ? 'Hide settings' : 'Email settings'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateModal(true);
                          closeMenu();
                        }}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                      >
                        New campaign
                      </button>
                    </>
                  )}
                  rowId={(item) => item.id}
                  selectedId={selectedEmailPanel?.mode === 'history' ? selectedEmailPanel.email.id : null}
                  isCompact={isCompact}
                  renderCompactRow={renderCompactHistoryRow}
                  onSelectRow={(item, element) => openEmailDetails(item.id, element)}
                  getRowAriaLabel={(item) => `Open sent email details for ${item.contact_name}`}
                  renderRowActionsMenu={(item, closeMenu) => (
                    <button
                      type="button"
                      data-row-control
                      onClick={() => {
                        const element = lastFocusedRowRef.current ?? document.body;
                        openEmailDetails(item.id, element as HTMLElement);
                        closeMenu();
                      }}
                      className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                    >
                      Open details
                    </button>
                  )}
                  emptyState={
                    <div className="text-center text-text-muted">
                      <Mail className="mx-auto mb-3 h-10 w-10 opacity-50" />
                      <p className="text-sm font-medium text-text">No emails sent yet</p>
                      <p className="mt-1 text-xs">Processed messages will appear here with engagement history.</p>
                    </div>
                  }
                />
              </div>
              {!isPhone && emailDetailsContent ? (
                <SidePanelContainer ref={detailsPanelRef} ariaLabel="Email details panel">
                  <div id="email-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                    {emailDetailsContent}
                  </div>
                </SidePanelContainer>
              ) : null}
            </div>
          </div>
        )}

        {view === 'scheduled' && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 overflow-hidden bg-surface">
              <div className="flex min-w-0 min-h-0 flex-1 flex-col">
                <StandardEmailTable
                  columns={scheduledColumns}
                  rows={filteredScheduledRows}
                  storageKey="scheduled-table"
                  viewportControlsTarget={viewportControlsTarget}
                  renderHeaderActionsMenu={(closeMenu) => (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          processScheduled.mutate(true);
                          closeMenu();
                        }}
                        disabled={filteredScheduledRows.length === 0 || (processScheduled.isPending && processScheduled.variables === true)}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover disabled:opacity-50"
                      >
                        Review in tabs
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          processScheduled.mutate(false);
                          closeMenu();
                        }}
                        disabled={filteredScheduledRows.length === 0 || (processScheduled.isPending && processScheduled.variables !== true)}
                        className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover disabled:opacity-50"
                      >
                        Process due
                      </button>
                    </>
                  )}
                  rowId={(item) => item.id}
                  selectedId={selectedEmailPanel?.mode === 'scheduled' ? selectedEmailPanel.email.id : null}
                  isCompact={isCompact}
                  renderCompactRow={renderCompactScheduledRow}
                  onSelectRow={(item, element) => openEmailDetails(item.id, element)}
                  getRowAriaLabel={(item) => `Open scheduled email details for ${item.contact_name}`}
                  renderRowActionsMenu={(item, closeMenu) => (
                    <button
                      type="button"
                      data-row-control
                      onClick={() => {
                        const element = lastFocusedRowRef.current ?? document.body;
                        openEmailDetails(item.id, element as HTMLElement);
                        closeMenu();
                      }}
                      className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                    >
                      Open details
                    </button>
                  )}
                  emptyState={
                    <div className="text-center text-text-muted">
                      <Clock className="mx-auto mb-3 h-10 w-10 opacity-50" />
                      <p className="text-sm font-medium text-text">No scheduled emails</p>
                      <p className="mt-1 text-xs">Approved drafts appear here with their send time.</p>
                    </div>
                  }
                />
              </div>
              {!isPhone && emailDetailsContent ? (
                <SidePanelContainer ref={detailsPanelRef} ariaLabel="Email details panel">
                  <div id="email-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                    {emailDetailsContent}
                  </div>
                </SidePanelContainer>
              ) : null}
            </div>
          </div>
        )}
      </WorkspacePageShell>

      {showCreateModal && <CampaignModal onClose={() => setShowCreateModal(false)} onSave={handleCreateCampaign} />}

      {isPhone && templateEditorOpen && editingTemplates ? (
        <BottomDrawerContainer onClose={() => setEditingTemplates(null)} ariaLabel="Campaign template editor drawer">
          <CampaignTemplateEditorPane
            campaign={editingTemplates}
            onClose={() => setEditingTemplates(null)}
            onSave={handleSaveTemplates}
          />
        </BottomDrawerContainer>
      ) : null}

      {isPhone && !templateEditorOpen && selectedCampaign ? (
        <BottomDrawerContainer onClose={() => setSelectedCampaignId(null)} ariaLabel="Campaign details drawer">
          <CampaignDetailsPanel
            campaign={selectedCampaign}
            onClose={() => setSelectedCampaignId(null)}
            onEditTemplates={setEditingTemplates}
          />
        </BottomDrawerContainer>
      ) : null}

      {isPhone && emailDetailsContent ? (
        <BottomDrawerContainer onClose={closeEmail} ariaLabel="Email details drawer">
          {emailDetailsContent}
        </BottomDrawerContainer>
      ) : null}

      {sendNowTarget && (
        <SendNowConfirm
          email={sendNowTarget}
          isSending={sendEmailNow.isPending}
          onConfirm={handleSendNowConfirm}
          onCancel={() => setSendNowTarget(null)}
        />
      )}
    </>
  );
}

