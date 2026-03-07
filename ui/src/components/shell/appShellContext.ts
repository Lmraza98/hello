import { createContext, useContext } from 'react';

export type AppShellQuickAddTarget = 'contact' | 'company' | 'campaign' | null;

export interface AppShellContextValue {
  openAddModalTarget: AppShellQuickAddTarget;
  clearAddModalTarget: () => void;
}

export const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShellContext() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error('useAppShellContext must be used inside AppShellContext provider');
  }
  return context;
}
