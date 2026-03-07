import type { ReactNode, UIEventHandler } from 'react';

export function MessageList({
  containerRef,
  onScroll,
  avoidanceZone,
  children,
}: {
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  avoidanceZone?: { top: number; height: number; width: number } | null;
  children: ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-2 [overflow-anchor:none]"
    >
      {avoidanceZone && avoidanceZone.top > 0 ? (
        <div aria-hidden="true" style={{ height: `${avoidanceZone.top}px` }} />
      ) : null}
      {avoidanceZone && avoidanceZone.height > 0 && avoidanceZone.width > 0 ? (
        <div
          aria-hidden="true"
          className="float-right pointer-events-none"
          style={{ width: `${avoidanceZone.width}px`, height: `${avoidanceZone.height}px` }}
        />
      ) : null}
      {children}
      {avoidanceZone ? <div aria-hidden="true" className="clear-both h-0" /> : null}
    </div>
  );
}
