import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

type MiniMetricProps = {
  label: string;
  value: number;
  delta?: number;
  icon: React.ElementType;
  color: string;
};

export function MiniMetric({ label, value, delta, icon: Icon, color }: MiniMetricProps) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold text-text tabular-nums">{value.toLocaleString()}</span>
          {delta !== undefined && delta !== 0 && (
            <span className={`flex items-center text-[10px] font-medium ${delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {delta > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(delta)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
