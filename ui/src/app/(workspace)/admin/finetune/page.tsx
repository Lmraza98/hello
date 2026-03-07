'use client';

import { useRouter } from 'next/navigation';
import Admin from '../../../../pages/admin/Admin';
import AdminLogs from '../../../../pages/admin/AdminLogs';
import AdminCosts from '../../../../pages/admin/AdminCosts';
import AdminFinetune from '../../../../pages/admin/AdminFinetune';
import AdminTests from '../../../../pages/admin/AdminTests';

export default function AdminFinetunePage() {
  const router = useRouter();
  return (
    <Admin
      tab="finetune"
      onTabChange={(next) => router.push(`/admin/${next}`)}
      logsContent={<AdminLogs />}
      costsContent={<AdminCosts />}
      finetuneContent={<AdminFinetune />}
      testsContent={<AdminTests />}
    />
  );
}
