const SF_COLORS: Record<string, string> = {
  'inbound created': 'bg-red-50 text-red-700',
  'inbound mapped': 'bg-orange-50 text-orange-700',
  'inbound partial': 'bg-amber-50 text-amber-700',
  queued: 'bg-amber-50 text-amber-700',
  checking: 'bg-amber-50 text-amber-700',
  uploaded: 'bg-blue-50 text-blue-700',
  not_found: 'bg-surface-hover text-text-dim',
  skipped: 'bg-surface-hover text-text-dim',
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  denied: 'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  'inbound created': 'Inbound New',
  'inbound mapped': 'Inbound Mapped',
  'inbound partial': 'Inbound Partial',
};

const ENGAGEMENT_COLORS: Record<string, string> = {
  replied: 'border border-emerald-300 bg-emerald-50 text-emerald-700',
  failed: 'border border-rose-300 bg-rose-50 text-rose-700',
  completed: 'border border-green-300 bg-green-50 text-green-700',
  scheduled: 'border border-amber-300 bg-amber-50 text-amber-700',
  in_sequence: 'border border-sky-300 bg-sky-50 text-sky-700',
  enrolled: 'border border-indigo-300 bg-indigo-50 text-indigo-700',
  synced: 'border border-blue-300 bg-blue-50 text-blue-700',
  needs_sync: 'border border-orange-300 bg-orange-50 text-orange-700',
};

const ENGAGEMENT_LABELS: Record<string, string> = {
  replied: 'Replied',
  failed: 'Failed',
  completed: 'Completed',
  scheduled: 'Scheduled',
  in_sequence: 'In Sequence',
  enrolled: 'Enrolled',
  synced: 'Synced to Salesforce',
  needs_sync: 'Needs Sync',
};

export function SalesforceStatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'pending') return null;
  const normalized = status.toLowerCase();
  const label = STATUS_LABELS[normalized] || status;
  const color = SF_COLORS[normalized] || 'bg-surface-hover text-text-dim';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] leading-tight whitespace-nowrap inline-block align-middle ${color}`}>
      {label}
    </span>
  );
}

export function EngagementStatusBadge({ status }: { status: string | null }) {
  const normalized = (status || 'needs_sync').toLowerCase();
  const label = ENGAGEMENT_LABELS[normalized] || status || 'Needs Sync';
  const color = ENGAGEMENT_COLORS[normalized] || ENGAGEMENT_COLORS.needs_sync;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] leading-tight whitespace-nowrap inline-block align-middle ${color}`}>
      {label}
    </span>
  );
}

const SYNC_COLORS: Record<string, string> = {
  queued: 'bg-amber-50 text-amber-700',
  creating: 'bg-amber-50 text-amber-700',
  success: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
  failed_no_credentials: 'bg-red-50 text-red-700',
  failed_auth: 'bg-red-50 text-red-700',
};

const SYNC_LABELS: Record<string, string> = {
  queued: 'SF queued',
  creating: 'SF creating',
  success: 'SF success',
  failed: 'SF failed',
  failed_no_credentials: 'SF no creds',
  failed_auth: 'SF auth failed',
};

export function SalesforceSyncBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const normalized = status.toLowerCase();
  // Success is non-actionable noise in the main status column; keep only active/error sync states.
  if (normalized === 'success') return null;
  const label = SYNC_LABELS[normalized] || `SF ${status}`;
  const color = SYNC_COLORS[normalized] || 'bg-surface-hover text-text-dim';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] leading-tight whitespace-nowrap inline-block align-middle ${color}`}>
      {label}
    </span>
  );
}
