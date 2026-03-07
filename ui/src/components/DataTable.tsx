import type { ReactNode } from 'react';
import { LoadingSpinner } from './shared/LoadingSpinner';

export interface ColumnDef<T> {
  key: string;
  label: string;
  className?: string;
  render?: (item: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  renderRow: (item: T) => ReactNode;
  emptyState?: ReactNode;
  isLoading?: boolean;
  maxHeight?: string;
  minWidth?: string;
}

export function DataTable<T extends { id?: number | string }>({
  columns,
  data,
  renderRow,
  emptyState,
  isLoading = false,
  maxHeight = 'calc(100vh - 300px)',
  minWidth = '800px',
}: DataTableProps<T>) {
  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div 
      className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col"
      style={{ height: maxHeight }}
    >
      <div className="flex-1 overflow-auto">
        <table className="w-full" style={{ minWidth }}>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="h-9 border-b border-border-subtle bg-surface-hover/30">
              {columns.map((column) => (
                <th 
                  key={column.key}
                  className={`h-9 text-left px-4 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wide ${column.className || ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.map((item) => renderRow(item))}
            {data.length === 0 && emptyState && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-text-muted">
                  {emptyState}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
