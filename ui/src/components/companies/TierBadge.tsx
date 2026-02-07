import { Badge } from '../shared/Badge';

const TIER_COLORS: Record<string, string> = {
  A: 'bg-green-50 text-green-700',
  B: 'bg-blue-50 text-blue-700',
  C: 'bg-purple-50 text-purple-700',
};

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return <Badge label={tier} colorMap={TIER_COLORS} />;
}
