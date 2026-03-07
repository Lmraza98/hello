import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';

type BottomDrawerContainerProps = {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
};

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function BottomDrawerContainer({ onClose, children, ariaLabel = 'Details drawer' }: BottomDrawerContainerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);
  const [entered, setEntered] = useState(false);
  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  useEffect(() => {
    prevFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = window.requestAnimationFrame(() => setEntered(true));

    const node = drawerRef.current;
    if (node) {
      const focusable = getFocusable(node);
      (focusable[0] || node).focus();
    }

    return () => {
      window.cancelAnimationFrame(id);
      prevFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!drawerRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(drawerRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    setDragStartY(event.touches[0]?.clientY ?? null);
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (dragStartY === null) return;
    const current = event.touches[0]?.clientY ?? dragStartY;
    const delta = Math.max(0, current - dragStartY);
    setDragOffsetY(delta);
  };

  const onTouchEnd = () => {
    if (dragOffsetY > 110) {
      onClose();
    } else {
      setDragOffsetY(0);
    }
    setDragStartY(null);
  };

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`fixed inset-x-0 bottom-0 z-40 max-h-[92vh] rounded-t-2xl border border-border bg-surface shadow-2xl transition-transform duration-200 ease-out ${
          entered ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ transform: `translateY(${dragOffsetY}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border" />
        <div className="min-h-0 max-h-[calc(92vh-16px)] overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
