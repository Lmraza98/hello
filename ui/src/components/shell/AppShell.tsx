'use client';

import type { ReactNode } from 'react';
import { ChatFirstShell } from './ChatFirstShell';
export { useAppShellContext } from './appShellContext';

export function AppShell({ children }: { children: ReactNode }) {
  return <ChatFirstShell>{children}</ChatFirstShell>;
}
