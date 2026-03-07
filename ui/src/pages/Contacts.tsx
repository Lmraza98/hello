import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePageContext } from '../contexts/PageContextProvider';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../api';
import type { Contact } from '../api';
import { useIsMobile } from '../hooks/useIsMobile';
import { useContactDetailsRouteState } from '../hooks/useContactDetailsRouteState';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useContacts } from '../hooks/useContacts';
import { AddContactPanelContent } from '../components/contacts/AddContactPanelContent';
import { ContactCard } from '../components/contacts/ContactCard';
import { ContactDetailsContent } from '../components/contacts/ContactDetailsContent';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { HeaderActionButton } from '../components/shared/HeaderActionButton';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { CampaignEnrollmentModal } from '../components/contacts/CampaignEnrollmentModal';
import { createContactColumns } from '../components/contacts/tableColumns';
import { EmailTabs } from '../components/email/EmailTabs';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import { getContactSourceLabel } from '../components/contacts/sourceLabel';
import { Users, Download, Loader2, Phone, Plus, RotateCcw, Send, SlidersHorizontal, Target, Trash2, Upload, UserPlus } from 'lucide-react';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

/* ── Constants ─────────────────────────── */

const ROW_HEIGHT = 42;
const MOBILE_ROW_HEIGHT = 72;
type ContactsView = 'all' | 'sources' | 'pipeline';

function parseContactsView(value: string | null): ContactsView {
  if (value === 'sources' || value === 'pipeline' || value === 'all') return value;
  return 'all';
}

function sortContactsByRecency(data: Contact[]) {
  return [...data].sort((a, b) => {
    const ta = a.scraped_at ? Date.parse(a.scraped_at) : Number.NaN;
    const tb = b.scraped_at ? Date.parse(b.scraped_at) : Number.NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    if (Number.isFinite(tb)) return 1;
    if (Number.isFinite(ta)) return -1;
    return b.id - a.id;
  });
}

/* ── Main Component ────────────────────────────────────── */

export default function Contacts({ openAddModal, onModalOpened }: { openAddModal?: boolean; onModalOpened?: () => void }) {
  const router = useRouter();
  const isCompact = useIsMobile();
  const isPhone = useIsMobile(640);
  const searchParams = useSearchParams();
  const { setPageContext } = usePageContext();
  const { addNotification, updateNotification } = useNotificationContext();
  const {
    contacts,
    contactsLoading: isLoading,
    contactsError,
    refetchContacts,
    campaigns,
    companies,
    addContact,
    deleteContact,
    bulkDeleteContacts,
    bulkAction,
    enrollInCampaign,
  } = useContacts();

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmDeleteSingle, setConfirmDeleteSingle] = useState<{ id: number; name: string } | null>(null);
  const [globalFilter, setGlobalFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [engagementFilter, setEngagementFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const { contactId: selectedContactId, openContact, closeContact, setContactId } = useContactDetailsRouteState();
  const view = useMemo(() => parseContactsView(searchParams?.get('view') ?? null), [searchParams]);
  useRegisterCapabilities(getPageCapability('contacts'));
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const filtersMenuRef = useRef<HTMLDivElement>(null);
  const lastFocusedRowRef = useRef<HTMLElement | null>(null);
  const newContactButtonRef = useRef<HTMLButtonElement>(null);
  const detailsPanelRef = useRef<HTMLDivElement>(null);

  const closeAddPanel = useCallback((options?: { restoreFocus?: boolean }) => {
    setShowAddPanel(false);
    if (options?.restoreFocus === false) return;
    const id = window.requestAnimationFrame(() => newContactButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, []);

  const openAddPanel = useCallback(() => {
    setShowAddPanel(true);
    closeContact();
  }, [closeContact]);

  const handleOpenContact = useCallback(
    (contactId: number) => {
      setShowAddPanel(false);
      openContact(contactId);
    },
    [openContact]
  );

  const filterSearchKey = useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('contactId');
    params.delete('view');
    return params.toString();
  }, [searchParams]);

  const companyNames = useMemo(() => Array.from(new Set(companies.map(c => c.company_name))).sort(), [companies]);
  const sourceOptions = useMemo(
    () => Array.from(new Set(contacts.map((contact) => getContactSourceLabel(contact)))).sort((a, b) => a.localeCompare(b)),
    [contacts]
  );

  useEffect(() => {
    if (openAddModal) {
      const id = window.requestAnimationFrame(() => {
        openAddPanel();
        onModalOpened?.();
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [openAddModal, onModalOpened, openAddPanel]);

  const updateContactsRoute = useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      mutate(params);
      const search = params.toString();
      const nextUrl = `/contacts${search ? `?${search}` : ''}`;
      if (options?.replace ?? false) {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [router, searchParams]
  );

  const setContactsView = useCallback(
    (nextView: ContactsView) => {
      updateContactsRoute((params) => {
        params.set('view', nextView);
        params.delete('contactId');
      });
    },
    [updateContactsRoute]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filtersMenuRef.current && !filtersMenuRef.current.contains(event.target as Node)) {
        setShowFiltersMenu(false);
      }
    }
    if (!showFiltersMenu) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFiltersMenu]);

  useEffect(() => {
    if (isPhone) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showAddPanel) {
        closeAddPanel();
        return;
      }
      closeContact();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAddPanel, closeContact, isPhone, showAddPanel]);

  useEffect(() => {
    const params = new URLSearchParams(filterSearchKey);
    setGlobalFilter(normalizeQueryFilterParam('q', params.get('q')) || '');
    const company = normalizeQueryFilterParam('company', params.get('company'));
    const hasEmail = normalizeQueryFilterParam('hasEmail', params.get('hasEmail'));
    const status = normalizeQueryFilterParam('status', params.get('status'));
    const source = normalizeQueryFilterParam('source', params.get('source'));
    setCompanyFilter(company || '');
    setEmailFilter(hasEmail === 'true' ? 'yes' : hasEmail === 'false' ? 'no' : '');
    setEngagementFilter(status || '');
    setSourceFilter(source || '');
  }, [filterSearchKey]);

  /* ── Table configuration ── */

  const columns = useMemo(
    () =>
      createContactColumns(
        (id, name) => {
          setConfirmDeleteSingle({ id, name });
        },
        { compact: true }
      ),
    []
  );

  const displayContacts = useMemo(() => {
    let data = contacts;
    if (view === 'sources' && sourceFilter) {
      const target = sourceFilter.trim().toLowerCase();
      data = data.filter((contact) => getContactSourceLabel(contact).toLowerCase() === target);
    }
    return sortContactsByRecency(data);
  }, [contacts, sourceFilter, view]);

  const tableData = useMemo(() => {
    let data = displayContacts;
    const search = globalFilter.trim().toLowerCase();
    if (search) {
      data = data.filter((c) => {
        return (
          c.name.toLowerCase().includes(search) ||
          c.company_name.toLowerCase().includes(search) ||
          (c.title?.toLowerCase().includes(search) ?? false) ||
          (c.email?.toLowerCase().includes(search) ?? false)
        );
      });
    }

    const companyValue = companyFilter.trim().toLowerCase();
    if (companyValue) data = data.filter((c) => c.company_name.toLowerCase().includes(companyValue));
    if (emailFilter === 'yes' || emailFilter === 'has') data = data.filter((c) => !!c.email);
    if (emailFilter === 'no') data = data.filter((c) => !c.email);
    if (view !== 'sources' && engagementFilter) {
      const target = engagementFilter.trim().toLowerCase();
      data = data.filter((c) => (c.engagement_status || 'needs_sync').toLowerCase() === target);
    }
    return sortContactsByRecency(data);
  }, [
    displayContacts,
    globalFilter,
    companyFilter,
    emailFilter,
    engagementFilter,
    view,
  ]);

  const selectedContact = useMemo(
    () => (selectedContactId ? tableData.find((c) => c.id === selectedContactId) ?? null : null),
    [selectedContactId, tableData]
  );

  useEffect(() => {
    if (!selectedContactId) return;
    if (isLoading) return;
    if (!selectedContact) setContactId(null, { replace: true });
  }, [isLoading, selectedContact, selectedContactId, setContactId]);

  useEffect(() => {
    if ((!selectedContact && !showAddPanel) || isPhone) return;
    const id = window.requestAnimationFrame(() => {
      detailsPanelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [selectedContact, showAddPanel, isPhone]);

  useEffect(() => {
    if (selectedContactId) return;
    if (isPhone) return;
    lastFocusedRowRef.current?.focus();
  }, [selectedContactId, isPhone]);

  /* ── Table ── */

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    autoResetAll: false,
  });

  const { rows } = table.getRowModel();
  const filteredCount = rows.length;
  const selectedIds = Object.keys(rowSelection).map(Number);
  const selectedCount = selectedIds.length;
  const emailCount = contacts.filter(c => c.email).length;
  const columnLabelMap: Record<string, string> = {
    name: 'Name',
    title: 'Title',
    company_name: 'Company',
    email: 'Email',
    lead_source: 'Source',
    engagement_status: 'Status',
  };
  const toggleableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.id !== 'select' && column.id !== 'actions' && column.id !== 'name');

  const isInteractiveTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      'input, button, a, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [data-row-control]'
    );
  }, []);

  /* ── Virtualizer ── */

  const baseHeight = isCompact ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(() => baseHeight, [baseHeight]),
    overscan: 20,
  });


  /* ── Bulk Action Handlers ── */

  const handleBulkSalesforceUpload = async () => {
    if (selectedCount === 0) return;
    setActionLoading('salesforce');
    const notificationId = addNotification({
      type: 'loading',
      title: 'Preparing Salesforce upload...',
      message: `Creating CSV for ${selectedCount} contacts`,
      duration: 0,
    });
    try {
      const res = await fetch('/api/contacts/bulk-actions/salesforce-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: selectedIds }),
      });
      const data = await res.json();
      if (data.success) {
        const link = document.createElement('a');
        link.href = `/api/contacts/salesforce-csv/${data.csv_filename}`;
        link.download = data.csv_filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        updateNotification(notificationId, {
          type: 'success',
          title: 'Ready for Salesforce',
          message: `CSV downloaded with ${data.exported} contacts.`,
          duration: 10000,
        });
      } else {
        updateNotification(notificationId, {
          type: 'error',
          title: 'Upload Failed',
          message: data.error || 'Failed to create CSV',
        });
      }
    } catch (error) {
      updateNotification(notificationId, {
        type: 'error',
        title: 'Upload Failed',
        message: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkAction = (action: string, loadingKey: string, title: string) => {
    if (selectedCount === 0) return;
    setActionLoading(loadingKey);
    const notificationId = addNotification({
      type: 'loading',
      title: `${title}...`,
      message: `Processing ${selectedCount} contacts`,
      duration: 0,
    });
    bulkAction.mutate({ action, contactIds: selectedIds, notificationId });
  };

  const handleEnrollInCampaign = (campaignId: number) => {
    enrollInCampaign.mutate(
      { campaignId, contactIds: selectedIds },
      {
        onSuccess: () => setShowCampaignModal(false),
        onSettled: () => setActionLoading(null),
      }
    );
  };

  const handleBulkDelete = () => {
    if (selectedCount === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmBulkDelete = () => {
    setActionLoading('delete');
    bulkDeleteContacts.mutate(selectedIds, {
      onSuccess: () => {
        setRowSelection({});
        setShowDeleteConfirm(false);
      },
      onSettled: () => setActionLoading(null),
    });
  };

  const handleAddContactToCampaign = useCallback((contact: Contact) => {
    setRowSelection({ [String(contact.id)]: true });
    setShowCampaignModal(true);
  }, []);

  useEffect(() => {
    setPageContext({
      listContext: 'contacts',
      selected: selectedContactId ? { contactId: selectedContactId } : {},
      loadedIds: { contactIds: tableData.slice(0, 200).map((c) => c.id) },
    });
  }, [selectedContactId, setPageContext, tableData]);

  /* ── Synced column widths (desktop) ── */

  const colGroup = !isCompact ? (
    <colgroup>
      {table.getHeaderGroups()[0]?.headers.map((h) => (
        <col key={h.id} style={{ width: `${h.getSize()}px` }} />
      ))}
    </colgroup>
  ) : null;

  /* ── Render ── */

  const tabs = useMemo(
    () => [
      { id: 'all', label: 'All Contacts' },
      { id: 'sources', label: 'Sources' },
      { id: 'pipeline', label: 'Pipeline / Status' },
    ],
    []
  );

  const inlineControls = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-[220px] flex-1">
        <PageSearchInput value={globalFilter} onChange={setGlobalFilter} placeholder="Search contacts..." />
      </div>
      {view === 'sources' ? (
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2.5 text-[12px] text-text focus:border-accent focus:outline-none"
          aria-label="Filter contacts by source"
        >
          <option value="">All sources</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={engagementFilter}
          onChange={(e) => setEngagementFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2.5 text-[12px] text-text focus:border-accent focus:outline-none"
          aria-label="Filter contacts by status"
        >
          <option value="">All statuses</option>
          <option value="replied">Replied</option>
          <option value="failed">Failed</option>
          <option value="completed">Completed</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_sequence">In Sequence</option>
          <option value="enrolled">Enrolled</option>
          <option value="synced">Synced to Salesforce</option>
          <option value="needs_sync">Needs Sync</option>
        </select>
      )}
      <div className="relative shrink-0" ref={filtersMenuRef}>
        <button
          type="button"
          onClick={() => setShowFiltersMenu((v) => !v)}
          className="h-8 w-8 inline-flex items-center justify-center border border-border rounded-md text-text-muted hover:bg-surface-hover"
          title="Columns"
          aria-label="Open column visibility menu"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        {showFiltersMenu ? (
          <div className="absolute right-0 top-10 z-20 w-[260px] rounded-md border border-border bg-surface p-3 shadow-lg">
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Visible Columns</p>
              {toggleableColumns.map((column) => (
                <label key={column.id} className="flex items-center gap-2 text-[12px] text-text">
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-accent focus:ring-accent"
                  />
                  <span>{columnLabelMap[column.id] ?? column.id}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {selectedCount > 0 ? (
        <>
          <span className="inline-flex h-8 items-center rounded-md border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-medium text-indigo-900">
            {selectedCount} selected
          </span>
          <HeaderActionButton
            compact
            onClick={handleBulkSalesforceUpload}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'salesforce' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          >
            SF
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => handleBulkAction('linkedin-request', 'linkedin', 'Sending LinkedIn requests')}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'linkedin' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          >
            LI
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => handleBulkAction('send-email', 'email', 'Sending emails')}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'email' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          >
            Email
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => handleBulkAction('collect-phone', 'phone', 'Collecting phone data')}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'phone' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
          >
            Phone
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => setShowCampaignModal(true)}
            disabled={actionLoading !== null}
            variant="secondary"
            icon={<Target className="w-3.5 h-3.5" />}
          >
            Campaign
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={handleBulkDelete}
            disabled={actionLoading !== null}
            variant="danger"
            icon={actionLoading === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          >
            Delete
          </HeaderActionButton>
        </>
      ) : null}
      <HeaderActionButton
        data-assistant-id="export-contacts-button"
        onClick={() => api.exportContacts(false)}
        variant="secondary"
        icon={<Download className="w-3.5 h-3.5" />}
      >
        Export CSV
      </HeaderActionButton>
      <HeaderActionButton
        data-assistant-id="new-contact-button"
        ref={newContactButtonRef}
        onClick={openAddPanel}
        variant="primary"
        icon={<Plus className="w-3.5 h-3.5" />}
      >
        New Contact
      </HeaderActionButton>
    </div>
  );

  return (
    <>
      <WorkspacePageShell
        title="Contacts"
        subtitle={`${contacts.length} contacts · ${emailCount} with emails${filteredCount !== contacts.length ? ` · ${filteredCount} shown` : ''}`}
        contentClassName="overflow-hidden"
        hideHeader
        preHeader={
          <EmailTabs
            tabs={tabs}
            activeTab={view}
            onSelectTab={(tabId) => {
              if (tabId === 'all' || tabId === 'sources' || tabId === 'pipeline') setContactsView(tabId);
            }}
          />
        }
        preHeaderAffectsLayout
        preHeaderClassName="-mt-3 md:-mt-4 h-14 flex items-end"
        toolbar={inlineControls}
      >
        <div className="min-h-0 flex-1 overflow-hidden pt-2">
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="bg-surface overflow-hidden flex h-full min-h-0">
              {/* min-w-0 prevents table pane overflow from forcing horizontal overflow in split mode. */}
              {/* min-h-0 allows inner scroll areas to size and scroll correctly inside nested flex containers. */}
              <div className="flex min-w-0 min-h-0 flex-1 flex-col">
                {!isCompact && (
                  <div className="shrink-0">
                    <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                      {colGroup}
                      <thead>
                        {table.getHeaderGroups().map((headerGroup) => (
                          <tr key={headerGroup.id} className="h-9 border-b border-border-subtle bg-surface-hover/30">
                            {headerGroup.headers.map((header) => (
                              <th
                                key={header.id}
                                className="text-left px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide"
                              >
                                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                              </th>
                            ))}
                          </tr>
                        ))}
                      </thead>
                    </table>
                  </div>
                )}

                <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-auto">
                  {contactsError ? (
                    <EmptyState
                      icon={Users}
                      title="Could not load contacts"
                      description={contactsError.message || 'Please retry.'}
                      action={{ label: 'Retry', icon: RotateCcw, onClick: () => void refetchContacts() }}
                    />
                  ) : rows.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title="No contacts found"
                      description="Try adjusting your filters or add a new contact"
                      action={{ label: 'New Contact', icon: Plus, onClick: openAddPanel }}
                    />
                  ) : (
                    <div
                      style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        position: 'relative',
                        minWidth: undefined,
                      }}
                    >
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        const contact = row.original;
                        const isActive = selectedContactId === contact.id;
                        const isSelected = row.getIsSelected();

                        return (
                          <div
                            key={row.id}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {isCompact ? (
                              <ContactCard
                                contact={contact}
                                isSelected={row.getIsSelected()}
                                isExpanded={false}
                                onToggleSelect={() => row.toggleSelected()}
                                onToggleExpand={() => handleOpenContact(contact.id)}
                              />
                            ) : (
                              <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                                {colGroup}
                                <tbody>
                                  <tr
                                    className={`group h-[42px] cursor-pointer border-b border-border-subtle transition-colors ${
                                      isActive ? 'bg-accent/12' : isSelected ? 'bg-accent/8' : 'hover:bg-surface-hover/60'
                                    }`}
                                    onClick={(e) => {
                                      if (isInteractiveTarget(e.target)) return;
                                      lastFocusedRowRef.current = e.currentTarget;
                                      handleOpenContact(contact.id);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter' && e.key !== ' ') return;
                                      if (isInteractiveTarget(e.target)) return;
                                      e.preventDefault();
                                      lastFocusedRowRef.current = e.currentTarget;
                                      handleOpenContact(contact.id);
                                    }}
                                    tabIndex={0}
                                    aria-expanded={isActive}
                                    aria-controls={isActive ? 'contact-details-panel' : undefined}
                                    aria-label={`Open details for ${contact.name}`}
                                  >
                                    {row.getVisibleCells().map((cell) => (
                                      <td key={cell.id} className="h-[42px] px-3 py-0 align-middle leading-tight">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              {!isPhone && (showAddPanel || selectedContact) ? (
                <SidePanelContainer ref={detailsPanelRef}>
                  {showAddPanel ? (
                    <div id="contact-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                      <AddContactPanelContent
                        companies={companyNames}
                        isSubmitting={addContact.isPending}
                        onAdd={(data) => {
                          addContact.mutate(data, {
                            onSuccess: () => {
                              setShowAddPanel(false);
                            },
                          });
                        }}
                        onClose={() => closeAddPanel()}
                      />
                    </div>
                  ) : selectedContact ? (
                    <div id="contact-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                      <ContactDetailsContent
                        contact={selectedContact}
                        onClose={closeContact}
                        onAddToCampaign={handleAddContactToCampaign}
                      />
                    </div>
                  ) : null}
                </SidePanelContainer>
              ) : null}
            </div>
          )}
        </div>
      </WorkspacePageShell>
      {isPhone && showAddPanel ? (
        <BottomDrawerContainer onClose={() => closeAddPanel()}>
          <AddContactPanelContent
            companies={companyNames}
            isSubmitting={addContact.isPending}
            onAdd={(data) => {
              addContact.mutate(data, {
                onSuccess: () => {
                  setShowAddPanel(false);
                },
              });
            }}
            onClose={() => closeAddPanel()}
          />
        </BottomDrawerContainer>
      ) : null}
      {isPhone && !showAddPanel && selectedContact ? (
        <BottomDrawerContainer onClose={closeContact}>
          <ContactDetailsContent
            contact={selectedContact}
            onClose={closeContact}
            onAddToCampaign={handleAddContactToCampaign}
          />
        </BottomDrawerContainer>
      ) : null}
      {/* Campaign Enrollment Modal */}
      {showCampaignModal && (
        <CampaignEnrollmentModal
          campaigns={campaigns}
          selectedCount={selectedCount}
          onEnroll={handleEnrollInCampaign}
          onClose={() => setShowCampaignModal(false)}
          isEnrolling={enrollInCampaign.isPending}
        />
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete ${selectedCount} contact${selectedCount !== 1 ? 's' : ''}?`}
        message="This action cannot be undone. The selected contacts will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmBulkDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Single Contact Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmDeleteSingle}
        title={`Delete ${confirmDeleteSingle?.name ?? 'contact'}?`}
        message="This contact will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmDeleteSingle) deleteContact.mutate(confirmDeleteSingle.id);
          setConfirmDeleteSingle(null);
        }}
        onCancel={() => setConfirmDeleteSingle(null)}
      />
    </>
  );
}



