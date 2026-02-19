import type { LucideIcon } from 'lucide-react';
import { StatCard } from './StatCard';

type StatItem = {
  label: string;
  value: string | number;
  delta: string;
  icon: LucideIcon;
  onClick: () => void;
};

type DashboardStatsGridProps = {
  items: StatItem[];
};

export function DashboardStatsGrid({ items }: DashboardStatsGridProps) {
  return (
    <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4" data-component="dashboard-stats-grid">
      {items.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value}
          delta={item.delta}
          Icon={item.icon}
          onClick={item.onClick}
        />
      ))}
    </section>
  );
}
