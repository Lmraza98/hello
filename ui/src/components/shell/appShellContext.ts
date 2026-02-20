import { useOutletContext } from 'react-router-dom';

export type AppShellQuickAddTarget = 'contact' | 'company' | 'campaign' | null;

export interface AppShellOutletContext {
  openAddModalTarget: AppShellQuickAddTarget;
  clearAddModalTarget: () => void;
}

export function useAppShellContext() {
  return useOutletContext<AppShellOutletContext>();
}
