import { Badge } from '../shared/Badge';

const SF_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  uploaded: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  denied: 'bg-red-50 text-red-700',
};

export function SalesforceStatusBadge({ status }: { status: string | null }) {
  const s = status || 'pending';
  return <Badge label={s} colorMap={SF_COLORS} defaultColor="bg-amber-50 text-amber-700" className="capitalize" />;
}
