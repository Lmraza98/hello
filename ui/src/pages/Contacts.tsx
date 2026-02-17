import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { usePageContext } from '../contexts/PageContextProvider';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnFiltersState,
  type SortingState,
  type ExpandedState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../api';
import { useIsMobile } from '../hooks/useIsMobile';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useContacts } from '../hooks/useContacts';
import { AddContactModal } from '../components/contacts/AddContactModal';
import { ContactDetail } from '../components/contacts/ContactDetail';
import { FilterPanel } from '../components/contacts/FilterPanel';
import { ContactCard } from '../components/contacts/ContactCard';
import { BulkActionsBar } from '../components/contacts/BulkActionsBar';
import { SearchToolbar } from '../components/shared/SearchToolbar';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { CampaignEnrollmentModal } from '../components/contacts/CampaignEnrollmentModal';
import { createContactColumns } from '../components/contacts/tableColumns';
import { Users, Download, Plus, X } from 'lucide-react';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

/* ── Constants ─────────────────────────── */

const ROW_HEIGHT = 52;
const EXPANDED_HEIGHT = 170;
const MOBILE_ROW_HEIGHT = 72;
const MOBILE_EXPANDED_HEIGHT = 320;

/* ── Main Component ────────────────────────────────────── */

export default function Contacts({ openAddModal, onModalOpened }: { openAddModal?: boolean; onModalOpened?: () => void }) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { setPageContext } = usePageContext();
  const { addNotification, updateNotification } = useNotificationContext();
  const {
    contacts,
    contactsLoading: isLoading,
    campaigns,
    companies,
    getCampaignContacts,
    addContact,
    deleteContact,
    bulkDeleteContacts,
    bulkAction,
    enrollInCampaign,
  } = useContacts();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmDeleteSingle, setConfirmDeleteSingle] = useState<{ id: number; name: string } | null>(null);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'company_name', desc: false }]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [campaignFilterId, setCampaignFilterId] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  useRegisterCapabilities(getPageCapability('contacts'));
  const filterRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { data: campaignContacts = [] } = getCampaignContacts(campaignFilterId);

  const campaignContactIds = useMemo(() => {
    if (!campaignFilterId || !campaignContacts.length) return new Set<number>();
    return new Set(campaignContacts.map((cc: any) => cc.contact_id));
  }, [campaignFilterId, campaignContacts]);

  const companyNames = useMemo(() => Array.from(new Set(companies.map(c => c.company_name))).sort(), [companies]);

  useEffect(() => {
    if (openAddModal) {
      setShowAddModal(true);
      onModalOpened?.();
    }
  }, [openAddModal, onModalOpened]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setGlobalFilter(normalizeQueryFilterParam('q', params.get('q')) || '');
    setCampaignFilterId(params.get('campaignId') || '');

    const nextFilters: ColumnFiltersState = [];
    const company = normalizeQueryFilterParam('company', params.get('company'));
    const vertical = normalizeQueryFilterParam('vertical', params.get('vertical'));
    const hasEmail = normalizeQueryFilterParam('hasEmail', params.get('hasEmail'));
    if (company) nextFilters.push({ id: 'company_name', value: company });
    if (vertical) nextFilters.push({ id: 'vertical', value: vertical });
    if (hasEmail === 'true') nextFilters.push({ id: 'hasEmail', value: 'yes' });
    if (hasEmail === 'false') nextFilters.push({ id: 'hasEmail', value: 'no' });
    setColumnFilters(nextFilters);
  }, [location.search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    }
    if (showFilters && !isMobile) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFilters, isMobile]);

  /* ── Table configuration ── */

  const columns = useMemo(
    () => createContactColumns((id, name) => {
      setConfirmDeleteSingle({ id, name });
    }),
    []
  );

  /* ── Pre-filter data for virtual filters ── */

  const tableData = useMemo(() => {
    let data = contacts;
    if (campaignFilterId && campaignContactIds.size > 0) {
      data = data.filter(c => campaignContactIds.has(c.id));
    }
    const hasEmailFilter = columnFilters.find(f => f.id === 'hasEmail')?.value as string | undefined;
    if (hasEmailFilter === 'yes') data = data.filter(c => !!c.email);
    else if (hasEmailFilter === 'no') data = data.filter(c => !c.email);
    const verticalFilter = columnFilters.find(f => f.id === 'vertical')?.value as string | undefined;
    if (verticalFilter) {
      const selected = verticalFilter
        .trim()
        .toLowerCase()
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (selected.length > 0) {
        data = data.filter(c => selected.includes((c.vertical || '').toLowerCase().trim()));
      }
    }
    return data;
  }, [contacts, campaignFilterId, campaignContactIds, columnFilters]);

  const realColumnFilters = useMemo(
    () => columnFilters.filter(f => !['hasEmail', 'vertical'].includes(f.id)), [columnFilters]);

  /* ── Table ── */

  const table = useReactTable({
    data: tableData,
    columns,
    state: { globalFilter, columnFilters: realColumnFilters, sorting, expanded, rowSelection },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: (updater) => {
      const virtualFilters = columnFilters.filter(f => ['hasEmail', 'vertical'].includes(f.id));
      const next = typeof updater === 'function' ? updater(realColumnFilters) : updater;
      setColumnFilters([...virtualFilters, ...next]);
    },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    globalFilterFn: (row, _id, filterValue) => {
      const term = filterValue.toLowerCase();
      const c = row.original;
      return c.name.toLowerCase().includes(term) ||
        c.company_name.toLowerCase().includes(term) ||
        (c.title?.toLowerCase().includes(term) ?? false) ||
        (c.email?.toLowerCase().includes(term) ?? false);
    },
  });

  const { rows } = table.getRowModel();
  const filteredCount = table.getFilteredRowModel().rows.length;
  const selectedIds = Object.keys(rowSelection).map(Number);
  const selectedCount = selectedIds.length;
  const activeFilterCount = columnFilters.length + (campaignFilterId ? 1 : 0);
  const emailCount = contacts.filter(c => c.email).length;

  /* ── Virtualizer ── */

  const baseHeight = isMobile ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;
  const expandedExtra = isMobile ? MOBILE_EXPANDED_HEIGHT : EXPANDED_HEIGHT;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(
      (index: number) => rows[index]?.getIsExpanded() ? baseHeight + expandedExtra : baseHeight,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, expanded, baseHeight, expandedExtra],
    ),
    overscan: 20,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [expanded, rowVirtualizer, isMobile]);


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

  /* ── Filter pills ── */

  const allFilterPills = useMemo(() => {
    const pills: { id: string; label: string }[] = [];
    columnFilters.forEach((f) => {
      const labels: Record<string, string> = { hasEmail: 'email', salesforce_status: 'salesforce', company_name: 'company' };
      pills.push({ id: f.id, label: `${labels[f.id] || f.id}: ${f.value}` });
    });
    if (campaignFilterId) {
      const camp = campaigns.find(c => String(c.id) === campaignFilterId);
      pills.push({ id: 'campaign', label: `campaign: ${camp?.name || campaignFilterId}` });
    }
    return pills;
  }, [columnFilters, campaignFilterId, campaigns]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const selectedContactId = Number(params.get('selectedContactId'));
    setPageContext({
      listContext: 'contacts',
      selected: Number.isFinite(selectedContactId) ? { contactId: selectedContactId } : {},
      loadedIds: { contactIds: contacts.slice(0, 200).map((c) => c.id) },
    });
  }, [contacts, location.search, setPageContext]);

  /* ── Synced column widths (desktop) ── */

  const colGroup = !isMobile ? (
    <colgroup>
      {table.getHeaderGroups()[0]?.headers.map((h) => (
        <col key={h.id} style={{ width: `${h.getSize()}px` }} />
      ))}
    </colgroup>
  ) : null;

  /* ── Render ── */

  return (
    <div className="h-full flex flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-bg pb-3 md:pb-6">
        <div className="pt-5 px-4 md:pt-8 md:px-8">
          <PageHeader
            title="Contacts"
            subtitle={`${contacts.length} contacts · ${emailCount} with emails${filteredCount !== contacts.length ? ` · ${filteredCount} shown` : ''}`}
            desktopActions={
              <>
                <button onClick={() => api.exportContacts(false)}
                  className="flex items-center gap-2 px-4 py-2 border border-border text-text-muted rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors">
                  <Download className="w-4 h-4" /> Export CSV
                </button>
                <button onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors">
                  <Plus className="w-4 h-4" /> Add Contact
                </button>
              </>
            }
            mobileActions={
              <>
                <button onClick={() => api.exportContacts(false)}
                  className="p-2 border border-border text-text-muted rounded-lg hover:bg-surface-hover transition-colors">
                  <Download className="w-4 h-4" />
                </button>
                <button onClick={() => setShowAddModal(true)}
                  className="p-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </>
            }
          />

          {/* Bulk Actions */}
          <BulkActionsBar
            selectedCount={selectedCount}
            onSalesforceUpload={handleBulkSalesforceUpload}
            onLinkedInRequest={() => handleBulkAction('linkedin-request', 'linkedin', 'Sending LinkedIn requests')}
            onSendEmail={() => handleBulkAction('send-email', 'email', 'Sending emails')}
            onCollectPhone={() => handleBulkAction('collect-phone', 'phone', 'Collecting phone data')}
            onEnrollInCampaign={() => setShowCampaignModal(true)}
            onDelete={handleBulkDelete}
            actionLoading={actionLoading}
          />

          {/* Toolbar */}
          <SearchToolbar
            allSelected={table.getIsAllRowsSelected()}
            onToggleSelectAll={table.getToggleAllRowsSelectedHandler()}
            indeterminate={table.getIsSomeRowsSelected()}
            displayCount={selectedCount > 0 ? selectedCount : filteredCount}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            activeFilterCount={activeFilterCount}
            showFilters={showFilters && !isMobile}
            onToggleFilters={() => setShowFilters((v) => !v)}
            filterPanelContent={
              <FilterPanel
                columnFilters={columnFilters}
                setColumnFilters={setColumnFilters}
                contacts={contacts}
                campaigns={campaigns}
                onCampaignChange={setCampaignFilterId}
                activeCampaignId={campaignFilterId}
                onClose={() => setShowFilters(false)}
                isMobile={false}
              />
            }
          />

          {/* Filter pills — scrollable on mobile */}
          {allFilterPills.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar">
              {allFilterPills.map((pill) => (
                <span key={pill.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent rounded-full text-[11px] font-medium whitespace-nowrap shrink-0">
                  {pill.label}
                  <button onClick={() => {
                    if (pill.id === 'campaign') setCampaignFilterId('');
                    else setColumnFilters((prev) => prev.filter((f) => f.id !== pill.id));
                  }} className="hover:text-accent/70">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter bottom sheet */}
      {showFilters && isMobile && (
        <FilterPanel
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          contacts={contacts}
          campaigns={campaigns}
          onCampaignChange={setCampaignFilterId}
          activeCampaignId={campaignFilterId}
          onClose={() => setShowFilters(false)}
          isMobile
        />
      )}

      {/* Virtualized Table / List */}
      <div className="flex-1 min-h-0 px-4 md:px-8 pb-4 md:pb-8">
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col h-full">
            {/* Desktop: fixed thead — ONLY on desktop */}
            {!isMobile && (
              <div className="shrink-0">
                <table className="w-full min-w-[900px]" style={{ tableLayout: 'fixed' }}>
                  {colGroup}
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id} className="border-b border-border bg-surface-hover/50">
                        {headerGroup.headers.map((header) => (
                          <th key={header.id}
                            className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                </table>
              </div>
            )}

            {/* Scrollable virtualized body */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No contacts found"
                  description="Try adjusting your filters or add a new contact"
                  action={{ label: 'Add Contact', icon: Plus, onClick: () => setShowAddModal(true) }}
                />
              ) : (
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative', minWidth: isMobile ? undefined : '900px' }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    const isExpanded = row.getIsExpanded();
                    const contact = row.original;

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
                        {isMobile ? (
                          /* ── Mobile: Card layout ── */
                          <ContactCard
                            contact={contact}
                            isSelected={row.getIsSelected()}
                            isExpanded={isExpanded}
                            onToggleSelect={() => row.toggleSelected()}
                            onToggleExpand={() => row.toggleExpanded()}
                          />
                        ) : (
                          /* ── Desktop: Table row ── */
                          <table className="w-full" style={{ tableLayout: 'fixed' }}>
                            {colGroup}
                            <tbody>
                              <tr
                                className="hover:bg-surface-hover/60 transition-colors cursor-pointer border-b border-border-subtle"
                                onClick={(e) => {
                                  if ((e.target as HTMLElement).closest('input[type="checkbox"], a, button')) return;
                                  row.toggleExpanded();
                                }}
                              >
                                {row.getVisibleCells().map((cell) => (
                                  <td key={cell.id} className="px-4 py-3.5">
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </td>
                                ))}
                              </tr>
                              {isExpanded && (
                                <tr className="bg-surface-hover/30 border-b border-border-subtle">
                                  <td colSpan={row.getVisibleCells().length} className="p-0">
                                    <div className="px-6 py-4 overflow-x-auto">
                                      <ContactDetail contact={contact} />
                                    </div>
                                  </td>
                                </tr>
                              )}
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
        )}
      </div>

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

      {/* Add Contact Modal */}
      {showAddModal && (
        <AddContactModal
          companies={companyNames}
          onAdd={(data) => {
            addContact.mutate(data);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
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
    </div>
  );
}
