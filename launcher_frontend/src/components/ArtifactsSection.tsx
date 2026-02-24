import React, { useMemo, useState } from "react";
import { MoreHorizontal, FolderOpen, ExternalLink, Play } from "lucide-react";
import { Z_PANE, Z_GRAPH_UI } from "../lib/zIndex";

export default function ArtifactsSection({
  runs,
  showArtifactsPopoverFor,
  setShowArtifactsPopoverFor,
  bridge,
  selectedRunId,
  onSelectRun,
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const filteredRuns = useMemo(() => {
    if (statusFilter === "all") return runs;
    if (statusFilter === "queued") return runs.filter((r) => ["queued", "running", "retrying"].includes(r.status));
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);
  const visibleRuns = showAll ? filteredRuns : filteredRuns.slice(0, 5);

  function fmtTs(value) {
    if (!value) return "n/a";
    const ms = typeof value === "number" ? value * 1000 : Date.parse(value);
    if (!Number.isFinite(ms)) return String(value);
    return new Date(ms).toLocaleTimeString();
  }

  return (
    <section className="relative flex h-full flex-col min-h-0 bg-slate-950" style={{ zIndex: Z_PANE }}>
      <div className="mb-3 flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="text-[13px] font-semibold tracking-wide text-slate-200 uppercase">Run History</div>
        <div className="flex items-center gap-1.5 bg-slate-900/50 p-1 rounded-full ring-1 ring-slate-800/60">
          {["all", "failed", "queued", "passed"].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setStatusFilter(val)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${statusFilter === val ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
            >
              {val[0].toUpperCase() + val.slice(1)}
            </button>
          ))}
          {filteredRuns.length > 5 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="ml-1 rounded-full px-2.5 py-1 text-[10px] font-medium text-blue-400 hover:bg-blue-500/10 transition-colors">
              {showAll ? "View less" : "View all"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 pr-1 pb-4">
        {visibleRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-500">
            <div className="text-[13px] font-medium">No runs found</div>
            <div className="text-[11px] mt-1">Try changing the filter</div>
          </div>
        ) : null}
        {visibleRuns.map((run) => (
          <div
            key={run.run_id}
            className={`group flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition-colors ${selectedRunId === run.run_id ? "border-blue-500/40 bg-blue-900/20 shadow-sm" : "border-transparent hover:bg-slate-900/60 hover:border-slate-800/60"}`}
          >
            <button 
              type="button" 
              onClick={() => onSelectRun(selectedRunId === run.run_id ? null : run.run_id)} 
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 ring-1 ring-slate-800">
                <span className={`h-2.5 w-2.5 rounded-full ${run.status === "passed" ? "bg-emerald-500" : run.status === "failed" ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" : run.status === "running" ? "bg-cyan-500 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.6)]" : "bg-amber-500"}`} title={run.status} />
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <div className={`truncate font-medium ${selectedRunId === run.run_id ? "text-blue-100" : "text-slate-300 group-hover:text-slate-200"}`}>{run.run_id}</div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                  <span>{fmtTs(run.started_at)}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-700" />
                  <span>{typeof run.duration_sec === "number" ? `${run.duration_sec.toFixed(1)}s` : "n/a"}</span>
                </div>
              </div>
            </button>
            <div className="flex items-center gap-1.5 shrink-0">
              <button 
                type="button" 
                onClick={() => onSelectRun(selectedRunId === run.run_id ? null : run.run_id)} 
                className={`flex h-7 px-2.5 items-center gap-1.5 rounded-md border text-[10px] font-medium transition-all ${selectedRunId === run.run_id ? "border-blue-500/50 bg-blue-500/20 text-blue-200" : "border-slate-700/60 bg-slate-800/40 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-700 hover:text-slate-200"}`}
                title={selectedRunId === run.run_id ? "Stop viewing" : "Load run into graph"}
              >
                <Play className="h-3 w-3" />
                {selectedRunId === run.run_id ? "Loaded" : "Load"}
              </button>
              <button 
                type="button" 
                onClick={() => bridge.open_run_dir(run.run_id)} 
                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/60 bg-slate-800/40 text-slate-400 opacity-0 transition-all hover:bg-slate-700 hover:text-slate-200 group-hover:opacity-100"
                title="Open artifacts folder"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              <div className="relative">
                <button 
                  type="button" 
                  onClick={() => setShowArtifactsPopoverFor((v) => (v === run.run_id ? null : run.run_id))} 
                  className={`flex h-7 w-7 items-center justify-center rounded-md border transition-all ${showArtifactsPopoverFor === run.run_id ? "border-slate-500 bg-slate-700 text-slate-200" : "border-slate-700/60 bg-slate-800/40 text-slate-400 hover:bg-slate-700 hover:text-slate-200"}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {showArtifactsPopoverFor === run.run_id ? (
                  <div className="absolute right-0 top-9 w-32 rounded-lg border border-slate-700 bg-slate-800 p-1 shadow-xl" style={{ zIndex: Z_GRAPH_UI }}>
                    <div className="px-2 py-1 mb-1 border-b border-slate-700 text-[9px] font-semibold uppercase text-slate-400">Copy output</div>
                    <button type="button" onClick={() => navigator.clipboard.writeText(run.artifacts?.json || "")} className="w-full flex items-center justify-between rounded px-2 py-1.5 text-left text-[11px] text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors">
                      JSON <ExternalLink className="h-3 w-3 opacity-50" />
                    </button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(run.artifacts?.junit || "")} className="w-full flex items-center justify-between rounded px-2 py-1.5 text-left text-[11px] text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors">
                      JUnit <ExternalLink className="h-3 w-3 opacity-50" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
