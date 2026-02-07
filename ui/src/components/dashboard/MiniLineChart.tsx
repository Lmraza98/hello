import { useState, useMemo } from 'react';

export interface DailyPoint {
  date: string;
  sent: number;
  viewed: number;
  responded: number;
}

type MiniLineChartProps = {
  data: DailyPoint[];
};

export function MiniLineChart({ data }: MiniLineChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const chartW = 500;
  const chartH = 140;
  const padL = 0;
  const padR = 0;
  const padT = 8;
  const padB = 24;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const maxVal = useMemo(
    () => Math.max(1, ...data.map((d) => Math.max(d.sent, d.viewed, d.responded))),
    [data]
  );

  const xStep = data.length > 1 ? innerW / (data.length - 1) : innerW;
  const yScale = (v: number) => padT + innerH - (v / maxVal) * innerH;
  const xScale = (i: number) => padL + (data.length === 1 ? innerW / 2 : i * xStep);

  const makePath = (key: keyof DailyPoint) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d[key] as number).toFixed(1)}`).join(' ');

  const lines: { key: keyof DailyPoint; color: string; label: string }[] = [
    { key: 'sent', color: '#6366f1', label: 'Sent' },
    { key: 'viewed', color: '#22c55e', label: 'Viewed' },
    { key: 'responded', color: '#f59e0b', label: 'Responded' },
  ];

  const hoveredPoint = hovered !== null ? data[hovered] : null;

  return (
    <div className="relative select-none">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-2">
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
            <span className="text-[11px] text-text-muted">{l.label}</span>
          </div>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Horizontal grid — 3 lines */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = padT + innerH * (1 - frac);
          return (
            <line
              key={frac}
              x1={padL}
              x2={chartW - padR}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-border"
              strokeWidth="0.5"
            />
          );
        })}

        {/* Area fills (very subtle) */}
        {lines.map((l) => {
          const path = data
            .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d[l.key] as number).toFixed(1)}`)
            .join(' ');
          const areaPath = `${path} L${xScale(data.length - 1).toFixed(1)},${padT + innerH} L${xScale(0).toFixed(1)},${padT + innerH} Z`;
          return <path key={l.key} d={areaPath} fill={l.color} opacity={0.04} />;
        })}

        {/* Lines */}
        {lines.map((l) => (
          <path
            key={l.key}
            d={makePath(l.key)}
            fill="none"
            stroke={l.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Dots on hovered column */}
        {hoveredPoint !== null &&
          hovered !== null &&
          lines.map((l) => (
            <circle
              key={l.key}
              cx={xScale(hovered)}
              cy={yScale(hoveredPoint[l.key] as number)}
              r="3.5"
              fill={l.color}
              stroke="white"
              strokeWidth="2"
            />
          ))}

        {/* Hover vertical line */}
        {hovered !== null && (
          <line
            x1={xScale(hovered)}
            x2={xScale(hovered)}
            y1={padT}
            y2={padT + innerH}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
        )}

        {/* Date labels */}
        {data.map((d, i) => {
          // Show ~5 labels evenly spaced
          const show = data.length <= 7 || i % Math.ceil(data.length / 5) === 0 || i === data.length - 1;
          if (!show) return null;
          const label = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return (
            <text key={i} x={xScale(i)} y={chartH - 2} textAnchor="middle" className="fill-text-dim" style={{ fontSize: '10px' }}>
              {label}
            </text>
          );
        })}

        {/* Invisible hover zones */}
        {data.map((_, i) => (
          <rect
            key={i}
            x={xScale(i) - xStep / 2}
            y={0}
            width={xStep}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHovered(i)}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredPoint !== null && hovered !== null && (
        <div
          className="absolute top-0 pointer-events-none bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs z-10"
          style={{
            left: `${(xScale(hovered) / chartW) * 100}%`,
            transform: `translateX(${hovered > data.length / 2 ? '-100%' : '0'})`,
          }}
        >
          <div className="font-medium text-text mb-1">
            {new Date(hoveredPoint.date + 'T00:00:00').toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
          {lines.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                {l.label}
              </span>
              <span className="font-medium text-text tabular-nums">{(hoveredPoint[l.key] as number).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
