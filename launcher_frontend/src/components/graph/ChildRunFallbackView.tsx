import React, { useMemo, useState } from "react";

function relTime(ts: number, start: number) {
  if (!Number.isFinite(ts) || !Number.isFinite(start)) return "+0.0s";
  return `+${Math.max(0, (ts - start) / 1000).toFixed(1)}s`;
}

export default function ChildRunFallbackView({
  childId,
  childName,
  status,
  elapsedMs,
  events,
  logs,
  runId,
  attemptId,
  waitingFirstEvent,
}: {
  childId: string;
  childName: string;
  status: string;
  elapsedMs?: number;
  events: any[];
  logs: string[];
  runId?: string;
  attemptId?: string | number;
  waitingFirstEvent?: boolean;
}) {
  const [tab, setTab] = useState<"timeline" | "logs" | "trace">("timeline");
  const baseTs = Number(events?.[0]?.ts || Date.now());
  const hasEvents = (events || []).length > 0;
  const filteredLogs = useMemo(() => (logs || []).slice(-220), [logs]);

  return (
    <div className="h-full space-y-3 rounded border border-slate-800/80 bg-slate-950/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{childName || childId}</div>
          <div className="truncate text-xs text-slate-400">{childId}</div>
          <div className="mt-1 text-[11px] text-slate-300">
            Status: <span className="text-slate-100">{String(status || "not_run").toUpperCase()}</span>
            {"  "}
            Duration: <span className="text-slate-100">{typeof elapsedMs === "number" ? `${(elapsedMs / 1000).toFixed(2)}s` : "n/a"}</span>
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-amber-500/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200">
          No DAG available - showing live events
        </div>
      </div>

      <div className="text-[11px] text-slate-500">
        runId: {runId || "n/a"} | attemptId: {String(attemptId ?? "latest")}
      </div>

      <div className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 p-0.5 text-[11px]">
        {(["timeline", "logs", "trace"] as const).map((name) => (
          <button key={name} type="button" onClick={() => setTab(name)} className={`rounded-full px-2 py-0.5 ${tab === name ? "bg-blue-900/35 text-blue-200" : "text-slate-300"}`}>
            {name}
          </button>
        ))}
      </div>

      {tab === "timeline" ? (
        <div className="h-[calc(100%-145px)] min-h-[220px] overflow-auto rounded border border-slate-800/70">
          {!hasEvents ? (
            <div className="flex h-full items-center justify-center px-3 text-xs text-slate-400">
              {waitingFirstEvent ? "Waiting for first events..." : "No timeline events yet."}
            </div>
          ) : (
            <div>
              {events.map((ev: any, idx: number) => (
                <div key={ev.id || `${idx}-${ev.ts}`} className="border-b border-slate-800/60 px-2 py-1.5 text-xs">
                  <div className="text-[10px] text-slate-500">{relTime(Number(ev.ts || 0), baseTs)}</div>
                  <div className="truncate text-slate-200">{ev.message || ev.type}</div>
                  <div className="truncate text-[10px] text-slate-500">{ev.type}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "logs" ? (
        <div className="h-[calc(100%-145px)] min-h-[220px] overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-2 font-mono text-[11px] text-slate-300">
          {filteredLogs.length ? filteredLogs.map((line, idx) => <div key={`${idx}-${line.slice(0, 24)}`}>{line}</div>) : <div className="text-slate-500">No logs for this child yet.</div>}
        </div>
      ) : null}

      {tab === "trace" ? (
        <div className="h-[calc(100%-145px)] min-h-[220px] overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-2 text-xs text-slate-300">
          Trace is not available for this child scope yet. Use the right Details panel Trace tab for run-level trace.
        </div>
      ) : null}
    </div>
  );
}

