import { GripHorizontal, Maximize2, Minimize2, Play, TestTube2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type WorkflowAction = 'observe' | 'annotate' | 'validate' | 'synthesize';

type WorkflowDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runningLabel?: string | null;
  onAction: (action: WorkflowAction) => void;
  children: ReactNode;
};

const SNAP_POINTS = [25, 50, 75, 100] as const;

function nearestSnap(percent: number): number {
  return SNAP_POINTS.reduce((best, point) => {
    const bestDist = Math.abs(best - percent);
    const nextDist = Math.abs(point - percent);
    return nextDist < bestDist ? point : best;
  }, SNAP_POINTS[1]);
}

export function WorkflowDrawer({ open, onOpenChange, runningLabel, onAction, children }: WorkflowDrawerProps) {
  const [heightPct, setHeightPct] = useState<number>(50);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startPct: number } | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const beginDrag = (startY: number) => {
    dragRef.current = { startY, startPct: heightPct };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!open) return;

    const updateFromClientY = (clientY: number) => {
      if (!dragRef.current || !hostRef.current) return;
      const hostRect = hostRef.current.getBoundingClientRect();
      const deltaY = dragRef.current.startY - clientY;
      const deltaPct = (deltaY / Math.max(1, hostRect.height)) * 100;
      const next = Math.max(25, Math.min(100, dragRef.current.startPct + deltaPct));
      setHeightPct(next);
    };

    const stopDrag = () => {
      if (!dragRef.current) return;
      setHeightPct((prev) => nearestSnap(prev));
      dragRef.current = null;
      setIsDragging(false);
    };

    const onPointerMove = (event: PointerEvent) => updateFromClientY(event.clientY);
    const onPointerUp = () => stopDrag();
    const onPointerCancel = () => stopDrag();
    const onMouseMove = (event: MouseEvent) => updateFromClientY(event.clientY);
    const onMouseUp = () => stopDrag();
    const onTouchMove = (event: TouchEvent) => {
      if (!event.touches.length) return;
      updateFromClientY(event.touches[0].clientY);
    };
    const onTouchEnd = () => stopDrag();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      dragRef.current = null;
      setIsDragging(false);
    };
  }, [open]);

  const statusChip = useMemo(() => {
    if (!runningLabel) return 'idle';
    return `running: ${runningLabel}`;
  }, [runningLabel]);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20">
      <div className="pointer-events-auto absolute inset-0 h-full flex items-end">
        {!open ? (
          <div className="mx-3 mb-3 overflow-x-hidden rounded-lg border border-border bg-surface p-2 shadow-lg">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-text-dim">
                <Play className="h-3.5 w-3.5 text-accent" />
                Workflow
                <span className="rounded bg-bg px-1.5 py-0.5 text-[10px]">{statusChip}</span>
              </div>
              <div className="grid w-full grid-cols-2 gap-1 sm:flex sm:w-auto sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(true);
                    setHeightPct(50);
                    onAction('observe');
                  }}
                  className="w-full rounded border border-border px-2 py-1 text-[11px] text-text-dim hover:bg-surface-hover sm:w-auto"
                >
                  Observe
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(true);
                    setHeightPct(50);
                    onAction('annotate');
                  }}
                  className="w-full rounded border border-border px-2 py-1 text-[11px] text-text-dim hover:bg-surface-hover sm:w-auto"
                >
                  Annotate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(true);
                    setHeightPct(50);
                    onAction('validate');
                  }}
                  className="w-full rounded border border-border px-2 py-1 text-[11px] text-text-dim hover:bg-surface-hover sm:w-auto"
                >
                  Validate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(true);
                    setHeightPct(50);
                    onAction('synthesize');
                  }}
                  className="w-full rounded bg-accent px-2 py-1 text-[11px] text-white hover:opacity-90 sm:w-auto"
                >
                  Synthesize
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-3 mb-3 flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl touch-pan-y" style={{ height: `${heightPct}%` }}>
            <div className="border-b border-border px-2 py-1.5">
              <div
                role="separator"
                className={`mx-auto mb-1.5 flex w-12 cursor-ns-resize items-center justify-center rounded bg-bg py-0.5 text-text-dim ${isDragging ? 'ring-1 ring-accent/60' : ''}`}
                onPointerDown={(event) => {
                  beginDrag(event.clientY);
                }}
                onMouseDown={(event) => beginDrag(event.clientY)}
                onTouchStart={(event) => {
                  if (!event.touches.length) return;
                  beginDrag(event.touches[0].clientY);
                }}
                style={{ touchAction: 'none' }}
                title="Drag to resize workflow drawer"
              >
                <GripHorizontal className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-text-dim">
                  <Wand2 className="h-3.5 w-3.5 text-accent" />
                  Workflow Builder
                  <span className="rounded bg-bg px-1.5 py-0.5 text-[10px]">{statusChip}</span>
                </div>
                <div className="grid w-full grid-cols-6 gap-1 sm:flex sm:w-auto sm:items-center">
                  <button type="button" onClick={() => setHeightPct(25)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover">25%</button>
                  <button type="button" onClick={() => setHeightPct(50)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover">50%</button>
                  <button type="button" onClick={() => setHeightPct(75)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover">75%</button>
                  <button type="button" onClick={() => setHeightPct(100)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover">Full</button>
                  <button type="button" onClick={() => setHeightPct((prev) => (prev < 100 ? 100 : 50))} className="rounded border border-border p-1 text-text-dim hover:bg-surface-hover">
                    {heightPct < 100 ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" onClick={() => onOpenChange(false)} className="rounded border border-border px-2 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover">Close</button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:flex sm:items-center">
                <button type="button" onClick={() => onAction('observe')} className="w-full rounded border border-border px-2 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover sm:w-auto">Observe</button>
                <button type="button" onClick={() => onAction('annotate')} className="w-full rounded border border-border px-2 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover sm:w-auto">Annotate</button>
                <button type="button" onClick={() => onAction('validate')} className="w-full rounded border border-border px-2 py-0.5 text-[10px] text-text-dim hover:bg-surface-hover sm:w-auto"><TestTube2 className="mr-1 inline h-3 w-3" />Validate</button>
                <button type="button" onClick={() => onAction('synthesize')} className="w-full rounded bg-accent px-2 py-0.5 text-[10px] text-white hover:opacity-90 sm:w-auto">Synthesize</button>
              </div>
            </div>
            <div
              ref={bodyScrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 touch-pan-y [scrollbar-gutter:stable] [scroll-behavior:smooth] [overscroll-behavior-y:contain]"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {children}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
