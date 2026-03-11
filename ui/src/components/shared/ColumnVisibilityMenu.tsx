import { ChevronDown, ChevronUp } from 'lucide-react';

export type ColumnVisibilityMenuItem = {
  id: string;
  label: string;
  visible: boolean;
  canHide?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
};

export function ColumnVisibilityMenu({
  items,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  items: ColumnVisibilityMenuItem[];
  onToggle: (columnId: string, visible: boolean) => void;
  onMoveUp: (columnId: string) => void;
  onMoveDown: (columnId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Visible Columns</p>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 rounded-sm px-1 py-1 hover:bg-surface-hover/60">
            <label className="flex min-w-0 items-center gap-2 text-[12px] text-text">
              <input
                type="checkbox"
                checked={item.visible}
                disabled={item.canHide === false}
                onChange={(event) => onToggle(item.id, event.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-accent focus:ring-accent"
              />
              <span className="truncate">
                {item.label}
                {item.canHide === false ? ' (required)' : ''}
              </span>
            </label>
            <div className="inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onMoveUp(item.id)}
                disabled={!item.canMoveUp}
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-30"
                aria-label={`Move ${item.label} up`}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMoveDown(item.id)}
                disabled={!item.canMoveDown}
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-30"
                aria-label={`Move ${item.label} down`}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
