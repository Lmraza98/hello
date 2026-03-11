import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getCoreRowModel, type CellContext, type ColumnDef, type RowSelectionState, useReactTable } from '@tanstack/react-table';
import { ChevronRight, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import {
  FILTERABLE_VIEWPORT_CONTROL_WIDTH,
  SHARED_SELECTION_COLUMN_WIDTH,
  SharedDataTable,
  usePersistentColumnSizing,
  type SharedColumnAlign,
} from '../shared/resizableDataTable';
import { usePersistentColumnPreferences } from '../shared/usePersistentColumnPreferences';
import { ColumnVisibilityMenu } from '../shared/ColumnVisibilityMenu';

const EMAIL_ACTIONS_COLUMN_WIDTH = 56;

export type StandardEmailColumn<T> = {
  key: string;
  label: string;
  header?: ReactNode;
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
  renderRowActionsMenu?: (item: T, closeMenu: () => void) => ReactNode;
  renderHeaderActionsMenu?: ((closeMenu: () => void) => ReactNode) | null;
  viewportControlsTarget?: HTMLElement | null;
};

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(
    'input, button, a, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [data-row-control]'
  );
}

function StandardRowActionsMenu<T>({
  item,
  rowLabel,
  renderMenu,
}: {
  item: T;
  rowLabel: string;
  renderMenu: (item: T, closeMenu: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
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
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
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
          aria-label={`Open actions for ${rowLabel}`}
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
              ref={wrapperRef}
              className="fixed z-[120] w-44 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              {renderMenu(item, () => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function StandardHeaderActionsMenu({
  renderMenu,
}: {
  renderMenu: (closeMenu: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
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
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
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
          aria-label="Open table actions"
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
              ref={wrapperRef}
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
  renderRowActionsMenu,
  renderHeaderActionsMenu = null,
  viewportControlsTarget = null,
}: StandardEmailTableProps<T>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<any>(null);
  const canShiftLeftRef = useRef(false);
  const canShiftRightRef = useRef(false);
  const shiftLeftRef = useRef<() => void>(() => {});
  const shiftRightRef = useRef<() => void>(() => {});
  const managedColumnIds = useMemo(() => columns.map((column) => column.key), [columns]);
  const { columnOrder: managedColumnOrder, setColumnOrder: setManagedColumnOrder, columnVisibility, setColumnVisibility } = usePersistentColumnPreferences({
    storageKey: `${storageKey}-prefs`,
    columnIds: managedColumnIds,
    initialVisibility: Object.fromEntries(managedColumnIds.map((id) => [id, true])),
  });

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) setShowFiltersMenu(false);
    }
    if (showFiltersMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFiltersMenu]);

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

  const columnLabelMap = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.key, column.label])),
    [columns],
  );

  const viewportControls = useMemo(
    () => (
      <div className="relative flex h-full w-full items-center justify-center gap-0.5 bg-surface" ref={filterRef}>
        <button
          type="button"
          onClick={() => setShowFiltersMenu((v) => !v)}
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
        {showFiltersMenu ? (
          <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
            <ColumnVisibilityMenu
              items={managedColumnOrder.map((columnId, index) => ({
                id: columnId,
                label: columnLabelMap[columnId] ?? columnId,
                visible: tableRef.current?.getColumn(columnId)?.getIsVisible() ?? true,
                canHide: true,
                canMoveUp: index > 0,
                canMoveDown: index < managedColumnOrder.length - 1,
              }))}
              onToggle={(columnId, visible) => {
                tableRef.current?.getColumn(columnId)?.toggleVisibility(visible);
              }}
              onMoveUp={(columnId) => moveManagedColumn(columnId, -1)}
              onMoveDown={(columnId) => moveManagedColumn(columnId, 1)}
            />
          </div>
        ) : null}
      </div>
    ),
    [columnLabelMap, managedColumnOrder, showFiltersMenu],
  );

  const actionsHeader = useMemo(
    () =>
      renderHeaderActionsMenu ? (
        <StandardHeaderActionsMenu renderMenu={renderHeaderActionsMenu} />
      ) : viewportControlsTarget ? (
        <div className="h-full w-full" />
      ) : (
        viewportControls
      ),
    [renderHeaderActionsMenu, viewportControls, viewportControlsTarget],
  );

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
          header: column.header ?? column.label,
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
        {
          id: 'actions',
          header: () => actionsHeader,
          cell: ({ row }: CellContext<T, any>) =>
            renderRowActionsMenu ? (
              <StandardRowActionsMenu item={row.original} rowLabel={getRowAriaLabel(row.original)} renderMenu={renderRowActionsMenu} />
            ) : null,
          size: EMAIL_ACTIONS_COLUMN_WIDTH,
          minSize: EMAIL_ACTIONS_COLUMN_WIDTH,
          maxSize: EMAIL_ACTIONS_COLUMN_WIDTH,
          enableResizing: false,
          meta: {
            label: 'Actions',
            minWidth: EMAIL_ACTIONS_COLUMN_WIDTH,
            defaultWidth: EMAIL_ACTIONS_COLUMN_WIDTH,
            maxWidth: EMAIL_ACTIONS_COLUMN_WIDTH,
            resizable: false,
            align: 'right',
            headerClassName: 'sticky right-0 z-20 bg-surface px-0',
            cellClassName: 'sticky right-0 z-40 overflow-visible bg-surface px-0 text-center',
          },
        },
      ],
    [actionsHeader, columns, getRowAriaLabel, renderRowActionsMenu, rowId],
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
      columnVisibility,
      columnOrder: ['select', ...managedColumnOrder, 'actions'],
    },
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: (updater) => {
      setManagedColumnOrder((prev) => {
        const current = ['select', ...prev, 'actions'];
        const next = typeof updater === 'function' ? updater(current) : updater;
        const orderedManaged = next.filter((id) => managedColumnIds.includes(id));
        managedColumnIds.forEach((id) => {
          if (!orderedManaged.includes(id)) orderedManaged.push(id);
        });
        return orderedManaged;
      });
    },
    getRowId: (row) => String(rowId(row)),
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });

  tableRef.current = table;

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
        viewportControlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
        suppressViewportOverlay
        bodyClassName="no-scrollbar"
        onViewportStateChange={({ canShiftLeft, canShiftRight, shiftLeft, shiftRight }) => {
          canShiftLeftRef.current = canShiftLeft;
          canShiftRightRef.current = canShiftRight;
          shiftLeftRef.current = shiftLeft;
          shiftRightRef.current = shiftRight;
        }}
      />
    </>
  );
}
