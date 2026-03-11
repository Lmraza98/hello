import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type Column,
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
import { ColumnVisibilityMenu } from '../shared/ColumnVisibilityMenu';
import { EmptyState } from '../shared/EmptyState';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import {
  FILTERABLE_VIEWPORT_CONTROL_WIDTH,
  SHARED_SELECTION_COLUMN_WIDTH,
  SharedDataTable,
  usePersistentColumnSizing,
} from '../shared/resizableDataTable';
import { usePersistentColumnPreferences } from '../shared/usePersistentColumnPreferences';

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

function SortableCampaignHeader({ column, label }: { column: Column<EmailCampaign, unknown>; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="flex items-center gap-1 truncate text-[11px] font-medium uppercase tracking-wide hover:text-text"
      onClick={column.getToggleSortingHandler()}
    >
      <span className="truncate">{label}</span>
      <span className={`text-[10px] ${sorted ? 'opacity-100' : 'opacity-35'}`}>{sorted === 'desc' ? '↓' : '↑'}</span>
    </button>
  );
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
  const isPhone = useIsMobile(640);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteIds, setDeleteIds] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [openActionsMenuId, setOpenActionsMenuId] = useState<number | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
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
    if (showFilters) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFilters]);

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
        id: 'select',
        header: ({ table }) => (
          <button
            type="button"
            aria-label="Select all visible campaigns"
            aria-pressed={table.getIsAllRowsSelected()}
            onClick={() => table.toggleAllRowsSelected(!table.getIsAllRowsSelected())}
            className="block h-full w-full"
            data-row-control
          />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Select campaign ${row.original.name}`}
            aria-pressed={row.getIsSelected()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              row.toggleSelected();
            }}
            className="block h-full w-full"
            data-row-control
          />
        ),
        size: SHARED_SELECTION_COLUMN_WIDTH,
        minSize: SHARED_SELECTION_COLUMN_WIDTH,
        maxSize: SHARED_SELECTION_COLUMN_WIDTH,
        enableSorting: false,
        enableResizing: false,
        meta: {
          label: 'Select',
          minWidth: SHARED_SELECTION_COLUMN_WIDTH,
          defaultWidth: SHARED_SELECTION_COLUMN_WIDTH,
          maxWidth: SHARED_SELECTION_COLUMN_WIDTH,
          resizable: false,
          align: 'center',
        },
      },
      {
        accessorKey: 'name',
        header: ({ column }) => <SortableCampaignHeader column={column} label="Campaign" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-text">{row.original.name}</p>
            <p className="truncate text-[11px] text-text-dim">
              Review {summaryMap.get(row.original.id)?.pending_review_count || 0}
            </p>
          </div>
        ),
        size: 210,
        minSize: 220,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Campaign',
          minWidth: 220,
          defaultWidth: 260,
          maxWidth: 360,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailCampaign) => row.name,
        },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <SortableCampaignHeader column={column} label="Status" />,
        cell: ({ getValue }) => {
          const value = String(getValue() || 'draft');
          return (
            <span className={`inline-flex px-1.5 py-0 text-[10px] font-medium rounded border capitalize ${statusBadge(value)}`}>
              {value}
            </span>
          );
        },
        size: 90,
        minSize: 100,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Status',
          minWidth: 100,
          defaultWidth: 112,
          maxWidth: 150,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailCampaign) => row.status || 'draft',
        },
      },
      {
        id: 'contacts',
        header: ({ column }) => <SortableCampaignHeader column={column} label="Contacts" />,
        accessorFn: (row) => row.stats?.total_contacts || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 72,
        minSize: 88,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Contacts',
          minWidth: 88,
          defaultWidth: 96,
          maxWidth: 120,
          resizable: true,
          align: 'right',
          measureValue: (row: EmailCampaign) => row.stats?.total_contacts || 0,
        },
      },
      {
        id: 'sent',
        header: ({ column }) => <SortableCampaignHeader column={column} label="Sent" />,
        accessorFn: (row) => row.stats?.total_sent || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 64,
        minSize: 72,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Sent',
          minWidth: 72,
          defaultWidth: 84,
          maxWidth: 110,
          resizable: true,
          align: 'right',
          measureValue: (row: EmailCampaign) => row.stats?.total_sent || 0,
        },
      },
      {
        id: 'pending_review',
        header: ({ column }) => <SortableCampaignHeader column={column} label="Pending Review" />,
        accessorFn: (row) => summaryMap.get(row.id)?.pending_review_count || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 100,
        minSize: 112,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Pending Review',
          minWidth: 112,
          defaultWidth: 126,
          maxWidth: 150,
          resizable: true,
          align: 'right',
          measureValue: (row: EmailCampaign) => summaryMap.get(row.id)?.pending_review_count || 0,
        },
      },
      {
        id: 'scheduled_count',
        header: ({ column }) => <SortableCampaignHeader column={column} label="Scheduled" />,
        accessorFn: (row) => summaryMap.get(row.id)?.scheduled_count || 0,
        cell: ({ getValue }) => <span className="text-xs text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 72,
        minSize: 96,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Scheduled',
          minWidth: 96,
          defaultWidth: 108,
          maxWidth: 130,
          resizable: true,
          align: 'right',
          measureValue: (row: EmailCampaign) => summaryMap.get(row.id)?.scheduled_count || 0,
        },
      },
      {
        id: 'next_send',
        header: ({ column }) => <SortableCampaignHeader column={column} label="Next Send" />,
        accessorFn: (row) => summaryMap.get(row.id)?.next_send_time || '',
        cell: ({ row }) => (
          <span className="block truncate text-[11px] text-text-muted">
            {formatNextSend(summaryMap.get(row.original.id)?.next_send_time)}
          </span>
        ),
        size: 150,
        minSize: 132,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Next Send',
          minWidth: 132,
          defaultWidth: 156,
          maxWidth: 220,
          resizable: true,
          align: 'right',
          measureValue: (row: EmailCampaign) => formatNextSend(summaryMap.get(row.id)?.next_send_time),
        },
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
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
        minSize: 198,
        maxSize: Number.MAX_SAFE_INTEGER,
        enableResizing: false,
        meta: {
          label: 'Actions',
          minWidth: 198,
          defaultWidth: 198,
          maxWidth: 198,
          resizable: false,
          align: 'right',
        },
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
    ],
  );

  const tableData = campaigns;
  const { columnSizing, setColumnSizing, autoFitColumn } = usePersistentColumnSizing({
    columns,
    rows: tableData,
    storageKey: 'campaigns-table',
  });
  const columnLabelMap: Record<string, string> = {
    name: 'Campaign',
    status: 'Status',
    contacts: 'Contacts',
    sent: 'Sent',
    pending_review: 'Pending Review',
    scheduled_count: 'Scheduled',
    next_send: 'Next Send',
  };
  const managedColumnIds = useMemo(() => ['name', 'status', 'contacts', 'sent', 'pending_review', 'scheduled_count', 'next_send'], []);
  const { columnOrder: managedColumnOrder, setColumnOrder: setManagedColumnOrder, columnVisibility, setColumnVisibility } = usePersistentColumnPreferences({
    storageKey: 'campaigns-table',
    columnIds: managedColumnIds,
    initialVisibility: { name: true },
  });

  const handleColumnOrderChange = (updater: string[] | ((old: string[]) => string[])) => {
    setManagedColumnOrder((prev) => {
      const current = [...prev, 'actions'];
      const next = typeof updater === 'function' ? updater(current) : updater;
      const orderedManaged = next.filter((id) => managedColumnIds.includes(id));
      managedColumnIds.forEach((id) => {
        if (!orderedManaged.includes(id)) orderedManaged.push(id);
      });
      return orderedManaged;
    });
  };

  const moveManagedColumn = (columnId: string, delta: -1 | 1) => {
    setManagedColumnOrder((prev) => {
      const index = prev.indexOf(columnId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const table = useReactTable({
    data: tableData,
    columns,
    state: { globalFilter: searchQuery, sorting, rowSelection, columnVisibility, columnSizing, columnOrder: ['select', ...managedColumnOrder, 'actions'] },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: handleColumnOrderChange,
    onColumnSizingChange: setColumnSizing,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
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
    [table],
  );
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

  const renderCompactCampaignRow = (campaign: EmailCampaign, isSelected: boolean) => (
    <div className={`p-3 ${isSelected ? 'bg-accent/10' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        <input
          type="checkbox"
          checked={table.getRow(String(campaign.id))?.getIsSelected() ?? false}
          onChange={() => table.getRow(String(campaign.id))?.toggleSelected()}
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

  const viewportLeadingControl = (
    <div className="relative" ref={filterRef}>
      <button
        type="button"
        onClick={() => setShowFilters((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        title="Columns"
        aria-label="Open visible columns menu"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </button>
      {showFilters ? (
        <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
          <ColumnVisibilityMenu
            items={managedColumnOrder.map((columnId, index) => ({
              id: columnId,
              label: columnLabelMap[columnId] ?? columnId,
              visible: table.getColumn(columnId)?.getIsVisible() ?? true,
              canHide: columnId !== 'name',
              canMoveUp: index > 0,
              canMoveDown: index < managedColumnOrder.length - 1,
            }))}
            onToggle={(columnId, visible) => {
              if (columnId === 'name') return;
              table.getColumn(columnId)?.toggleVisibility(visible);
            }}
            onMoveUp={(columnId) => moveManagedColumn(columnId, -1)}
            onMoveDown={(columnId) => moveManagedColumn(columnId, 1)}
          />
        </div>
      ) : null}
    </div>
  );

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
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative">
          {rows.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No campaigns found"
              description="Try adjusting your filters."
            />
          ) : (
            <SharedDataTable
              table={table}
              rows={tableData}
              emptyState={
                <EmptyState
                  icon={Mail}
                  title="No campaigns found"
                  description="Try adjusting your filters."
                />
              }
              selectedRowId={selectedCampaignId}
              onRowClick={(campaign) => {
                if (!onSelectCampaign) return;
                onSelectCampaign(campaign);
              }}
              getRowAriaLabel={(campaign) => `Open campaign ${campaign.name}`}
              isInteractiveTarget={isInteractiveTarget}
              renderCompactRow={renderCompactCampaignRow}
              isCompact={isPhone}
              onAutoFitColumn={autoFitColumn}
              viewportControlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
              viewportLeadingControl={viewportLeadingControl}
              rowClassName={(_, isSelected) => (onSelectCampaign ? (isSelected ? 'cursor-pointer bg-accent/12' : 'cursor-pointer hover:bg-surface-hover/60') : isSelected ? 'bg-accent/12' : 'hover:bg-surface-hover/60')}
            />
          )}
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
