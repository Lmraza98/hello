import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table';
import {
  Edit3,
  Mail,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { EmailCampaign, CampaignScheduleSummary } from '../../types/email';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { EmptyState } from '../shared/EmptyState';
import { FilterPanelWrapper } from '../shared/FilterPanelWrapper';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { SearchToolbar } from '../shared/SearchToolbar';

type CampaignsViewProps = {
  campaigns: EmailCampaign[];
  campaignScheduleSummary: CampaignScheduleSummary[];
  isLoading: boolean;
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

function getFilterValue(columnFilters: ColumnFiltersState, id: string): string {
  return (columnFilters.find((f) => f.id === id)?.value as string) ?? '';
}

function CampaignsFilterPanel({
  columnFilters,
  setColumnFilters,
  onClose,
  isMobile,
}: {
  columnFilters: ColumnFiltersState;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  onClose: () => void;
  isMobile: boolean;
}) {
  const setFilter = (id: string, value: string) => {
    setColumnFilters((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (value) next.push({ id, value });
      return next;
    });
  };

  const selectClass =
    'w-full px-2.5 py-2.5 md:py-1.5 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent appearance-none';

  return (
    <FilterPanelWrapper
      isMobile={isMobile}
      onClose={onClose}
      filterCount={columnFilters.length}
      onClearAll={() => setColumnFilters([])}
    >
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Status</label>
        <select
          value={getFilterValue(columnFilters, 'status')}
          onChange={(e) => setFilter('status', e.target.value)}
          className={selectClass}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Template mode</label>
        <select
          value={getFilterValue(columnFilters, 'template_mode')}
          onChange={(e) => setFilter('template_mode', e.target.value)}
          className={selectClass}
        >
          <option value="">All modes</option>
          <option value="linked">Linked</option>
          <option value="copied">Copied</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1.5 uppercase tracking-wider">Review queue</label>
        <select
          value={getFilterValue(columnFilters, 'review_state')}
          onChange={(e) => setFilter('review_state', e.target.value)}
          className={selectClass}
        >
          <option value="">All</option>
          <option value="has_pending_review">Has pending review</option>
          <option value="no_pending_review">No pending review</option>
        </select>
      </div>
    </FilterPanelWrapper>
  );
}

export function CampaignsView({
  campaigns,
  campaignScheduleSummary,
  isLoading,
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
  const isMobile = useIsMobile();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    }
    if (showFilters && !isMobile) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFilters, isMobile]);

  const summaryMap = useMemo(
    () => new Map(campaignScheduleSummary.map((s) => [s.campaign_id, s])),
    [campaignScheduleSummary],
  );

  const columns = useMemo<ColumnDef<EmailCampaign>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(input) => {
              if (input) input.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
          />
        ),
        enableSorting: false,
        size: 42,
      },
      {
        accessorKey: 'name',
        header: 'Campaign',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="text-sm font-medium text-text truncate">{row.original.name}</div>
            <div className="text-xs text-text-muted truncate">{row.original.description || '-'}</div>
          </div>
        ),
        size: 220,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const value = String(getValue() || 'draft');
          return (
            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border capitalize ${statusBadge(value)}`}>
              {value}
            </span>
          );
        },
        size: 100,
      },
      {
        id: 'contacts',
        header: 'Contacts',
        accessorFn: (row) => row.stats?.total_contacts || 0,
        cell: ({ getValue }) => <span className="text-sm text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 90,
      },
      {
        id: 'sent',
        header: 'Sent',
        accessorFn: (row) => row.stats?.total_sent || 0,
        cell: ({ getValue }) => <span className="text-sm text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 80,
      },
      {
        id: 'pending_review',
        header: 'Pending Review',
        accessorFn: (row) => summaryMap.get(row.id)?.pending_review_count || 0,
        cell: ({ getValue }) => <span className="text-sm text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 120,
      },
      {
        id: 'scheduled_count',
        header: 'Scheduled',
        accessorFn: (row) => summaryMap.get(row.id)?.scheduled_count || 0,
        cell: ({ getValue }) => <span className="text-sm text-text tabular-nums">{Number(getValue() || 0)}</span>,
        size: 90,
      },
      {
        id: 'next_send',
        header: 'Next Send',
        accessorFn: (row) => summaryMap.get(row.id)?.next_send_time || '',
        cell: ({ row }) => (
          <span className="text-xs text-text-muted">
            {formatNextSend(summaryMap.get(row.original.id)?.next_send_time)}
          </span>
        ),
        size: 170,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const campaign = row.original;
          const isActive = campaign.status === 'active';
          const isUploading = uploadingCampaignId === campaign.id;
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={() => onEditTemplates(campaign)}
                className="p-1.5 rounded border border-border text-text-muted hover:bg-surface-hover"
                title="Edit templates"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onUploadToSalesforce(campaign.id)}
                disabled={isUploading}
                className="p-1.5 rounded border border-border text-text-muted hover:bg-surface-hover disabled:opacity-50"
                title="Upload to Salesforce"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => (isActive ? onPause(campaign.id) : onActivate(campaign.id))}
                className="p-1.5 rounded border border-border text-text-muted hover:bg-surface-hover"
                title={isActive ? 'Pause campaign' : 'Activate campaign'}
              >
                {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => onSendEmails(campaign.id)}
                className="p-1.5 rounded border border-border text-text-muted hover:bg-surface-hover"
                title="Send emails"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onViewContacts}
                className="p-1.5 rounded border border-border text-text-muted hover:bg-surface-hover"
                title="View contacts"
              >
                <Mail className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDeleteId(campaign.id)}
                className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50"
                title="Delete campaign"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        },
        enableSorting: false,
        size: 230,
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

  const tableData = useMemo(() => {
    let next = campaigns;
    const statusFilter = getFilterValue(columnFilters, 'status');
    const templateModeFilter = getFilterValue(columnFilters, 'template_mode');
    const reviewStateFilter = getFilterValue(columnFilters, 'review_state');

    if (statusFilter) {
      next = next.filter((c) => String(c.status || '').toLowerCase() === statusFilter.toLowerCase());
    }
    if (templateModeFilter) {
      next = next.filter((c) => String(c.template_mode || '').toLowerCase() === templateModeFilter.toLowerCase());
    }
    if (reviewStateFilter === 'has_pending_review') {
      next = next.filter((c) => (summaryMap.get(c.id)?.pending_review_count || 0) > 0);
    } else if (reviewStateFilter === 'no_pending_review') {
      next = next.filter((c) => (summaryMap.get(c.id)?.pending_review_count || 0) === 0);
    }
    return next;
  }, [campaigns, columnFilters, summaryMap]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { globalFilter, sorting, rowSelection },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
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
  const filteredCount = table.getFilteredRowModel().rows.length;
  const selectedCount = Object.keys(rowSelection).length;
  const activeFilterCount = columnFilters.length;

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
      <div ref={filterRef}>
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
            <CampaignsFilterPanel
              columnFilters={columnFilters}
              setColumnFilters={setColumnFilters}
              onClose={() => setShowFilters(false)}
              isMobile={false}
            />
          }
        />
      </div>

      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 mt-2 mb-3 overflow-x-auto no-scrollbar">
          {columnFilters.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent rounded-full text-[11px] font-medium whitespace-nowrap shrink-0"
            >
              {f.id}: {String(f.value)}
              <button
                onClick={() => setColumnFilters((prev) => prev.filter((cf) => cf.id !== f.id))}
                className="hover:text-accent/70"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {showFilters && isMobile && (
        <CampaignsFilterPanel
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          onClose={() => setShowFilters(false)}
          isMobile
        />
      )}

      <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col h-[calc(100vh-290px)]">
        <div className="shrink-0">
          <table className="w-full min-w-[1200px]" style={{ tableLayout: 'fixed' }}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border bg-surface-hover/50">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                      className={`text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider ${
                        header.column.getCanSort() ? 'cursor-pointer select-none' : ''
                      }`}
                      style={{ width: `${header.getSize()}px` }}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
          </table>
        </div>

        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No campaigns found"
              description="Try adjusting your filters."
            />
          ) : (
            <table className="w-full min-w-[1200px]" style={{ tableLayout: 'fixed' }}>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border-subtle hover:bg-surface-hover/60 transition-colors">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 align-middle" style={{ width: `${cell.column.getSize()}px` }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
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
    </>
  );
}
