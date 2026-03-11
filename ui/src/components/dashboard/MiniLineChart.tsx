import { useEffect, useMemo, useRef, useState } from 'react';

export interface DailyPoint {
  date: string;
  sent: number;
  viewed: number;
  responded: number;
}

type MiniLineChartProps = {
  data: DailyPoint[];
  secondaryData?: DailyPoint[];
  compact?: boolean;
  hideLegend?: boolean;
  focusMetric?: keyof DailyPoint | null;
};

export function MiniLineChart({
  data,
  secondaryData,
  compact = false,
  hideLegend = false,
  focusMetric = null,
}: MiniLineChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      const nextWidth = Math.max(1, Math.round(node.getBoundingClientRect().width));
      setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    window.addEventListener('resize', updateWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  const chartW = Math.max(containerWidth, 320);
  const chartH = compact ? 92 : 136;
  const padL = 0;
  const padR = 0;
  const padT = 8;
  const padB = compact ? 18 : 24;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const maxVal = useMemo(() => {
    const values = [...data, ...(secondaryData || [])];
    return Math.max(1, ...values.map((d) => Math.max(d.sent, d.viewed, d.responded)));
  }, [data, secondaryData]);

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
    <div ref={containerRef} className="relative h-full min-h-0 w-full select-none overflow-hidden">
      {!hideLegend ? (
        <div className="mb-2 flex items-center gap-4">
          {lines.map((l) => (
            <div key={l.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="text-[11px] text-text-muted">{l.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="block h-full w-full"
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
              strokeWidth="0.75"
            />
          );
        })}

        {/* Secondary lines (faded baseline) */}
        {secondaryData && secondaryData.length === data.length
          ? lines.map((l) => {
              const secondaryPath = secondaryData
                .map(
                  (d, i) =>
                    `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d[l.key] as number).toFixed(1)}`
                )
                .join(' ');
              return (
                <path
                  key={`secondary-${l.key}`}
                  d={secondaryPath}
                  fill="none"
                  stroke={l.color}
                  strokeOpacity={0.2}
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })
          : null}

        {/* Area fills (very subtle) */}
        {lines.map((l) => {
          const path = data
            .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d[l.key] as number).toFixed(1)}`)
            .join(' ');
          const areaPath = `${path} L${xScale(data.length - 1).toFixed(1)},${padT + innerH} L${xScale(0).toFixed(1)},${padT + innerH} Z`;
          return (
            <path
              key={l.key}
              d={areaPath}
              fill={l.color}
              opacity={focusMetric && focusMetric !== l.key ? 0.015 : 0.04}
            />
          );
        })}

        {/* Lines */}
        {lines.map((l) => (
          <path
            key={l.key}
            d={makePath(l.key)}
            fill="none"
            stroke={l.color}
            strokeOpacity={focusMetric && focusMetric !== l.key ? 0.28 : 1}
            strokeWidth="1.5"
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
              r="3"
              fill={l.color}
              stroke="white"
              strokeWidth="1.5"
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
