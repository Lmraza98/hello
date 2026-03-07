import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  Edit3,
  Ellipsis,
  Mail,
  Pause,
  Play,
  Plus,
  Send,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { EmailCampaign, CampaignScheduleSummary } from '../../types/email';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { EmptyState } from '../shared/EmptyState';
import { LoadingSpinner } from '../shared/LoadingSpinner';

type CampaignsViewProps = {
  campaigns: EmailCampaign[];
  campaignScheduleSummary: CampaignScheduleSummary[];
  isLoading: boolean;
  searchQuery: string;
  withinCard?: boolean;
  selectedCampaignId?: number | null;
  onSelectCampaign?: (campaign: EmailCampaign) => void;
  onCreateCampaign: () => void;
  onEditTemplates: (campaign: EmailCampaign) => void;
  onDelete: (campaignId: number) => void;
  onActivate: (campaignId: number) => void;
  onPause: (campaignId: number) => void;
  onViewContacts: () => void;
  onSendEmails: (campaignId: number) => void;
  onUploadToSalesforce: (campaignId: number) => void;
  uploadingCampaignId: number | null;
};

function formatNextSend(value: string | null | undefined): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
}

function statusBadge(status: string) {
  const s = (status || 'draft').toLowerCase();
  if (s === 'active') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'paused') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (s === 'completed') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

export function CampaignsView({
  campaigns,
  campaignScheduleSummary,
  isLoading,
  searchQuery,
  withinCard = false,
  selectedCampaignId = null,
  onSelectCampaign,
  onCreateCampaign,
  onEditTemplates,
  onDelete,
  onActivate,
  onPause,
  onViewContacts,
  onSendEmails,
  onUploadToSalesforce,
  uploadingCampaignId,
}: CampaignsViewProps) {
  const isTablet = useIsMobile(1024);
  const isPhone = useIsMobile(640);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteIds, setDeleteIds] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [openActionsMenuId, setOpenActionsMenuId] = useState<number | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const filterRef = useRef<HTMLDivElement>(null);

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, a, input, select, textarea, label, [role="menu"], [role="menuitem"]'));
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    }
    if (showFilters && !isTablet) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFilters, isTablet]);

  useEffect(() => {
    function handleMenuOutsideClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-campaign-actions]')) setOpenActionsMenuId(null);
    }
    if (openActionsMenuId === null) return;
    document.addEventListener('mousedown', handleMenuOutsideClick);
    return () => document.removeEventListener('mousedown', handleMenuOutsideClick);
  }, [openActionsMenuId]);

  const summaryMap = useMemo(
    () => new Map(campaignScheduleSummary.map((s) => [s.campaign_id, s])),
    [campaignScheduleSummary],
  );

  const columns = useMemo<ColumnDef<EmailCampaign>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ table }) => (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={table.getIsAllRowsSelected()}
              ref={(input) => {
                if (input) input.indeterminate = table.getIsSomeRowsSelected();
              }}
              onChange={table.getToggleAllRowsSelectedHandler()}
              className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
            />
            <span>Campaign</span>
          </div>
        ),
        cell: ({ row }) => (
          <div className="min-w-0 text-xs font-medium text-text truncate">{row.original.name}</div>
        ),
        size: 210,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const value = String(getValue() || 'draft');
          return (
            <span className={`inline-flex px-1.5 py-0 text-[10px] font-medium rounded border capitalize ${statusBadge(value)}`}>
              {value}
            </span>
          );
        },
        size: 90,
      },
      {
        id: 'contacts',
        header: 'Contacts',
        accessorFn: (row) => row.stats?.total_contacts || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 72,
      },
      {
        id: 'sent',
        header: 'Sent',
        accessorFn: (row) => row.stats?.total_sent || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 64,
      },
      {
        id: 'pending_review',
        header: 'Pending Review',
        accessorFn: (row) => summaryMap.get(row.id)?.pending_review_count || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 100,
      },
      {
        id: 'scheduled_count',
        header: 'Scheduled',
        accessorFn: (row) => summaryMap.get(row.id)?.scheduled_count || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 72,
      },
      {
        id: 'next_send',
        header: 'Next Send',
        accessorFn: (row) => summaryMap.get(row.id)?.next_send_time || '',
        cell: ({ row }) => (
          <span className="block truncate text-[11px] text-text-muted">
            {formatNextSend(summaryMap.get(row.original.id)?.next_send_time)}
          </span>
        ),
        size: 150,
      },
      {
        id: 'actions',
        header: () => (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="h-7 w-7 inline-flex items-center justify-center border border-border rounded-md text-text-muted hover:bg-surface-hover"
              title="Columns"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
        cell: ({ row }) => {
          const campaign = row.original;
          const isActive = campaign.status === 'active';
          const isUploading = uploadingCampaignId === campaign.id;
          return (
            <div className="flex items-center justify-end gap-1 whitespace-nowrap">
              <button
                onClick={() => onEditTemplates(campaign)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                title="Edit templates"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onUploadToSalesforce(campaign.id)}
                disabled={isUploading}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover disabled:opacity-50"
                title="Upload to Salesforce"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => (isActive ? onPause(campaign.id) : onActivate(campaign.id))}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                title={isActive ? 'Pause campaign' : 'Activate campaign'}
              >
                {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => onSendEmails(campaign.id)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                title="Launch next emails in review tabs"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onViewContacts}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                title="View contacts"
              >
                <Mail className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDeleteId(campaign.id)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                title="Delete campaign"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        },
        enableSorting: false,
        size: 198,
      },
    ],
    [
      onActivate,
      onEditTemplates,
      onPause,
      onSendEmails,
      onUploadToSalesforce,
      onViewContacts,
      summaryMap,
      uploadingCampaignId,
      showFilters,
    ],
  );

  const tableData = campaigns;

  const table = useReactTable({
    data: tableData,
    columns,
    state: { globalFilter: searchQuery, sorting, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _id, filterValue) => {
      const q = String(filterValue || '').toLowerCase();
      return (
        row.original.name.toLowerCase().includes(q) ||
        (row.original.description || '').toLowerCase().includes(q)
      );
    },
  });

  const rows = table.getRowModel().rows;
  const selectedCampaignIds = useMemo(
    () =>
      table
        .getSelectedRowModel()
        .rows.map((row) => row.original.id)
        .filter((id): id is number => typeof id === 'number'),
    [table, rowSelection],
  );
  const columnLabelMap: Record<string, string> = {
    name: 'Campaign',
    status: 'Status',
    contacts: 'Contacts',
    sent: 'Sent',
    pending_review: 'Pending Review',
    scheduled_count: 'Scheduled',
    next_send: 'Next Send',
  };
  const toggleableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.id !== 'select' && column.id !== 'actions');

  const renderActionsMenu = (campaign: EmailCampaign) => {
    const isActive = campaign.status === 'active';
    const isUploading = uploadingCampaignId === campaign.id;
    const menuOpen = openActionsMenuId === campaign.id;

    return (
      <div className="relative" data-campaign-actions>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEditTemplates(campaign)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
            title="Edit templates"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setOpenActionsMenuId((prev) => (prev === campaign.id ? null : campaign.id))}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
            title="More actions"
          >
            <Ellipsis className="w-3.5 h-3.5" />
          </button>
        </div>
        {menuOpen ? (
          <div className="absolute right-0 top-8 z-20 w-44 rounded-md border border-border bg-surface p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                onUploadToSalesforce(campaign.id);
                setOpenActionsMenuId(null);
              }}
              disabled={isUploading}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-text hover:bg-surface-hover disabled:opacity-50"
            >
              Upload to Salesforce
            </button>
            <button
              type="button"
              onClick={() => {
                (isActive ? onPause : onActivate)(campaign.id);
                setOpenActionsMenuId(null);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-text hover:bg-surface-hover"
            >
              {isActive ? 'Pause campaign' : 'Activate campaign'}
            </button>
            <button
              type="button"
              onClick={() => {
                onSendEmails(campaign.id);
                setOpenActionsMenuId(null);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-text hover:bg-surface-hover"
            >
              Launch next emails
            </button>
            <button
              type="button"
              onClick={() => {
                onViewContacts();
                setOpenActionsMenuId(null);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-text hover:bg-surface-hover"
            >
              View contacts
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteId(campaign.id);
                setOpenActionsMenuId(null);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No campaigns yet"
        description="Create your first email campaign to get started."
        action={{ label: 'Create Campaign', icon: Plus, onClick: onCreateCampaign }}
      />
    );
  }

  return (
    <>
      {selectedCampaignIds.length > 0 && (
        <div className="mt-2 mb-2 flex items-center justify-between rounded-md border border-border bg-surface px-3 py-1.5">
          <p className="text-xs text-text-muted">
            {selectedCampaignIds.length} campaign{selectedCampaignIds.length === 1 ? '' : 's'} selected
          </p>
          <button
            type="button"
            onClick={() => setDeleteIds(selectedCampaignIds)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Selected
          </button>
        </div>
      )}

      <div className={`${withinCard ? 'bg-transparent border-0 rounded-none h-full' : 'mt-2 bg-surface h-[calc(100vh-290px)]'} overflow-hidden flex flex-col min-h-0`}>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative" ref={filterRef}>
          {rows.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No campaigns found"
              description="Try adjusting your filters."
            />
          ) : !isTablet ? (
            <table className="w-full table-fixed">
              <thead className="sticky top-0 z-[1]">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="h-9 border-b border-border-subtle bg-surface-hover/30">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                        className={`h-9 min-w-0 overflow-hidden whitespace-nowrap align-middle text-left px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide ${
                          header.column.getCanSort() ? 'cursor-pointer select-none' : ''
                        }`}
                        style={{ width: `${header.getSize()}px`, minWidth: `${header.getSize()}px` }}
                      >
                        {header.isPlaceholder ? null : (
                          <div className="min-w-0 truncate">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelected = row.getIsSelected();
                  const isActive = selectedCampaignId === row.original.id;
                  return (
                  <tr
                    key={row.id}
                    className={`group border-b border-border-subtle transition-colors ${
                      isActive ? 'bg-accent/12' : isSelected ? 'bg-accent/8' : 'hover:bg-surface-hover/60'
                    } ${onSelectCampaign ? 'cursor-pointer' : ''}`}
                    onClick={(e) => {
                      if (!onSelectCampaign || isInteractiveTarget(e.target)) return;
                      onSelectCampaign(row.original);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="min-w-0 overflow-hidden px-3 py-1.5 align-middle leading-tight"
                        style={{ width: `${cell.column.getSize()}px`, minWidth: `${cell.column.getSize()}px` }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          ) : isPhone ? (
            <div className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const campaign = row.original;
                return (
                  <div
                    key={row.id}
                    className={`p-3 ${selectedCampaignId === campaign.id ? 'bg-accent/10' : ''}`}
                    onClick={(e) => {
                      if (!onSelectCampaign || isInteractiveTarget(e.target)) return;
                      onSelectCampaign(campaign);
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={row.getIsSelected()}
                        onChange={row.getToggleSelectedHandler()}
                        className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text">{campaign.name}</div>
                        <div className="mt-1 inline-flex px-1.5 py-0 text-[10px] font-medium rounded border capitalize text-text-muted">
                          <span className={statusBadge(String(campaign.status || 'draft'))}>{campaign.status || 'draft'}</span>
                        </div>
                      </div>
                      {renderActionsMenu(campaign)}
                    </div>
                    <div className="mt-2 text-[11px] text-text-muted tabular-nums">
                      Contacts {campaign.stats?.total_contacts || 0}  Sent {campaign.stats?.total_sent || 0}  Review {summaryMap.get(campaign.id)?.pending_review_count || 0}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[minmax(0,1fr)_100px_90px_90px_132px] h-9 border-b border-border-subtle bg-surface-hover/30">
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide truncate whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={table.getIsAllRowsSelected()}
                    ref={(input) => {
                      if (input) input.indeterminate = table.getIsSomeRowsSelected();
                    }}
                    onChange={table.getToggleAllRowsSelectedHandler()}
                    className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
                  />
                  <span>Campaign</span>
                </div>
                <div className="px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide truncate whitespace-nowrap">Status</div>
                <div className="px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide truncate whitespace-nowrap">Contacts</div>
                <div className="px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide truncate whitespace-nowrap">Sent</div>
                <div className="px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide truncate whitespace-nowrap">Actions</div>
              </div>
              {rows.map((row) => {
                const campaign = row.original;
                const pendingReview = summaryMap.get(campaign.id)?.pending_review_count || 0;
                const isSelected = row.getIsSelected();
                const isActive = selectedCampaignId === campaign.id;
                return (
                  <div
                    key={row.id}
                    className={`grid grid-cols-[minmax(0,1fr)_100px_90px_90px_132px] border-b border-border-subtle ${
                      isActive ? 'bg-accent/12' : isSelected ? 'bg-accent/8' : 'hover:bg-surface-hover/60'
                    } ${onSelectCampaign ? 'cursor-pointer' : ''}`}
                    onClick={(e) => {
                      if (!onSelectCampaign || isInteractiveTarget(e.target)) return;
                      onSelectCampaign(campaign);
                    }}
                  >
                    <div className="px-3 py-2 min-w-0">
                      <div className="truncate text-xs font-medium text-text">{campaign.name}</div>
                      <div className="text-[11px] text-text-dim tabular-nums">Review {pendingReview}</div>
                    </div>
                    <div className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0 text-[10px] font-medium rounded border capitalize ${statusBadge(String(campaign.status || 'draft'))}`}>
                        {campaign.status || 'draft'}
                      </span>
                    </div>
                    <div className="px-3 py-2 text-xs text-text tabular-nums">{campaign.stats?.total_contacts || 0}</div>
                    <div className="px-3 py-2 text-xs text-text tabular-nums">{campaign.stats?.total_sent || 0}</div>
                    <div className="px-3 py-2">{renderActionsMenu(campaign)}</div>
                  </div>
                );
              })}
            </div>
          )}
          {!isTablet && showFilters ? (
            <div className="absolute right-3 top-10 z-20 w-[260px] rounded-md border border-border bg-surface p-3 shadow-lg">
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
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete campaign?"
        message="This campaign and all its email data will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteId !== null) onDelete(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={deleteIds.length > 0}
        title={`Delete ${deleteIds.length} campaign${deleteIds.length === 1 ? '' : 's'}?`}
        message="These campaigns and all associated email records will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          deleteIds.forEach((id) => onDelete(id));
          setDeleteIds([]);
          setRowSelection({});
        }}
        onCancel={() => setDeleteIds([])}
      />
    </>
  );
}
