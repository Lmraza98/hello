type StatCardProps = {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
};

export function StatCard({ label, value, icon: Icon, color = 'accent' }: StatCardProps) {
  const colors: Record<string, string> = {
    accent: 'bg-indigo-50 text-accent',
    success: 'bg-green-50 text-success',
    warning: 'bg-amber-50 text-warning',
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4 md:p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-text-muted mb-1">{label}</p>
          <p className="text-2xl md:text-3xl font-semibold text-text tabular-nums">{value.toLocaleString()}</p>
        </div>
        <div className={`w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center shrink-0 ${colors[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}
