import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flexRender, type Cell, type Column, type ColumnDef, type Header, type Table } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type SharedColumnAlign = 'left' | 'center' | 'right';

export type SharedColumnMeta<TData> = {
  label: string;
  minWidth: number;
  defaultWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  align?: SharedColumnAlign;
  grow?: number;
  headerClassName?: string;
  cellClassName?: string;
  measureValue?: (row: TData) => string | number | null | undefined;
};

type ColumnSizingState = Record<string, number>;

const STORAGE_PREFIX = 'datatable:';
const DEFAULT_FONT = '500 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const HEADER_FONT = '500 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CELL_PADDING = 28;
const HEADER_PADDING = 32;
const AUTO_FIT_SAMPLE_SIZE = 40;
const VIEWPORT_CONTROL_WIDTH = 60;
export const FILTERABLE_VIEWPORT_CONTROL_WIDTH = 96;
export const SHARED_SELECTION_COLUMN_WIDTH = 32;
export const SHARED_TABLE_ROW_HEIGHT_CLASS = 'h-[31px]';
export const SHARED_TABLE_ROW_HEIGHT_PX = 31;

function getCanvasContext() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d');
}

function measureTextWidth(text: string, font: string) {
  const value = text.trim();
  if (!value) return 0;
  const context = getCanvasContext();
  if (!context) return value.length * 8;
  context.font = font;
  return Math.ceil(context.measureText(value).width);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function asLeafColumns<TData>(columns: ColumnDef<TData, unknown>[]) {
  const leaf: ColumnDef<TData, unknown>[] = [];
  const visit = (defs: ColumnDef<TData, unknown>[]) => {
    defs.forEach((def) => {
      if ('columns' in def && Array.isArray(def.columns)) {
        visit(def.columns as ColumnDef<TData, unknown>[]);
        return;
      }
      leaf.push(def);
    });
  };
  visit(columns);
  return leaf;
}

function getColumnId<TData>(column: ColumnDef<TData, unknown>) {
  if ('id' in column && typeof column.id === 'string') return column.id;
  if ('accessorKey' in column && typeof column.accessorKey === 'string') return column.accessorKey;
  return null;
}

export function getColumnMeta<TData>(column: Column<TData, unknown> | ColumnDef<TData, unknown>) {
  const meta = 'columnDef' in column ? column.columnDef.meta : column.meta;
  return (meta ?? null) as SharedColumnMeta<TData> | null;
}

function getColumnLabel<TData>(column: ColumnDef<TData, unknown>) {
  const meta = getColumnMeta(column);
  if (meta?.label) return meta.label;
  if (typeof column.header === 'string') return column.header;
  return getColumnId(column) ?? '';
}

function buildMeasuredColumnSizing<TData>(columns: ColumnDef<TData, unknown>[], rows: TData[]) {
  const sampleRows = rows.slice(0, AUTO_FIT_SAMPLE_SIZE);
  return asLeafColumns(columns).reduce<ColumnSizingState>((acc, column) => {
    const id = getColumnId(column);
    if (!id) return acc;
    const meta = getColumnMeta(column);
    if (!meta) return acc;
    const min = meta.minWidth;
    const headerWidth = measureTextWidth(getColumnLabel(column), HEADER_FONT) + HEADER_PADDING;
    const contentWidth = meta.measureValue
      ? sampleRows.reduce((longest, row) => {
          const next = meta.measureValue?.(row);
          if (next == null) return longest;
          return Math.max(longest, measureTextWidth(String(next), DEFAULT_FONT) + CELL_PADDING);
        }, 0)
      : 0;
    const baseWidth = Math.max(meta.defaultWidth ?? 0, headerWidth, contentWidth, min);
    acc[id] = Math.max(baseWidth, min);
    return acc;
  }, {});
}

function buildMinimumColumnSizing<TData>(columns: ColumnDef<TData, unknown>[]) {
  return asLeafColumns(columns).reduce<ColumnSizingState>((acc, column) => {
    const id = getColumnId(column);
    if (!id) return acc;
    const meta = getColumnMeta(column);
    if (!meta) return acc;
    acc[id] = meta.minWidth;
    return acc;
  }, {});
}

function readStoredSizing(storageKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ColumnSizingState) : null;
  } catch {
    return null;
  }
}

function writeStoredSizing(storageKey: string, sizing: ColumnSizingState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(sizing));
}

function constrainSizing<TData>(columns: ColumnDef<TData, unknown>[], sizing: ColumnSizingState) {
  const constrained: ColumnSizingState = {};
  asLeafColumns(columns).forEach((column) => {
    const id = getColumnId(column);
    const meta = getColumnMeta(column);
    if (!id || !meta) return;
    const min = meta.minWidth;
    const next = sizing[id];
    if (typeof next === 'number' && Number.isFinite(next)) {
      constrained[id] = Math.max(next, min);
    }
  });
  return constrained;
}

function isSameSizing(left: ColumnSizingState, right: ColumnSizingState) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

export function usePersistentColumnSizing<TData>({
  columns,
  rows,
  storageKey,
  initialSizingMode = 'measured',
}: {
  columns: ColumnDef<TData, unknown>[];
  rows: TData[];
  storageKey: string;
  initialSizingMode?: 'measured' | 'min';
}) {
  const measuredDefaults = useMemo(() => buildMeasuredColumnSizing(columns, rows), [columns, rows]);
  const initialDefaults = useMemo(
    () => (initialSizingMode === 'min' ? buildMinimumColumnSizing(columns) : measuredDefaults),
    [columns, initialSizingMode, measuredDefaults],
  );
  const hydratedStorageKeyRef = useRef<string | null>(null);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() =>
    constrainSizing(columns, {
      ...initialDefaults,
      ...(readStoredSizing(storageKey) ?? {}),
    }),
  );
  const effectiveColumnSizing = useMemo(
    () =>
      constrainSizing(columns, {
        ...initialDefaults,
        ...columnSizing,
      }),
    [columnSizing, columns, initialDefaults],
  );

  useEffect(() => {
    if (hydratedStorageKeyRef.current === storageKey) return;
    const storedSizing = readStoredSizing(storageKey);
    hydratedStorageKeyRef.current = storageKey;
    if (!storedSizing) return;
    setColumnSizing((prev) => {
      const next = constrainSizing(columns, {
        ...initialDefaults,
        ...prev,
        ...storedSizing,
      });
      return isSameSizing(prev, next) ? prev : next;
    });
  }, [columns, initialDefaults, storageKey]);

  useEffect(() => {
    writeStoredSizing(storageKey, effectiveColumnSizing);
  }, [effectiveColumnSizing, storageKey]);

  const autoFitColumn = useCallback(
    (columnId: string) => {
      const next = measuredDefaults[columnId];
      if (typeof next !== 'number') return;
      setColumnSizing((prev) => ({ ...prev, [columnId]: next }));
    },
    [measuredDefaults],
  );

  return {
    columnSizing: effectiveColumnSizing,
    setColumnSizing,
    autoFitColumn,
  };
}

function alignClass(align: SharedColumnAlign | undefined) {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

function filterHeadersByIds<TData>(headers: Header<TData, unknown>[], visibleColumnIds?: string[]) {
  if (!visibleColumnIds?.length) return headers.filter((item) => item.column.getIsVisible());
  const visible = new Set(visibleColumnIds);
  return headers.filter((item) => item.column.getIsVisible() && visible.has(item.column.id));
}

export function filterCellsByIds<TData>(cells: Cell<TData, unknown>[], visibleColumnIds?: string[]) {
  if (!visibleColumnIds?.length) return cells;
  const visible = new Set(visibleColumnIds);
  return cells.filter((cell) => visible.has(cell.column.id));
}

export function SharedTableColGroup<TData>({ table }: { table: Table<TData> }) {
  return <SharedTableColGroupWithWidths table={table} />;
}

export function SharedTableColGroupWithWidths<TData>({
  table,
  columnWidths,
  visibleColumnIds,
  fillerWidth = 0,
  controlWidth = VIEWPORT_CONTROL_WIDTH,
}: {
  table: Table<TData>;
  columnWidths?: Record<string, number>;
  visibleColumnIds?: string[];
  fillerWidth?: number;
  controlWidth?: number;
}) {
  const visible = visibleColumnIds ? new Set(visibleColumnIds) : null;
  const leafHeaders = table
    .getFlatHeaders()
    .filter((header) => header.isPlaceholder === false && header.subHeaders.length === 0)
    .filter((header) => (visible ? visible.has(header.column.id) : true));
  const trailingActionsHeader = leafHeaders.length > 0 && leafHeaders[leafHeaders.length - 1]?.column.id === 'actions'
    ? leafHeaders[leafHeaders.length - 1]
    : null;
  const leadingHeaders = trailingActionsHeader ? leafHeaders.slice(0, -1) : leafHeaders;
  const effectiveFillerWidth = trailingActionsHeader ? 0 : Math.max(fillerWidth, controlWidth);
  return (
    <colgroup>
      {leadingHeaders.map((header, index) => {
        const isTrailingLeadingHeader = trailingActionsHeader && index === leadingHeaders.length - 1;
        const extraWidth = isTrailingLeadingHeader ? Math.max(fillerWidth, 0) : 0;
        const width = (columnWidths?.[header.column.id] ?? header.getSize()) + extraWidth;
        return <col key={header.id} style={{ width: `${width}px` }} />;
      })}
      {effectiveFillerWidth > 0 ? <col key="__shared-filler__" style={{ width: `${effectiveFillerWidth}px` }} /> : null}
      {trailingActionsHeader ? (
        <col key={trailingActionsHeader.id} style={{ width: `${columnWidths?.[trailingActionsHeader.column.id] ?? trailingActionsHeader.getSize()}px` }} />
      ) : null}
    </colgroup>
  );
}

export function SharedTableHeader<TData>({
  table,
  onAutoFitColumn,
  visibleColumnIds,
  columnWidths,
  fillerWidth = 0,
  controlWidth = VIEWPORT_CONTROL_WIDTH,
}: {
  table: Table<TData>;
  onAutoFitColumn?: (columnId: string) => void;
  visibleColumnIds?: string[];
  columnWidths?: Record<string, number>;
  fillerWidth?: number;
  controlWidth?: number;
}) {
  return (
    <thead className="sticky top-0 z-[1] bg-surface">
      {table.getHeaderGroups().map((headerGroup) => {
        const headers = filterHeadersByIds(headerGroup.headers, visibleColumnIds);
        const trailingActionsHeader = headers.length > 0 && headers[headers.length - 1]?.column.id === 'actions'
          ? headers[headers.length - 1]
          : null;
        const leadingHeaders = trailingActionsHeader ? headers.slice(0, -1) : headers;
        const effectiveFillerWidth = trailingActionsHeader ? 0 : Math.max(fillerWidth, controlWidth);
        const renderHeaderFiller = !trailingActionsHeader && effectiveFillerWidth > 0;
        return (
          <tr key={headerGroup.id} className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} border-b border-t border-border bg-surface`}>
            {leadingHeaders.map((header, index) => {
              const meta = getColumnMeta(header.column);
              const canResize = header.column.getCanResize() && meta?.resizable !== false;
              const isResizing = header.column.getIsResizing();
              const last = index === leadingHeaders.length - 1 && !trailingActionsHeader;
              const extraWidth = trailingActionsHeader && index === leadingHeaders.length - 1 ? Math.max(fillerWidth, 0) : 0;
              const width = (columnWidths?.[header.column.id] ?? header.getSize()) + extraWidth;
              return (
                <th
                  key={header.id}
                  className={`group/table-header relative ${SHARED_TABLE_ROW_HEIGHT_CLASS} min-w-0 overflow-visible px-3 py-0 align-middle text-[11px] font-medium uppercase tracking-wide text-text-muted ${alignClass(meta?.align)} ${meta?.headerClassName ?? ''} ${last ? '' : 'border-r border-border-subtle/80'}`}
                  style={{
                    width: `${width}px`,
                    minWidth: `${width}px`,
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </div>
                  </div>
                  {canResize ? (
                    <div
                      role="separator"
                      aria-label={`Resize ${meta?.label ?? header.column.id} column`}
                      aria-orientation="vertical"
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onAutoFitColumn?.(header.column.id);
                      }}
                      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none"
                      style={{ touchAction: 'none' }}
                    >
                      <span
                        className={`absolute inset-y-1 left-1/2 w-px -translate-x-1/2 transition-colors ${isResizing ? 'bg-accent/80' : 'bg-border-subtle group-hover/table-header:bg-border-strong'}`}
                      />
                    </div>
                  ) : null}
                </th>
              );
            })}
            {renderHeaderFiller ? (
              <th
                key={`${headerGroup.id}-filler`}
                className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} min-w-0 overflow-hidden bg-surface px-0 py-0 align-middle ${trailingActionsHeader ? 'border-r border-border-subtle/80' : ''}`}
                style={{
                  width: `${effectiveFillerWidth}px`,
                  minWidth: `${effectiveFillerWidth}px`,
                }}
              />
            ) : null}
            {trailingActionsHeader ? (() => {
              const meta = getColumnMeta(trailingActionsHeader.column);
              const canResize = trailingActionsHeader.column.getCanResize() && meta?.resizable !== false;
              const isResizing = trailingActionsHeader.column.getIsResizing();
              return (
                <th
                  key={trailingActionsHeader.id}
                  className={`group/table-header relative ${SHARED_TABLE_ROW_HEIGHT_CLASS} min-w-0 overflow-visible px-3 py-0 align-middle text-[11px] font-medium uppercase tracking-wide text-text-muted ${alignClass(meta?.align)} ${meta?.headerClassName ?? ''}`}
                  style={{
                    width: `${columnWidths?.[trailingActionsHeader.column.id] ?? trailingActionsHeader.getSize()}px`,
                    minWidth: `${columnWidths?.[trailingActionsHeader.column.id] ?? trailingActionsHeader.getSize()}px`,
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      {trailingActionsHeader.isPlaceholder ? null : flexRender(trailingActionsHeader.column.columnDef.header, trailingActionsHeader.getContext())}
                    </div>
                  </div>
                  {canResize ? (
                    <div
                      role="separator"
                      aria-label={`Resize ${meta?.label ?? trailingActionsHeader.column.id} column`}
                      aria-orientation="vertical"
                      onMouseDown={trailingActionsHeader.getResizeHandler()}
                      onTouchStart={trailingActionsHeader.getResizeHandler()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onAutoFitColumn?.(trailingActionsHeader.column.id);
                      }}
                      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none"
                      style={{ touchAction: 'none' }}
                    >
                      <span
                        className={`absolute inset-y-1 left-1/2 w-px -translate-x-1/2 transition-colors ${isResizing ? 'bg-accent/80' : 'bg-border-subtle group-hover/table-header:bg-border-strong'}`}
                      />
                    </div>
                  ) : null}
                </th>
              );
            })() : null}
          </tr>
        );
      })}
    </thead>
  );
}

export function SharedViewportControlsOverlay({
  canShiftLeft,
  canShiftRight,
  onShiftLeft,
  onShiftRight,
  leadingControl,
}: {
  canShiftLeft: boolean;
  canShiftRight: boolean;
  onShiftLeft: () => void;
  onShiftRight: () => void;
  leadingControl?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute right-0 top-0 z-30 flex h-7 items-center pr-1">
      <div aria-hidden="true" className="absolute inset-y-0 right-full w-px bg-border-subtle/80" />
      <div className="pointer-events-auto relative ml-2 inline-flex items-center gap-0.5 bg-surface pl-2 pr-2">
        {leadingControl}
        <SharedColumnViewportControls
          canShiftLeft={canShiftLeft}
          canShiftRight={canShiftRight}
          onShiftLeft={onShiftLeft}
          onShiftRight={onShiftRight}
        />
      </div>
    </div>
  );
}

export function sharedCellClassName<TData>(cell: Cell<TData, unknown>, extra = '') {
  const meta = getColumnMeta(cell.column);
  const last = extra.includes('__shared-last__');
  const normalizedExtra = extra.replace('__shared-last__', '').trim();
  return `min-w-0 overflow-hidden px-3 py-0 align-middle leading-tight ${alignClass(meta?.align)} ${meta?.cellClassName ?? ''} ${last ? '' : 'border-r border-border-subtle/80'} ${normalizedExtra}`.trim();
}

export function sharedRowStyleFromWidth(width: number) {
  return {
    width: `${Math.max(0, width)}px`,
    minWidth: `${Math.max(0, width)}px`,
    tableLayout: 'fixed' as const,
  };
}

export function sharedRowStyle<TData>(table: Table<TData>) {
  const minWidth = table.getVisibleLeafColumns().reduce((total, column) => total + column.getSize(), 0);
  return sharedRowStyleFromWidth(minWidth);
}

export function useFittedTableLayout<TData>(
  table: Table<TData>,
  options?: { controlWidth?: number },
) {
  const controlWidth = options?.controlWidth ?? VIEWPORT_CONTROL_WIDTH;
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [columnOffset, setColumnOffset] = useState(0);
  const stableVisibleScrollingIdsRef = useRef<string[] | null>(null);
  const stableVisibleColumnWidthsRef = useRef<Record<string, number>>({});
  const columnSizingVersion = JSON.stringify(table.getState().columnSizing);
  const columnVisibilityVersion = JSON.stringify(table.getState().columnVisibility);
  const resizingColumnId = String((table.getState() as { columnSizingInfo?: { isResizingColumn?: string | false } }).columnSizingInfo?.isResizingColumn ?? '');
  const visibleColumnsKey = table.getVisibleLeafColumns().map((column) => column.id).join('|');

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerNode(node);
    if (node) setContainerWidth(node.clientWidth);
  }, []);

  useEffect(() => {
    if (!containerNode || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? containerNode.clientWidth;
      setContainerWidth(nextWidth);
    });
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [containerNode]);

  const layout = useMemo(() => {
    void columnSizingVersion;
    void columnVisibilityVersion;
    void resizingColumnId;
    void visibleColumnsKey;
    const columns = table.getVisibleLeafColumns();
    const columnWidths = Object.fromEntries(columns.map((column) => [column.id, column.getSize()])) as Record<string, number>;
    if (!containerWidth || columns.length === 0) {
      return {
        columnWidths,
        visibleColumnIds: columns.map((column) => column.id),
        tableWidth: columns.reduce((sum, column) => sum + column.getSize(), 0),
        fillWidth: 0,
        maxOffset: 0,
        requestedOffset: 0,
        canShiftLeft: false,
        canShiftRight: false,
        nextOffsetLeft: null,
        nextOffsetRight: null,
      };
    }

    const pinnedLeadingColumns =
      columns.length > 0 && columns[0]?.id === 'select' ? [columns[0]] : [];
    const trailingCandidateIndex = columns.length - 1;
    const pinnedTrailingColumns =
      trailingCandidateIndex >= pinnedLeadingColumns.length && columns[trailingCandidateIndex]?.id === 'actions'
        ? [columns[trailingCandidateIndex]]
        : [];
    const scrollingColumns = columns.slice(pinnedLeadingColumns.length, columns.length - pinnedTrailingColumns.length);
    const pinnedWidth = [...pinnedLeadingColumns, ...pinnedTrailingColumns].reduce(
      (sum, column) => sum + (columnWidths[column.id] ?? column.getSize()),
      0,
    );
    const reservedViewportWidth = pinnedTrailingColumns.length > 0 ? 0 : controlWidth;
    const availableWidth = Math.max(containerWidth - reservedViewportWidth - pinnedWidth, 0);
    const maxColumnWidth = Math.max(availableWidth, 120);
    const desiredColumnWidths = Object.fromEntries(
      columns.map((column) => {
        const meta = getColumnMeta(column);
        const minWidth = meta?.minWidth ?? 0;
        return [column.id, clamp(columnWidths[column.id] ?? column.getSize(), minWidth, Math.max(minWidth, maxColumnWidth))];
      }),
    ) as Record<string, number>;
    const usableWidth = availableWidth;
    const stableVisibleScrollingIds =
      stableVisibleScrollingIdsRef.current?.filter((id) => scrollingColumns.some((column) => column.id === id)) ?? [];
    if (stableVisibleScrollingIds.length > 0) {
      const trailingStableId = stableVisibleScrollingIds[stableVisibleScrollingIds.length - 1] ?? null;
      const prefixStableIds = stableVisibleScrollingIds.slice(0, -1);
      if (trailingStableId) {
        const trailingColumn = scrollingColumns.find((column) => column.id === trailingStableId) ?? null;
        if (trailingColumn) {
          const trailingMinWidth = getColumnMeta(trailingColumn)?.minWidth ?? 0;
          const prefixStableWidth = prefixStableIds.reduce(
            (sum, id) => sum + (desiredColumnWidths[id] ?? 0),
            0,
          );
          const trailingMaxWidth = Math.max(trailingMinWidth, usableWidth - prefixStableWidth);
          desiredColumnWidths[trailingStableId] = clamp(
            desiredColumnWidths[trailingStableId] ?? trailingColumn.getSize(),
            trailingMinWidth,
            trailingMaxWidth,
          );
        }
      }
    }
    const lockedVisibleScrollingIds = resizingColumnId
      ? stableVisibleScrollingIdsRef.current?.filter((id) => scrollingColumns.some((column) => column.id === id)) ?? null
      : null;
    const hasLockedVisibleSet = !!lockedVisibleScrollingIds?.length && lockedVisibleScrollingIds.includes(resizingColumnId);
    if (scrollingColumns.length === 0) {
      const occupiedWidth = [...pinnedLeadingColumns, ...pinnedTrailingColumns].reduce(
        (sum, column) => sum + (desiredColumnWidths[column.id] ?? column.getSize()),
        0,
      );
      const fillWidth = pinnedTrailingColumns.length > 0
        ? Math.max(containerWidth - occupiedWidth, 0)
        : Math.max(containerWidth - occupiedWidth, controlWidth);
      return {
        columnWidths: desiredColumnWidths,
        visibleColumnIds: [...pinnedLeadingColumns, ...pinnedTrailingColumns].map((column) => column.id),
        tableWidth: occupiedWidth + fillWidth,
        fillWidth,
        maxOffset: 0,
        requestedOffset: 0,
        canShiftLeft: false,
        canShiftRight: false,
        nextOffsetLeft: null,
        nextOffsetRight: null,
      };
    }
    if (hasLockedVisibleSet && lockedVisibleScrollingIds) {
      const visibleScrollingColumns = lockedVisibleScrollingIds
        .map((id) => scrollingColumns.find((column) => column.id === id) ?? null)
        .filter(Boolean) as Column<TData, unknown>[];
      const visibleColumns = [...pinnedLeadingColumns, ...visibleScrollingColumns, ...pinnedTrailingColumns];
      const displayColumnWidths = { ...desiredColumnWidths };

      lockedVisibleScrollingIds.forEach((id) => {
        if (id === resizingColumnId) return;
        const lockedWidth = stableVisibleColumnWidthsRef.current[id];
        if (typeof lockedWidth !== 'number' || !Number.isFinite(lockedWidth)) return;
        const column = scrollingColumns.find((item) => item.id === id);
        const minWidth = column ? (getColumnMeta(column)?.minWidth ?? 0) : 0;
        const maxWidth = Math.max(minWidth, maxColumnWidth);
        displayColumnWidths[id] = clamp(lockedWidth, minWidth, maxWidth);
      });

      const resizingVisibleColumn = visibleScrollingColumns.find((column) => column.id === resizingColumnId) ?? null;
      if (resizingVisibleColumn) {
        const resizingMinWidth = getColumnMeta(resizingVisibleColumn)?.minWidth ?? 0;
        const otherVisibleScrollingWidth = visibleScrollingColumns
          .filter((column) => column.id !== resizingColumnId)
          .reduce((sum, column) => sum + (displayColumnWidths[column.id] ?? column.getSize()), 0);
        const resizingMaxWidth = Math.max(resizingMinWidth, usableWidth - otherVisibleScrollingWidth);
        displayColumnWidths[resizingColumnId] = clamp(
          displayColumnWidths[resizingColumnId] ?? resizingVisibleColumn.getSize(),
          resizingMinWidth,
          resizingMaxWidth,
        );
      }

      const occupiedWidth = visibleColumns.reduce((sum, column) => sum + (displayColumnWidths[column.id] ?? column.getSize()), 0);
      const fillWidth = pinnedTrailingColumns.length > 0
        ? Math.max(containerWidth - occupiedWidth, 0)
        : Math.max(containerWidth - occupiedWidth, controlWidth);

      return {
        columnWidths: displayColumnWidths,
        visibleColumnIds: visibleColumns.map((column) => column.id),
        tableWidth: occupiedWidth + fillWidth,
        fillWidth,
        maxOffset: 0,
        requestedOffset: columnOffset,
        canShiftLeft: false,
        canShiftRight: false,
        nextOffsetLeft: null,
        nextOffsetRight: null,
      };
    }
    let minimumVisibleSlotCount = 0;
    let minimumUsed = 0;
    for (const column of scrollingColumns) {
      const minWidth = getColumnMeta(column)?.minWidth ?? desiredColumnWidths[column.id] ?? column.getSize();
      if (minimumUsed + minWidth > usableWidth) break;
      minimumUsed += minWidth;
      minimumVisibleSlotCount += 1;
    }
    minimumVisibleSlotCount = Math.max(1, minimumVisibleSlotCount);

    let baselineVisibleSlotCount = 0;
    let baselineUsed = 0;
    for (const column of scrollingColumns) {
      const width = desiredColumnWidths[column.id] ?? column.getSize();
      if (baselineUsed + width > usableWidth) break;
      baselineUsed += width;
      baselineVisibleSlotCount += 1;
    }
    baselineVisibleSlotCount = Math.max(1, baselineVisibleSlotCount);

    const baselineFixedCount = Math.max(0, baselineVisibleSlotCount - 1);
    const baselineRotatableColumns = scrollingColumns.slice(baselineFixedCount);
    const baselineMaxOffset = Math.max(baselineRotatableColumns.length - 1, 0);
    const requestedOffset = clamp(columnOffset, 0, baselineMaxOffset);
    const requestedRotatingIndex = clamp(
      baselineFixedCount + requestedOffset,
      0,
      Math.max(scrollingColumns.length - 1, 0),
    );
    const baselineVisibleColumns = baselineVisibleSlotCount <= 1
      ? [baselineRotatableColumns[requestedOffset] ?? scrollingColumns[0]].filter(Boolean) as Column<TData, unknown>[]
      : [
          ...scrollingColumns.slice(0, baselineFixedCount),
          baselineRotatableColumns[requestedOffset] ?? scrollingColumns[baselineFixedCount],
        ].filter(Boolean) as Column<TData, unknown>[];
    const resizingVisibleSlotIndex = resizingColumnId
      ? baselineVisibleColumns.findIndex((column) => column.id === resizingColumnId)
      : -1;
    let fixedColumns: Column<TData, unknown>[] = [];
    let rotatingColumn: Column<TData, unknown> | null = null;
    let visibleScrollingColumns: Column<TData, unknown>[] = [];
    let resolvedOffset = requestedOffset;
    let maxOffset = 0;

    const visibleSlotCount = resizingVisibleSlotIndex > 0
      ? Math.max(baselineVisibleSlotCount, resizingVisibleSlotIndex + 1)
      : baselineVisibleSlotCount;
    const fixedCount = Math.max(0, visibleSlotCount - 1);
    fixedColumns = scrollingColumns.slice(0, fixedCount);
    const rotatableColumns = scrollingColumns.slice(fixedCount);
    maxOffset = Math.max(rotatableColumns.length - 1, 0);
    const resizingRotatableIndex = resizingColumnId
      ? rotatableColumns.findIndex((column) => column.id === resizingColumnId)
      : -1;
    const adjustedRequestedOffset = clamp(requestedRotatingIndex - fixedCount, 0, maxOffset);
    resolvedOffset = resizingRotatableIndex >= 0 ? resizingRotatableIndex : adjustedRequestedOffset;
    rotatingColumn = rotatableColumns[resolvedOffset] ?? null;
    visibleScrollingColumns = [...fixedColumns, ...(rotatingColumn ? [rotatingColumn] : [])];

    const visibleColumns = [...pinnedLeadingColumns, ...visibleScrollingColumns, ...pinnedTrailingColumns];
    const visibleColumnIds = visibleColumns.map((column) => column.id);

    const displayColumnWidths = { ...desiredColumnWidths };
    if (rotatingColumn) {
      const rotatingMinWidth = getColumnMeta(rotatingColumn)?.minWidth ?? 0;
      const fixedScrollingWidth = fixedColumns.reduce(
        (sum, column) => sum + (displayColumnWidths[column.id] ?? column.getSize()),
        0,
      );
      const rotatingMaxWidth = fixedColumns.length === 0
        ? usableWidth
        : Math.max(rotatingMinWidth, usableWidth - fixedScrollingWidth);
      displayColumnWidths[rotatingColumn.id] = clamp(
        displayColumnWidths[rotatingColumn.id] ?? rotatingColumn.getSize(),
        rotatingMinWidth,
        rotatingMaxWidth,
      );
    }
    if (resizingColumnId) {
      const resizingVisibleColumn = visibleScrollingColumns.find((column) => column.id === resizingColumnId) ?? null;
      if (resizingVisibleColumn) {
        const resizingMinWidth = getColumnMeta(resizingVisibleColumn)?.minWidth ?? 0;
        const otherVisibleScrollingWidth = visibleScrollingColumns
          .filter((column) => column.id !== resizingColumnId)
          .reduce((sum, column) => sum + (displayColumnWidths[column.id] ?? column.getSize()), 0);
        const resizingMaxWidth = Math.max(resizingMinWidth, usableWidth - otherVisibleScrollingWidth);
        displayColumnWidths[resizingColumnId] = clamp(
          displayColumnWidths[resizingColumnId] ?? resizingVisibleColumn.getSize(),
          resizingMinWidth,
          resizingMaxWidth,
        );
      }
    }
    const occupiedWidth = visibleColumns.reduce((sum, column) => sum + (displayColumnWidths[column.id] ?? column.getSize()), 0);
    const rawFillWidth = pinnedTrailingColumns.length > 0
      ? Math.max(containerWidth - occupiedWidth, 0)
      : Math.max(containerWidth - occupiedWidth, controlWidth);
    const fillWidth = rawFillWidth;
    const finalOccupiedWidth = visibleColumns.reduce((sum, column) => sum + (displayColumnWidths[column.id] ?? column.getSize()), 0);

    return {
      columnWidths: displayColumnWidths,
      visibleColumnIds,
      tableWidth: finalOccupiedWidth + fillWidth,
      fillWidth,
      maxOffset,
      requestedOffset: resolvedOffset,
      canShiftLeft: resolvedOffset > 0,
      canShiftRight: resolvedOffset < maxOffset,
      nextOffsetLeft: resolvedOffset > 0 ? resolvedOffset - 1 : null,
      nextOffsetRight: resolvedOffset < maxOffset ? resolvedOffset + 1 : null,
    };
  }, [columnOffset, containerWidth, table, columnSizingVersion, columnVisibilityVersion, resizingColumnId, visibleColumnsKey, controlWidth]);

  useEffect(() => {
    if (resizingColumnId) return;
    stableVisibleScrollingIdsRef.current = layout.visibleColumnIds.filter((id) => id !== 'select' && id !== 'actions');
    stableVisibleColumnWidthsRef.current = Object.fromEntries(
      layout.visibleColumnIds
        .filter((id) => id !== 'select' && id !== 'actions')
        .map((id) => [id, layout.columnWidths[id]])
        .filter(([, width]) => typeof width === 'number' && Number.isFinite(width)),
    );
  }, [layout.visibleColumnIds, resizingColumnId]);

  return {
    containerRef,
    columnWidths: layout.columnWidths,
    visibleColumnIds: layout.visibleColumnIds,
    tableStyle: sharedRowStyleFromWidth(layout.tableWidth),
    fillWidth: layout.fillWidth,
    canShiftLeft: layout.canShiftLeft,
    canShiftRight: layout.canShiftRight,
    shiftLeft: () => setColumnOffset(layout.nextOffsetLeft ?? layout.requestedOffset),
    shiftRight: () => setColumnOffset(layout.nextOffsetRight ?? layout.requestedOffset),
  };
}

export function SharedColumnViewportControls({
  canShiftLeft,
  canShiftRight,
  onShiftLeft,
  onShiftRight,
}: {
  canShiftLeft: boolean;
  canShiftRight: boolean;
  onShiftLeft: () => void;
  onShiftRight: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={onShiftLeft}
        disabled={!canShiftLeft}
        aria-label="Show previous columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onShiftRight}
        disabled={!canShiftRight}
        aria-label="Show more columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SharedDataTable<TData>({
  table,
  rows,
  emptyState,
  selectedRowId,
  onRowClick,
  getRowAriaLabel,
  isInteractiveTarget,
  rowClassName,
  renderCompactRow,
  isCompact = false,
  onAutoFitColumn,
  bodyClassName = '',
  viewportControlWidth,
  viewportLeadingControl,
  suppressViewportOverlay = false,
  onViewportStateChange,
}: {
  table: Table<TData>;
  rows: TData[];
  emptyState: ReactNode;
  selectedRowId: string | number | null;
  onRowClick: (row: TData, element: HTMLElement) => void;
  getRowAriaLabel: (row: TData) => string;
  isInteractiveTarget?: (target: EventTarget | null) => boolean;
  rowClassName?: (row: TData, isSelected: boolean) => string;
  renderCompactRow?: (row: TData, isSelected: boolean) => ReactNode;
  isCompact?: boolean;
  onAutoFitColumn?: (columnId: string) => void;
  bodyClassName?: string;
  viewportControlWidth?: number;
  viewportLeadingControl?: ReactNode;
  suppressViewportOverlay?: boolean;
  onViewportStateChange?: (state: {
    canShiftLeft: boolean;
    canShiftRight: boolean;
    shiftLeft: () => void;
    shiftRight: () => void;
  }) => void;
}) {
  const {
    containerRef,
    columnWidths,
    visibleColumnIds,
    tableStyle,
    fillWidth,
    canShiftLeft,
    canShiftRight,
    shiftLeft,
    shiftRight,
  } = useFittedTableLayout(table, viewportControlWidth ? { controlWidth: viewportControlWidth } : undefined);

  useEffect(() => {
    onViewportStateChange?.({
      canShiftLeft,
      canShiftRight,
      shiftLeft,
      shiftRight,
    });
  }, [canShiftLeft, canShiftRight, onViewportStateChange, shiftLeft, shiftRight]);

  if (isCompact) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {rows.length === 0 ? (
            <div className="px-6 py-12">{emptyState}</div>
          ) : (
            <div>
              {rows.map((item, index) => {
                const rowId = selectedRowId != null && 'id' in (item as object) ? String((item as { id?: string | number }).id ?? index) : String(index);
                const isSelected = String(selectedRowId) === rowId;
                return (
                  <button
                    key={rowId}
                    type="button"
                    className={`block w-full border-b border-border-subtle px-4 py-3 text-left transition-colors ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover/60 active:bg-surface-hover/60'}`}
                    aria-expanded={isSelected}
                    aria-label={getRowAriaLabel(item)}
                    onClick={(event) => onRowClick(item, event.currentTarget)}
                  >
                    {renderCompactRow ? renderCompactRow(item, isSelected) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0">
        <div className="relative">
          {!suppressViewportOverlay ? (
            <SharedViewportControlsOverlay
              canShiftLeft={canShiftLeft}
              canShiftRight={canShiftRight}
              onShiftLeft={shiftLeft}
              onShiftRight={shiftRight}
              leadingControl={viewportLeadingControl}
            />
          ) : null}
          <table className="w-full border-collapse" style={tableStyle}>
            <SharedTableColGroupWithWidths
              table={table}
              columnWidths={columnWidths}
              visibleColumnIds={visibleColumnIds}
              fillerWidth={fillWidth}
              controlWidth={viewportControlWidth}
            />
            <SharedTableHeader
              table={table}
              onAutoFitColumn={onAutoFitColumn}
              visibleColumnIds={visibleColumnIds}
              columnWidths={columnWidths}
              fillerWidth={fillWidth}
              controlWidth={viewportControlWidth}
            />
          </table>
        </div>
      </div>
      <div ref={containerRef} className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${bodyClassName}`.trim()}>
        {table.getRowModel().rows.length === 0 ? (
          <div className="px-6 py-12">{emptyState}</div>
        ) : (
          <table className="w-full border-collapse" style={tableStyle}>
            <SharedTableColGroupWithWidths
              table={table}
              columnWidths={columnWidths}
              visibleColumnIds={visibleColumnIds}
              fillerWidth={fillWidth}
              controlWidth={viewportControlWidth}
            />
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const rawId = row.original && typeof row.original === 'object' && row.original !== null && 'id' in row.original
                  ? (row.original as { id?: string | number }).id
                  : row.id;
                const isSelected = selectedRowId != null && String(selectedRowId) === String(rawId);
                const cells = filterCellsByIds(row.getVisibleCells(), visibleColumnIds);
                return (
                  <tr
                    key={row.id}
                    className={`group ${SHARED_TABLE_ROW_HEIGHT_CLASS} border-b border-border-subtle transition-colors ${row.getIsSelected() && !isSelected ? 'bg-accent/8' : ''} ${rowClassName ? rowClassName(row.original, isSelected) : isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover/60'}`}
                    tabIndex={0}
                    aria-expanded={isSelected}
                    aria-label={getRowAriaLabel(row.original)}
                    onClick={(event) => {
                      if (isInteractiveTarget?.(event.target)) return;
                      onRowClick(row.original, event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      if (isInteractiveTarget?.(event.target)) return;
                      event.preventDefault();
                      onRowClick(row.original, event.currentTarget);
                    }}
                  >
                    {cells.map((cell, index) => (
                      <td key={cell.id} className={sharedCellClassName(cell, `${SHARED_TABLE_ROW_HEIGHT_CLASS} ${index === cells.length - 1 ? '__shared-last__' : ''}`)}>
                        <div className="min-w-0 overflow-hidden">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>
                      </td>
                    ))}
                    {fillWidth > 0 ? <td aria-hidden="true" className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} px-0 py-0`} /> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
