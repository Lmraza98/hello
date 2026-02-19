import type { ReactNode, UIEventHandler } from 'react';

export function MessageList({
  containerRef,
  onScroll,
  children,
}: {
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-4 [overflow-anchor:none]"
    >
      {children}
    </div>
  );
}
