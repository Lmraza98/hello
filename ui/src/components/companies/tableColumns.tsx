import { createColumnHelper } from '@tanstack/react-table';
import { Building2, ChevronDown, ChevronRight, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { Company } from '../../api';
import { TierBadge } from './TierBadge';
import { StatusBadge } from './StatusBadge';

const columnHelper = createColumnHelper<Company>();

function SortableHeader({ column, children }: { column: any; children: React.ReactNode }) {
  const sorted = column.getIsSorted();
  return (
    <button className="flex items-center gap-1 hover:text-text transition-colors" onClick={column.getToggleSortingHandler()}>
      {children}
      {sorted === 'asc' ? (
        <ArrowUp className="w-3 h-3" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );
}

export function createCompanyColumns(onDelete: (id: number, name: string) => void) {
  return [
    columnHelper.display({
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          className="rounded border-border accent-accent"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          className="rounded border-border accent-accent"
        />
      ),
      size: 40,
    }),
    columnHelper.display({
      id: 'expand',
      header: () => null,
      cell: ({ row }) =>
        row.getIsExpanded() ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-dim" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-dim" />
        ),
      size: 32,
    }),
    columnHelper.accessor('company_name', {
      header: ({ column }) => <SortableHeader column={column}>Company</SortableHeader>,
      cell: ({ getValue }) => (
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-text-muted" />
          </div>
          <span className="font-medium text-text truncate" title={getValue()}>
            {getValue()}
          </span>
        </div>
      ),
      size: 999,
    }),
    columnHelper.accessor('tier', {
      header: ({ column }) => <SortableHeader column={column}>Tier</SortableHeader>,
      cell: ({ getValue }) => <TierBadge tier={getValue()} />,
      filterFn: (row, _id, value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized || normalized === 'all') return true;
        return String(row.original.tier || '').trim().toLowerCase() === normalized;
      },
      size: 80,
    }),
    columnHelper.accessor('status', {
      header: ({ column }) => <SortableHeader column={column}>Status</SortableHeader>,
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      filterFn: (row, _id, value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized || normalized === 'all') return true;
        return String(row.original.status || 'pending').trim().toLowerCase() === normalized;
      },
      size: 120,
    }),
    columnHelper.accessor('vertical', {
      header: ({ column }) => <SortableHeader column={column}>Vertical</SortableHeader>,
      cell: ({ getValue }) => (
        <span className="text-sm text-text-muted truncate block" title={getValue() || '—'}>
          {getValue() || '—'}
        </span>
      ),
      filterFn: (row, _id, value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized || normalized === 'all') return true;
        const selected = normalized
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        const current = String(row.original.vertical || '').trim().toLowerCase();
        if (selected.length === 0) return true;
        return selected.includes(current);
      },
      size: 150,
    }),
    columnHelper.display({
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const c = row.original;
              if (c.id) onDelete(c.id, c.company_name);
            }}
            className="p-1.5 hover:bg-red-50 rounded text-text-muted hover:text-red-600"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
      size: 48,
    }),
  ];
}
