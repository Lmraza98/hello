import { Badge } from '../shared/Badge';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  processing: 'bg-indigo-50 text-indigo-700',
  completed: 'bg-green-50 text-green-700',
  scraped: 'bg-green-50 text-green-700',
  no_results: 'bg-red-50 text-red-700',
  error: 'bg-red-50 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
};

export function StatusBadge({ status }: { status: string | null }) {
  const s = status || 'pending';
  const displayStatus = s === 'scraped' ? 'completed' : s;
  return <Badge label={displayStatus} colorMap={STATUS_COLORS} className="capitalize" />;
}
