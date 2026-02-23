import { Badge } from '../shared/Badge';

const SF_COLORS: Record<string, string> = {
  queued: 'bg-amber-50 text-amber-700',
  checking: 'bg-amber-50 text-amber-700',
  uploaded: 'bg-blue-50 text-blue-700',
  not_found: 'bg-surface-hover text-text-dim',
  skipped: 'bg-surface-hover text-text-dim',
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  denied: 'bg-red-50 text-red-700',
};

export function SalesforceStatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'pending') return null;
  return (
    <Badge
      label={status}
      colorMap={SF_COLORS}
      defaultColor="bg-surface-hover text-text-dim"
      className="capitalize rounded-full px-2 py-0.5 text-[10px] leading-tight"
    />
  );
}
