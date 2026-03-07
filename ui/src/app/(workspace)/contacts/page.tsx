'use client';

import Contacts from '../../../pages/Contacts';
import { useAppShellContext } from '../../../components/shell/AppShell';

export default function ContactsPage() {
  const { openAddModalTarget, clearAddModalTarget } = useAppShellContext();
  return <Contacts openAddModal={openAddModalTarget === 'contact'} onModalOpened={clearAddModalTarget} />;
}
