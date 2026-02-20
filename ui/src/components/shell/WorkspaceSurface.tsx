import { Maximize2, Minimize2, PanelTopClose, PanelTopOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import type { WorkspaceMode } from './workspaceLayout';

type WorkspaceSurfaceProps = {
  open: boolean;
  mode: WorkspaceMode;
  mobile: boolean;
  title: string;
  subtitle?: string;
  closedLabel?: string;
  onOpen: () => void;
  onClose: () => void;
  onModeChange: (mode: WorkspaceMode) => void;
  children: ReactNode;
};

export function WorkspaceSurface({
  open,
  mode,
  mobile,
  title,
  subtitle,
  closedLabel = 'Open Workspace',
  onOpen,
  onClose,
  onModeChange,
  children,
}: WorkspaceSurfaceProps) {
  const resolvedMode: WorkspaceMode = mobile ? 'fullscreen' : mode;
  const maxHeightClass = resolvedMode === 'drawer' ? 'max-h-[54vh]' : 'max-h-[74vh]';
  const panelHeightClass = resolvedMode === 'drawer' ? 'h-[50vh]' : 'h-[70vh]';

  if (!open) {
    return (
      <div className="shrink-0 px-3 py-2">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2.5 py-1 text-xs text-text-muted hover:bg-surface-hover"
          >
            <PanelTopOpen className="h-3.5 w-3.5" />
            {closedLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border/70 bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{title}</p>
          {subtitle ? <p className="truncate text-xs text-text-muted">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {open ? (
            <button
              type="button"
              onClick={() => onModeChange(resolvedMode === 'drawer' ? 'fullscreen' : 'drawer')}
              className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
              title={resolvedMode === 'drawer' ? 'Expand workspace' : 'Dock workspace'}
            >
              {resolvedMode === 'drawer' ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          {open ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover"
              title="Hide workspace"
            >
              <span className="inline-flex items-center gap-1">
                <PanelTopClose className="h-3.5 w-3.5" />
                Close
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={`overflow-hidden px-3 pb-2 transition-[max-height,opacity,transform] duration-300 ease-out ${
          open ? `${maxHeightClass} translate-y-0 opacity-100` : 'pointer-events-none max-h-0 -translate-y-2 opacity-0'
        }`}
      >
        <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-bg ${panelHeightClass}`}>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </section>
      </div>
    </div>
  );
}
