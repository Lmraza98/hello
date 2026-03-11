import { useMemo, useState, type ReactNode } from 'react';
import { getCoreRowModel, type CellContext, type ColumnDef, type RowSelectionState, useReactTable } from '@tanstack/react-table';
import { SHARED_SELECTION_COLUMN_WIDTH, SharedDataTable, usePersistentColumnSizing, type SharedColumnAlign } from '../shared/resizableDataTable';

export type StandardEmailColumn<T> = {
  key: string;
  label: string;
  minWidth: number;
  defaultWidth: number;
  maxWidth?: number;
  resizable?: boolean;
  align?: SharedColumnAlign;
  render: (item: T) => ReactNode;
  measureValue?: (item: T) => string | number | null | undefined;
};

type StandardEmailTableProps<T> = {
  columns: StandardEmailColumn<T>[];
  rows: T[];
  rowId: (item: T) => number | string;
  selectedId: number | string | null;
  onSelectRow: (item: T, element: HTMLElement) => void;
  getRowAriaLabel: (item: T) => string;
  emptyState: ReactNode;
  isCompact?: boolean;
  renderCompactRow?: (item: T, isSelected: boolean) => ReactNode;
  storageKey: string;
};

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(
    'input, button, a, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [data-row-control]'
  );
}

export function StandardEmailTable<T>({
  columns,
  rows,
  rowId,
  selectedId,
  onSelectRow,
  getRowAriaLabel,
  emptyState,
  isCompact = false,
  renderCompactRow,
  storageKey,
}: StandardEmailTableProps<T>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const tableColumns = useMemo<ColumnDef<T, any>[]>(
    () =>
      [
        {
          id: 'select',
          header: ({ table }) => (
            <button
              type="button"
              aria-label="Select all visible rows"
              aria-pressed={table.getIsAllRowsSelected()}
              onClick={() => table.toggleAllRowsSelected(!table.getIsAllRowsSelected())}
              className="block h-full w-full"
              data-row-control
            />
          ),
          cell: ({ row }) => (
            <button
              type="button"
              aria-label={`Select row ${String(rowId(row.original))}`}
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
        ...columns.map((column) => ({
          id: column.key,
          header: column.label,
          cell: ({ row }: CellContext<T, any>) => column.render(row.original),
          size: column.defaultWidth,
          minSize: column.minWidth,
          maxSize: Number.MAX_SAFE_INTEGER,
          enableResizing: column.resizable !== false,
          meta: {
            label: column.label,
            minWidth: column.minWidth,
            defaultWidth: column.defaultWidth,
            maxWidth: column.maxWidth,
            resizable: column.resizable !== false,
            align: column.align ?? 'left',
            measureValue: column.measureValue,
          },
        })),
      ],
    [columns, rowId],
  );

  const { columnSizing, setColumnSizing, autoFitColumn } = usePersistentColumnSizing({
    columns: tableColumns,
    rows,
    storageKey,
  });

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: {
      columnSizing,
      rowSelection,
    },
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    getRowId: (row) => String(rowId(row)),
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });

  return (
    <SharedDataTable
      table={table}
      rows={rows}
      emptyState={emptyState}
      selectedRowId={selectedId}
      onRowClick={onSelectRow}
      getRowAriaLabel={getRowAriaLabel}
      isInteractiveTarget={isInteractiveTarget}
      renderCompactRow={renderCompactRow}
      isCompact={isCompact}
      onAutoFitColumn={autoFitColumn}
      rowClassName={(_, isSelected) => (isSelected ? 'cursor-pointer bg-accent/10' : 'cursor-pointer hover:bg-surface-hover/60')}
    />
  );
}
