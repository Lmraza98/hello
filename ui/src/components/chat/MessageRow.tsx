import type { ReactNode } from 'react';

export function MessageRow({
  gapClass,
  children,
}: {
  gapClass: string;
  children: ReactNode;
}) {
  return <div className={gapClass}>{children}</div>;
}

