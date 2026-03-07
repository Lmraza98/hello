import type { KeyboardEvent, ReactNode } from 'react';

export type StandardEmailColumn<T> = {
  key: string;
  label: string;
  width?: string;
  className?: string;
  render: (item: T) => ReactNode;
};

type StandardEmailTableProps<T> = {
  columns: StandardEmailColumn<T>[];
  rows: T[];
  rowId: (item: T) => number | string;
  selectedId: number | string | null;
  onSelectRow: (item: T, element: HTMLElement) => void;
  getRowAriaLabel: (item: T) => string;
  emptyState: ReactNode;
  minWidth?: string;
  isCompact?: boolean;
  renderCompactRow?: (item: T, isSelected: boolean) => ReactNode;
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
  minWidth = '920px',
  isCompact = false,
  renderCompactRow,
}: StandardEmailTableProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, item: T) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    onSelectRow(item, event.currentTarget);
  };

  return (
    <div className="flex min-w-0 min-h-0 flex-1 flex-col">
      {!isCompact ? (
        <div className="shrink-0">
          <table className="w-full border-collapse" style={{ minWidth, tableLayout: 'fixed' }}>
            <colgroup>
              {columns.map((column) => (
                <col key={column.key} style={column.width ? { width: column.width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr className="h-9 border-b border-border-subtle bg-surface-hover/30">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted ${column.className ?? ''}`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="px-6 py-12">{emptyState}</div>
        ) : isCompact ? (
          <div>
            {rows.map((item) => {
              const id = rowId(item);
              const isSelected = selectedId === id;
              return (
                <button
                  key={String(id)}
                  type="button"
                  className={`block w-full border-b border-border-subtle px-4 py-3 text-left transition-colors ${
                    isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover/60 active:bg-surface-hover/60'
                  }`}
                  aria-expanded={isSelected}
                  aria-label={getRowAriaLabel(item)}
                  onClick={(event) => onSelectRow(item, event.currentTarget)}
                >
                  {renderCompactRow ? renderCompactRow(item, isSelected) : columns[0]?.render(item)}
                </button>
              );
            })}
          </div>
        ) : (
          <table className="w-full border-collapse" style={{ minWidth, tableLayout: 'fixed' }}>
            <colgroup>
              {columns.map((column) => (
                <col key={column.key} style={column.width ? { width: column.width } : undefined} />
              ))}
            </colgroup>
            <tbody>
              {rows.map((item) => {
                const id = rowId(item);
                const isSelected = selectedId === id;
                return (
                  <tr
                    key={String(id)}
                    className={`group h-[42px] cursor-pointer border-b border-border-subtle transition-colors ${
                      isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover/60'
                    }`}
                    tabIndex={0}
                    aria-expanded={isSelected}
                    aria-label={getRowAriaLabel(item)}
                    onClick={(event) => {
                      if (isInteractiveTarget(event.target)) return;
                      onSelectRow(item, event.currentTarget);
                    }}
                    onKeyDown={(event) => handleKeyDown(event, item)}
                  >
                    {columns.map((column) => (
                      <td key={`${String(id)}-${column.key}`} className={`h-[42px] px-3 py-0 align-middle leading-tight ${column.className ?? ''}`}>
                        {column.render(item)}
                      </td>
                    ))}
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
