import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
  Building2,
  CheckCircle,
  XCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Trash2,
} from 'lucide-react';
import type { Contact } from '../../api';
import { EngagementStatusBadge, SalesforceSyncBadge } from './SalesforceStatusBadge';
import { getContactSourceLabel } from './sourceLabel';

const columnHelper = createColumnHelper<Contact>();
type ContactColumnsOptions = { compact?: boolean; actionsHeader?: React.ReactNode };

function SortableHeader({ column, children }: { column: any; children: React.ReactNode }) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="flex items-center gap-0.5 hover:text-text transition-colors text-[11px] font-medium tracking-wide uppercase"
      onClick={column.getToggleSortingHandler()}
      aria-label={`Sort by ${String(children)}`}
    >
      {children}
      {sorted === 'asc' ? (
        <ArrowUp className="w-2.5 h-2.5" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="w-2.5 h-2.5" />
      ) : (
        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
      )}
    </button>
  );
}

export function createContactColumns(onDelete: (id: number, name: string) => void, options: ContactColumnsOptions = {}) {
  const compact = options.compact === true;

  const columns: ColumnDef<Contact, any>[] = [
    columnHelper.accessor('name', {
      header: ({ column, table }) => (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(input) => {
              if (input) input.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            aria-label="Select all visible contacts"
            data-row-control
            className="w-3.5 h-3.5 rounded border-gray-300 text-accent focus:ring-accent"
          />
          <SortableHeader column={column}>Name</SortableHeader>
        </div>
      ),
      cell: ({ getValue }) => (
        <div className="text-[11px] font-semibold leading-tight text-text truncate" title={getValue()}>
          {getValue()}
        </div>
      ),
      filterFn: (row, _id, value) => row.original.name.toLowerCase().includes(value.toLowerCase()),
      size: 188,
    }),
  ];

  if (!compact) {
    columns.push(
      columnHelper.accessor('title', {
        header: ({ column }) => <SortableHeader column={column}>Title</SortableHeader>,
        cell: ({ getValue }) => (
          <div className="max-w-[220px] text-[10px] leading-tight text-text-muted truncate" title={getValue() || '-'}>
            {getValue() || '-'}
          </div>
        ),
        filterFn: (row, _id, value) => (row.original.title?.toLowerCase().includes(value.toLowerCase()) ?? false),
        size: 190,
      }),
      columnHelper.accessor('company_name', {
        header: ({ column }) => <SortableHeader column={column}>Company</SortableHeader>,
        cell: ({ getValue }) => (
          <div className="flex items-center gap-1 text-[10px] leading-tight text-text-muted min-w-0">
            <Building2 className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[220px]" title={getValue()}>
              {getValue()}
            </span>
          </div>
        ),
        filterFn: (row, _id, value) => row.original.company_name.toLowerCase().includes(value.toLowerCase()),
        size: 210,
      }),
      columnHelper.accessor('email', {
        header: ({ column }) => <SortableHeader column={column}>Email</SortableHeader>,
        cell: ({ getValue }) => {
          const email = getValue();
          return email ? (
            <div className="flex items-center gap-1 text-[10px] text-text min-w-0 leading-tight">
              <CheckCircle className="w-3 h-3 text-success shrink-0" />
              <span className="truncate font-mono tracking-tight" title={email}>
                {email}
              </span>
            </div>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-text-dim leading-tight">
              <XCircle className="w-3 h-3 shrink-0" /> No email
            </span>
          );
        },
        filterFn: (row, _id, value) => {
          const mode = String(value || '').toLowerCase();
          if (!mode) return true;
          const hasEmail = !!row.original.email;
          if (mode === 'yes' || mode === 'has') return hasEmail;
          if (mode === 'no') return !hasEmail;
          return true;
        },
        size: 230,
      })
    );
  }

  columns.push(
    columnHelper.accessor((row) => getContactSourceLabel(row), {
      id: 'lead_source',
      header: ({ column }) => <SortableHeader column={column}>Source</SortableHeader>,
      cell: ({ getValue }) => {
        const source = (getValue() || 'LinkedIn').toString();
        return (
          <span className="inline-flex rounded-full bg-surface-hover px-2 py-0.5 text-[9px] text-text-muted">
            {source}
          </span>
        );
      },
      filterFn: (row, _id, value) => {
        const selected = String(value || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (!selected.length) return true;
        const source = getContactSourceLabel(row.original).toLowerCase();
        return selected.includes(source);
      },
      size: compact ? 110 : 110,
    }),
    columnHelper.accessor('engagement_status', {
      header: () => <span className="text-[11px] font-medium tracking-wide uppercase">Status</span>,
      cell: ({ row, getValue }) => (
        <div className="flex items-center gap-1.5">
          <EngagementStatusBadge status={getValue()} />
          <SalesforceSyncBadge status={row.original.salesforce_sync_status} />
        </div>
      ),
      filterFn: (row, _id, value) => {
        const filterValue = String(value || '').toLowerCase();
        const status = (row.original.engagement_status || 'needs_sync').toLowerCase();
        return !filterValue || status === filterValue;
      },
      size: compact ? 120 : 84,
    }),
    columnHelper.display({
      id: 'actions',
      header: () => options.actionsHeader ?? null,
      cell: ({ row }) => (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const c = row.original;
              if (c.id) onDelete(c.id, c.name);
            }}
            aria-label={`Delete ${row.original.name}`}
            data-row-control
            className="p-1 hover:bg-red-50 rounded text-text-muted hover:text-red-600"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
      size: 40,
    })
  );

  if (!compact) {
    // Already added core wide columns in non-compact mode.
  }

  return columns;
}

export const contactColumns = createContactColumns(() => {});
