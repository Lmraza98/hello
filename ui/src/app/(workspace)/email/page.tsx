'use client';

import Email from '../../../pages/Email';
import { useAppShellContext } from '../../../components/shell/AppShell';

export default function EmailPage() {
  const { openAddModalTarget, clearAddModalTarget } = useAppShellContext();
  return <Email openAddModal={openAddModalTarget === 'campaign'} onModalOpened={clearAddModalTarget} />;
}
