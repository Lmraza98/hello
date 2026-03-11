import { useEffect, useMemo, useState } from 'react';

type ColumnVisibilityState = Record<string, boolean>;

const STORAGE_PREFIX = 'datatable:prefs:';

function sanitizeColumnOrder(columnIds: string[], nextOrder: string[]) {
  const known = new Set(columnIds);
  const order = nextOrder.filter((id, index) => known.has(id) && nextOrder.indexOf(id) === index);
  columnIds.forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });
  return order;
}

function sanitizeColumnVisibility(columnIds: string[], nextVisibility: ColumnVisibilityState, initialVisibility: ColumnVisibilityState) {
  return columnIds.reduce<ColumnVisibilityState>((acc, id) => {
    if (typeof nextVisibility[id] === 'boolean') {
      acc[id] = nextVisibility[id];
      return acc;
    }
    if (typeof initialVisibility[id] === 'boolean') {
      acc[id] = initialVisibility[id];
    }
    return acc;
  }, {});
}

function readStoredPreferences(storageKey: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { columnOrder?: string[]; columnVisibility?: ColumnVisibilityState } | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function usePersistentColumnPreferences({
  storageKey,
  columnIds,
  initialVisibility = {},
}: {
  storageKey: string;
  columnIds: string[];
  initialVisibility?: ColumnVisibilityState;
}) {
  const stableColumnIds = useMemo(() => columnIds, [columnIds]);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const stored = readStoredPreferences(storageKey);
    return sanitizeColumnOrder(stableColumnIds, stored?.columnOrder ?? stableColumnIds);
  });
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() => {
    const stored = readStoredPreferences(storageKey);
    return sanitizeColumnVisibility(stableColumnIds, stored?.columnVisibility ?? {}, initialVisibility);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${storageKey}`,
      JSON.stringify({
        columnOrder: sanitizeColumnOrder(stableColumnIds, columnOrder),
        columnVisibility: sanitizeColumnVisibility(stableColumnIds, columnVisibility, initialVisibility),
      }),
    );
  }, [columnOrder, columnVisibility, initialVisibility, stableColumnIds, storageKey]);

  return {
    columnOrder: sanitizeColumnOrder(stableColumnIds, columnOrder),
    setColumnOrder,
    columnVisibility: sanitizeColumnVisibility(stableColumnIds, columnVisibility, initialVisibility),
    setColumnVisibility,
  };
}
