import { createColumnHelper } from '@tanstack/react-table';
import { Building2, CheckCircle, XCircle, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Trash2 } from 'lucide-react';
import type { Contact } from '../../api';
import { SalesforceStatusBadge } from './SalesforceStatusBadge';

const columnHelper = createColumnHelper<Contact>();

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

export function createContactColumns(onDelete: (id: number, name: string) => void) {
  return [
  columnHelper.display({
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
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent"
        />
        {row.getIsExpanded() ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-dim" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-dim" />
        )}
      </div>
    ),
    size: 56,
  }),
  columnHelper.accessor('name', {
    header: ({ column }) => <SortableHeader column={column}>Name</SortableHeader>,
    cell: ({ getValue }) => (
      <div className="font-medium text-text truncate" title={getValue()}>
        {getValue()}
      </div>
    ),
    filterFn: (row, _id, value) => row.original.name.toLowerCase().includes(value.toLowerCase()),
    size: 160,
  }),
  columnHelper.accessor('title', {
    header: ({ column }) => <SortableHeader column={column}>Title</SortableHeader>,
    cell: ({ getValue }) => (
      <div className="text-sm text-text-muted truncate" title={getValue() || '—'}>
        {getValue() || '—'}
      </div>
    ),
    filterFn: (row, _id, value) => (row.original.title?.toLowerCase().includes(value.toLowerCase()) ?? false),
    size: 200,
  }),
  columnHelper.accessor('company_name', {
    header: ({ column }) => <SortableHeader column={column}>Company</SortableHeader>,
    cell: ({ getValue }) => (
      <div className="flex items-center gap-1.5 text-sm text-text-muted min-w-0">
        <Building2 className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate" title={getValue()}>
          {getValue()}
        </span>
      </div>
    ),
    filterFn: (row, _id, value) => row.original.company_name.toLowerCase().includes(value.toLowerCase()),
    size: 220,
  }),
  columnHelper.accessor('email', {
    header: ({ column }) => <SortableHeader column={column}>Email</SortableHeader>,
    cell: ({ getValue }) => {
      const email = getValue();
      return email ? (
        <div className="flex items-center gap-1 text-sm text-text min-w-0">
          <CheckCircle className="w-3.5 h-3.5 text-success shrink-0" />
          <span className="truncate" title={email}>
            {email}
          </span>
        </div>
      ) : (
        <span className="flex items-center gap-1 text-sm text-text-dim">
          <XCircle className="w-3.5 h-3.5 shrink-0" /> No email
        </span>
      );
    },
    size: 240,
  }),
  columnHelper.accessor('salesforce_status', {
    header: 'Status',
    cell: ({ getValue }) => <SalesforceStatusBadge status={getValue()} />,
    filterFn: (row, _id, value) => (row.original.salesforce_status || 'pending').toLowerCase() === value.toLowerCase(),
    size: 100,
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
            if (c.id) onDelete(c.id, c.name);
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

// Default export for backward compatibility
export const contactColumns = createContactColumns(() => {});
