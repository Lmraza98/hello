import React, { useMemo, useRef, useState } from "react";
import { AlertCircle, Camera, CheckCircle2, Flag, PlayCircle, StickyNote } from "lucide-react";

function iconFor(type: string) {
  if (type === "started") return <PlayCircle className="h-3.5 w-3.5 text-sky-300" />;
  if (type === "finished") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (type === "assertion") return <Flag className="h-3.5 w-3.5 text-violet-300" />;
  if (type === "screenshot") return <Camera className="h-3.5 w-3.5 text-cyan-300" />;
  if (type === "error") return <AlertCircle className="h-3.5 w-3.5 text-rose-300" />;
  return <StickyNote className="h-3.5 w-3.5 text-slate-300" />;
}

function fmtDelta(ts: number, startTs: number) {
  if (!Number.isFinite(ts) || !Number.isFinite(startTs)) return "+0.0s";
  return `+${Math.max(0, (ts - startTs) / 1000).toFixed(1)}s`;
}

export default function TimelineTab({
  events,
  screenshotsById,
  selectedEventId,
  onSelectEvent,
}: {
  events: any[];
  screenshotsById: Record<string, any>;
  selectedEventId?: string;
  onSelectEvent: (event: any, index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 58;
  const viewportHeight = 312;
  const overscan = 6;
  const total = events.length;
  const startTs = total ? Number(events[0].ts || Date.now()) : Date.now();

  const { start, end, padTop, padBottom } = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const last = Math.min(total, first + visible);
    return {
      start: first,
      end: last,
      padTop: first * rowHeight,
      padBottom: Math.max(0, (total - last) * rowHeight),
    };
  }, [scrollTop, total]);

  const rows = events.slice(start, end);

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400">Events ({events.length})</div>
      <div
        ref={listRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="overflow-y-auto overflow-x-hidden rounded border border-slate-800/70"
        style={{ height: viewportHeight }}
      >
        <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
          {rows.map((ev: any, idx: number) => {
            const absolute = start + idx;
            const selected = selectedEventId === ev.id;
            const shot = ev.screenshotId ? screenshotsById[ev.screenshotId] : null;
            return (
              <button
                key={ev.id || `${absolute}-${ev.ts}`}
                type="button"
                onClick={() => onSelectEvent(ev, absolute)}
                className={`flex w-full items-center gap-2 border-b border-slate-800/60 px-2 text-left text-xs ${selected ? "bg-blue-950/30" : "hover:bg-slate-900/70"}`}
                style={{ height: rowHeight }}
              >
                <div className="shrink-0">{iconFor(ev.type)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-slate-400">{fmtDelta(Number(ev.ts || 0), startTs)}</div>
                  <div className="truncate text-slate-200">{ev.message || ev.type}</div>
                  <div className="truncate text-[10px] text-slate-500">{ev.nodeId || "run"}</div>
                </div>
                {shot?.url ? <img src={shot.url} alt="screenshot thumbnail" className="h-9 w-14 shrink-0 rounded border border-slate-700 object-cover" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
