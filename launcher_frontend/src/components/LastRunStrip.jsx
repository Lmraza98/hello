import React from "react";

export default function LastRunStrip({ latestRun, statusById, onStopRun }) {
  const statusRows = Object.values(statusById || {});
  const total = statusRows.length;
  const done = statusRows.filter((s) => ["passed", "failed", "canceled", "timed_out"].includes(s.status)).length;
  const running = statusRows.filter((s) => s.status === "running").length;
  const queued = statusRows.filter((s) => s.status === "queued").length;
  const active = running + queued > 0;
  const percent = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;

  if (active) {
    const current = Object.entries(statusById || {}).find(([, val]) => val?.status === "running")?.[0] || "queued";
    return (
      <div className="mb-2 rounded-md border border-cyan-700/40 bg-cyan-950/20 px-2 py-1.5 text-xs text-cyan-100">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate">Run in progress: {done}/{total} complete, running {running}, queued {queued}, current {current}</div>
          <button type="button" onClick={onStopRun} className="rounded-md border border-rose-500/60 px-2 py-0.5 text-rose-200">Stop</button>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-cyan-400" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  if (!latestRun) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-slate-900/40 px-2 py-1 text-xs text-slate-300">
      <span>Last run: {latestRun.status}</span>
      <span className="truncate">id {latestRun.run_id}</span>
    </div>
  );
}
