import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { SidePanelContainer } from './SidePanelContainer';

type ResizableSidePanelProps = {
  children: ReactNode;
  ariaLabel?: string;
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth(storageKey: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const ResizableSidePanel = forwardRef<HTMLDivElement, ResizableSidePanelProps>(function ResizableSidePanel({
  children,
  ariaLabel = 'Details panel',
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}, ref) {
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const dragStartWidthRef = useRef<number | null>(null);
  const [width, setWidth] = useState(() => clamp(readStoredWidth(storageKey) ?? defaultWidth, minWidth, maxWidth));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      // ignore storage failures
    }
  }, [storageKey, width]);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  const stopDragging = () => {
    pointerIdRef.current = null;
    dragStartXRef.current = null;
    dragStartWidthRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      if (dragStartXRef.current == null || dragStartWidthRef.current == null) return;
      const delta = dragStartXRef.current - event.clientX;
      const nextWidth = clamp(dragStartWidthRef.current + delta, minWidth, maxWidth);
      setWidth(nextWidth);
    };

    const handlePointerUp = (event: globalThis.PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      if (handleRef.current?.hasPointerCapture(event.pointerId)) {
        handleRef.current.releasePointerCapture(event.pointerId);
      }
      stopDragging();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [maxWidth, minWidth]);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    pointerIdRef.current = event.pointerId;
    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = width;
    handleRef.current?.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setWidth((current) => clamp(current + 24, minWidth, maxWidth));
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setWidth((current) => clamp(current - 24, minWidth, maxWidth));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setWidth(minWidth);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setWidth(maxWidth);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setWidth(clamp(defaultWidth, minWidth, maxWidth));
    }
  };

  const panelStyle = useMemo(
    () => ({ width: `${width}px`, minWidth: `${minWidth}px`, maxWidth: `${maxWidth}px` }),
    [maxWidth, minWidth, width]
  );

  return (
    <>
      <div className="group relative flex h-full w-px shrink-0 cursor-col-resize items-stretch justify-center bg-border">
        <button
          ref={handleRef}
          type="button"
          role="separator"
          aria-label="Resize details panel"
          aria-orientation="vertical"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onDoubleClick={() => setWidth(clamp(defaultWidth, minWidth, maxWidth))}
          className="absolute inset-y-0 left-1/2 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none focus:outline-none"
        />
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-strong transition-colors group-hover:bg-text-muted" />
      </div>
      <SidePanelContainer ref={ref} ariaLabel={ariaLabel} style={panelStyle} className="relative w-auto max-w-none border-l-0">
        {children}
      </SidePanelContainer>
    </>
  );
});
