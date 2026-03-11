import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  ChevronRight,
  Edit3,
  MoreHorizontal,
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

const CAMPAIGN_ACTIONS_COLUMN_WIDTH = 56;

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
  viewportControlsTarget?: HTMLElement | null;
  renderHeaderActionsMenu?: ((closeMenu: () => void) => ReactNode) | null;
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

function CampaignRowActionsMenu({
  campaign,
  uploadingCampaignId,
  onEditTemplates,
  onUploadToSalesforce,
  onPause,
  onActivate,
  onSendEmails,
  onViewContacts,
  onDelete,
}: {
  campaign: EmailCampaign;
  uploadingCampaignId: number | null;
  onEditTemplates: (campaign: EmailCampaign) => void;
  onUploadToSalesforce: (campaignId: number) => void;
  onPause: (campaignId: number) => void;
  onActivate: (campaignId: number) => void;
  onSendEmails: (campaignId: number) => void;
  onViewContacts: () => void;
  onDelete: (campaignId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const isActive = campaign.status === 'active';
  const isUploading = uploadingCampaignId === campaign.id;

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.top + rect.height / 2,
        left: rect.left - 4,
      });
    };
    updatePosition();
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onScrollOrResize = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  return (
    <>
      <div className="relative flex items-center justify-center">
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Open actions for ${campaign.name}`}
          data-row-control
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={ref}
              className="fixed z-[120] w-44 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" onClick={() => { onEditTemplates(campaign); setOpen(false); }} className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover">
                Edit templates
              </button>
              <button type="button" onClick={() => { onUploadToSalesforce(campaign.id); setOpen(false); }} disabled={isUploading} className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover disabled:opacity-50">
                Upload to Salesforce
              </button>
              <button type="button" onClick={() => { (isActive ? onPause : onActivate)(campaign.id); setOpen(false); }} className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover">
                {isActive ? 'Pause campaign' : 'Activate campaign'}
              </button>
              <button type="button" onClick={() => { onSendEmails(campaign.id); setOpen(false); }} className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover">
                Launch next emails
              </button>
              <button type="button" onClick={() => { onViewContacts(); setOpen(false); }} className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover">
                View contacts
              </button>
              <button type="button" onClick={() => { onDelete(campaign.id); setOpen(false); }} className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-rose-700 hover:bg-rose-50">
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function CampaignHeaderActionsMenu({
  renderMenu,
}: {
  renderMenu: (closeMenu: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.top + rect.height / 2,
        left: rect.left - 4,
      });
    };
    updatePosition();
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onScrollOrResize = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  return (
    <>
      <div className="relative flex h-full w-full items-center justify-center">
        <button
          ref={buttonRef}
          type="button"
          aria-label="Open campaign table actions"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={ref}
              className="fixed z-[120] w-44 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              {renderMenu(() => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </>
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
  viewportControlsTarget = null,
  renderHeaderActionsMenu = null,
}: CampaignsViewProps) {
  const isPhone = useIsMobile(640);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteIds, setDeleteIds] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const filterRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<any>(null);
  const canShiftLeftRef = useRef(false);
  const canShiftRightRef = useRef(false);
  const shiftLeftRef = useRef<() => void>(() => {});
  const shiftRightRef = useRef<() => void>(() => {});

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

  const summaryMap = useMemo(
    () => new Map(campaignScheduleSummary.map((s) => [s.campaign_id, s])),
    [campaignScheduleSummary],
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
  const managedColumnIds = useMemo(() => ['name', 'status', 'contacts', 'sent', 'pending_review', 'scheduled_count', 'next_send'], []);
  const { columnOrder: managedColumnOrder, setColumnOrder: setManagedColumnOrder, columnVisibility, setColumnVisibility } = usePersistentColumnPreferences({
    storageKey: 'campaigns-table',
    columnIds: managedColumnIds,
    initialVisibility: { name: true },
  });

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

  const viewportControls = useMemo(() => (
    <div className="relative flex h-full w-full items-center justify-center gap-0.5 bg-surface" ref={filterRef}>
      <button
        type="button"
        onClick={() => setShowFilters((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        title="Columns"
        aria-label="Open visible columns menu"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => shiftLeftRef.current()}
        disabled={!canShiftLeftRef.current}
        aria-label="Show previous columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
      </button>
      <button
        type="button"
        onClick={() => shiftRightRef.current()}
        disabled={!canShiftRightRef.current}
        aria-label="Show more columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {showFilters ? (
        <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
          <ColumnVisibilityMenu
            items={managedColumnOrder.map((columnId, index) => ({
              id: columnId,
              label: columnLabelMap[columnId] ?? columnId,
              visible: tableRef.current?.getColumn(columnId)?.getIsVisible() ?? true,
              canHide: columnId !== 'name',
              canMoveUp: index > 0,
              canMoveDown: index < managedColumnOrder.length - 1,
            }))}
            onToggle={(columnId, visible) => {
              if (columnId === 'name') return;
              tableRef.current?.getColumn(columnId)?.toggleVisibility(visible);
            }}
            onMoveUp={(columnId) => moveManagedColumn(columnId, -1)}
            onMoveDown={(columnId) => moveManagedColumn(columnId, 1)}
          />
        </div>
      ) : null}
    </div>
  ), [columnLabelMap, managedColumnOrder, showFilters]);

  const actionsHeader = useMemo(
    () =>
      renderHeaderActionsMenu ? (
        <CampaignHeaderActionsMenu renderMenu={renderHeaderActionsMenu} />
      ) : viewportControlsTarget ? (
        <div className="h-full w-full" />
      ) : (
        viewportControls
      ),
    [renderHeaderActionsMenu, viewportControls, viewportControlsTarget],
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
        header: () => actionsHeader,
        cell: ({ row }) => {
          const campaign = row.original;
          return (
            <CampaignRowActionsMenu
              campaign={campaign}
              uploadingCampaignId={uploadingCampaignId}
              onEditTemplates={onEditTemplates}
              onUploadToSalesforce={onUploadToSalesforce}
              onPause={onPause}
              onActivate={onActivate}
              onSendEmails={onSendEmails}
              onViewContacts={onViewContacts}
              onDelete={(id) => setDeleteId(id)}
            />
          );
        },
        enableSorting: false,
        size: CAMPAIGN_ACTIONS_COLUMN_WIDTH,
        minSize: CAMPAIGN_ACTIONS_COLUMN_WIDTH,
        maxSize: CAMPAIGN_ACTIONS_COLUMN_WIDTH,
        enableResizing: false,
        meta: {
          label: 'Actions',
          minWidth: CAMPAIGN_ACTIONS_COLUMN_WIDTH,
          defaultWidth: CAMPAIGN_ACTIONS_COLUMN_WIDTH,
          maxWidth: CAMPAIGN_ACTIONS_COLUMN_WIDTH,
          resizable: false,
          align: 'right',
          headerClassName: 'sticky right-0 z-20 bg-surface px-0',
          cellClassName: 'sticky right-0 z-40 overflow-visible bg-surface px-0 text-center',
        },
      },
    ],
    [
      actionsHeader,
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
        <CampaignRowActionsMenu
          campaign={campaign}
          uploadingCampaignId={uploadingCampaignId}
          onEditTemplates={onEditTemplates}
          onUploadToSalesforce={onUploadToSalesforce}
          onPause={onPause}
          onActivate={onActivate}
          onSendEmails={onSendEmails}
          onViewContacts={onViewContacts}
          onDelete={(id) => setDeleteId(id)}
        />
      </div>
      <div className="mt-2 text-[11px] text-text-muted tabular-nums">
        Contacts {campaign.stats?.total_contacts || 0}  Sent {campaign.stats?.total_sent || 0}  Review {summaryMap.get(campaign.id)?.pending_review_count || 0}
      </div>
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
      {viewportControlsTarget && typeof document !== 'undefined'
        ? createPortal(
            <div className="flex h-full w-full items-center justify-center">
              {viewportControls}
            </div>,
            viewportControlsTarget,
          )
        : null}
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
              suppressViewportOverlay
              onViewportStateChange={({ canShiftLeft, canShiftRight, shiftLeft, shiftRight }) => {
                canShiftLeftRef.current = canShiftLeft;
                canShiftRightRef.current = canShiftRight;
                shiftLeftRef.current = shiftLeft;
                shiftRightRef.current = shiftRight;
                tableRef.current = table;
              }}
              bodyClassName="no-scrollbar"
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
