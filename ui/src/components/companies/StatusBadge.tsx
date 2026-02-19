import { Badge } from '../shared/Badge';

const STATUS_COLORS: Record<string, string> = {
  pending: 'border border-slate-200 bg-slate-50 text-slate-700',
  processing: 'border border-amber-200 bg-amber-50 text-amber-800',
  completed: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  scraped: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  no_results: 'border border-red-200 bg-red-50 text-red-700',
  error: 'border border-red-200 bg-red-50 text-red-700',
  skipped: 'border border-slate-200 bg-slate-50 text-slate-600',
};

export function StatusBadge({ status }: { status: string | null }) {
  const s = status || 'pending';
  const displayStatus = s === 'scraped' ? 'completed' : s;
  return <Badge label={displayStatus} colorMap={STATUS_COLORS} className="capitalize rounded-full px-2.5 py-0.5 text-[11px]" />;
}
