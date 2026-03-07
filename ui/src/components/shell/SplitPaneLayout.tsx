import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type SplitPaneLayoutProps = {
  leftPane: ReactNode;
  mainPane: ReactNode;
  defaultLeftWidth: number;
  minLeftWidth: number;
  maxLeftWidth: number;
  storageKey: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth(storageKey: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function SplitPaneLayout({
  leftPane,
  mainPane,
  defaultLeftWidth,
  minLeftWidth,
  maxLeftWidth,
  storageKey,
}: SplitPaneLayoutProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => clamp(defaultLeftWidth, minLeftWidth, maxLeftWidth));

  useEffect(() => {
    const stored = readStoredWidth(storageKey);
    if (stored == null) return;
    setLeftWidth(clamp(stored, minLeftWidth, maxLeftWidth));
  }, [defaultLeftWidth, minLeftWidth, maxLeftWidth, storageKey]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(leftWidth));
    } catch {
      // ignore storage failures
    }
  }, [leftWidth, storageKey]);

  const stopDragging = () => {
    pointerIdRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDesktop) return;
    pointerIdRef.current = event.pointerId;
    handleRef.current?.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId || !rootRef.current || !isDesktop) return;
    const rect = rootRef.current.getBoundingClientRect();
    const nextWidth = clamp(event.clientX - rect.left, minLeftWidth, maxLeftWidth);
    setLeftWidth(nextWidth);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    if (handleRef.current?.hasPointerCapture(event.pointerId)) {
      handleRef.current.releasePointerCapture(event.pointerId);
    }
    stopDragging();
  };

  useEffect(() => {
    return () => stopDragging();
  }, []);

  const desktopLeftStyle = useMemo(
    () => ({ width: `${leftWidth}px`, minWidth: `${minLeftWidth}px`, maxWidth: `${maxLeftWidth}px` }),
    [leftWidth, minLeftWidth, maxLeftWidth]
  );

  return (
    <div ref={rootRef} className="flex-1 min-h-0 overflow-hidden p-2 md:p-3">
      <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-border/80 bg-surface">
        <aside className="min-h-0 w-full md:w-auto md:shrink-0" style={isDesktop ? desktopLeftStyle : undefined}>
          {leftPane}
        </aside>

        <div className="relative hidden w-2 shrink-0 cursor-col-resize md:block">
          <button
            ref={handleRef}
            type="button"
            aria-label="Resize split panes"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="absolute inset-0 z-10 touch-none"
          />
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
        </div>

        <section className="min-h-0 min-w-0 flex-1 border-l border-border/50 md:border-l-0">{mainPane}</section>
      </div>
    </div>
  );
}
