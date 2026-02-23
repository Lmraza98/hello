import React from "react";
import { Search, Compass, Route, Filter } from "lucide-react";

type Props = {
  breadcrumb: string;
  nodeCount: number;
  edgeCount: number;
  viewMode: "story" | "full";
  onViewModeChange: (mode: "story" | "full") => void;
  follow: boolean;
  onToggleFollow: () => void;
  pathHighlightMode: "off" | "path";
  onPathHighlightModeChange: (mode: "off" | "path") => void;
  highlightMode: "upstream" | "downstream" | "both" | "none";
  onHighlightMode: (mode: "upstream" | "downstream" | "both" | "none") => void;
  query: string;
  onQueryChange: (value: string) => void;
  statusDim: Record<string, boolean>;
  statusCounts: Record<string, number>;
  onToggleStatusDim: (status: string) => void;
  aggregateOptions?: Array<{ id: string; name: string; total?: number }>;
  aggregateFilterIds?: string[];
  onAggregateFilterChange?: (value: string[]) => void;
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
};

export default function GraphTopToolbar({
  breadcrumb,
  nodeCount,
  edgeCount,
  viewMode,
  onViewModeChange,
  follow,
  onToggleFollow,
  pathHighlightMode,
  onPathHighlightModeChange,
  highlightMode,
  onHighlightMode,
  query,
  onQueryChange,
  statusDim,
  statusCounts,
  onToggleStatusDim,
  aggregateOptions = [],
  aggregateFilterIds = [],
  onAggregateFilterChange,
  zoom = 1,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: Props) {
  return (
    <div className="relative mx-4 mt-2 mb-2 flex items-center justify-between gap-3 pointer-events-none">
      {/* Left side: Context & Breadcrumb */}
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300 shadow-sm ring-1 ring-slate-700/50 backdrop-blur-md">
        <div className="max-w-[200px] truncate font-medium text-slate-200" title={breadcrumb}>{breadcrumb}</div>
        <div className="h-3 w-[1px] bg-slate-700" />
        <div className="text-slate-500">{nodeCount} nodes</div>
        <div className="h-3 w-[1px] bg-slate-700" />
        <div className="flex items-center gap-1.5 rounded-full bg-slate-950/50 px-2.5 py-1 ring-1 ring-slate-800/60">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input
            id="graph-search-input"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search..."
            className="w-24 bg-transparent text-slate-200 outline-none placeholder:text-slate-500 focus:w-40 transition-all"
          />
        </div>
        {aggregateOptions.length > 0 ? (
          <>
            <div className="h-3 w-[1px] bg-slate-700" />
            <label className="flex items-center gap-1.5 text-slate-400">
              <span>Aggregate</span>
              <select
                value=""
                onChange={(e) => {
                  const value = String(e.target.value || "");
                  if (!value) return;
                  if (!aggregateFilterIds.includes(value)) onAggregateFilterChange?.([...aggregateFilterIds, value]);
                }}
                className="rounded bg-slate-950/80 px-1.5 py-0.5 text-[11px] text-slate-200 ring-1 ring-slate-700/70 outline-none"
                title="Filter aggregate cards"
              >
                <option value="">Add...</option>
                {aggregateOptions.filter((row) => !aggregateFilterIds.includes(row.id)).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}{typeof row.total === "number" ? ` (${row.total})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {aggregateFilterIds.map((id) => {
              const row = aggregateOptions.find((r) => r.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-700/80 px-2 py-0.5 text-[10px] text-slate-100">
                  <span className="max-w-[120px] truncate">{row?.name || id}</span>
                  <button
                    type="button"
                    onClick={() => onAggregateFilterChange?.(aggregateFilterIds.filter((v) => v !== id))}
                    className="rounded-full p-0.5 hover:bg-slate-600/80"
                    title="Remove aggregate filter"
                  >
                    x
                  </button>
                </span>
              );
            })}
            {aggregateFilterIds.length ? (
              <button
                type="button"
                onClick={() => onAggregateFilterChange?.([])}
                className="rounded-full border border-slate-700/70 bg-slate-950/70 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white"
                title="Clear aggregate filters"
              >
                Clear
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Center: Main Controls */}
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/80 px-2 py-1.5 text-[11px] text-slate-300 shadow-sm ring-1 ring-slate-700/50 backdrop-blur-md">
        {/* View Mode */}
        <div className="flex items-center rounded-full bg-slate-950/50 p-0.5 ring-1 ring-slate-800/60">
          {(["story", "full"] as const).map((mode) => (
            <button key={mode} type="button" className={`rounded-full px-2.5 py-1 transition-all ${viewMode === mode ? "bg-blue-600/20 text-blue-300 shadow-sm ring-1 ring-blue-500/30" : "text-slate-400 hover:text-slate-200"}`} onClick={() => onViewModeChange(mode)}>
              {mode === "story" ? "Story" : "Full"}
            </button>
          ))}
        </div>

        {/* Follow */}
        <button type="button" className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${follow ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30" : "bg-slate-950/50 text-slate-400 ring-1 ring-slate-800/60 hover:text-slate-200"}`} onClick={onToggleFollow}>
          <Compass className="h-3.5 w-3.5" />
          Follow
        </button>

        <div className="h-3 w-[1px] bg-slate-700" />

        {/* Zoom */}
        <div className="flex items-center rounded-full bg-slate-950/50 p-0.5 ring-1 ring-slate-800/60">
          <button type="button" onClick={onZoomOut} className="rounded-full px-2 py-1 text-slate-300 hover:bg-slate-800" title="Zoom out">-</button>
          <button type="button" onClick={onZoomReset} className="rounded-full px-2 py-1 text-slate-300 hover:bg-slate-800" title="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={onZoomIn} className="rounded-full px-2 py-1 text-slate-300 hover:bg-slate-800" title="Zoom in">+</button>
        </div>

        <div className="h-3 w-[1px] bg-slate-700" />

        {/* Path Mode */}
        <button type="button" onClick={() => onPathHighlightModeChange(pathHighlightMode === "path" ? "off" : "path")} className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-all ${pathHighlightMode === "path" ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30" : "bg-slate-950/50 text-slate-400 ring-1 ring-slate-800/60 hover:text-slate-200"}`}>
          <Route className="h-3.5 w-3.5" />
          Path
        </button>

        {/* Highlight Neighbors */}
        <div className="flex items-center rounded-full bg-slate-950/50 p-0.5 ring-1 ring-slate-800/60">
          {(["none", "upstream", "downstream", "both"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => onHighlightMode(mode)} className={`rounded-full px-2 py-1 transition-all ${highlightMode === mode ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/30" : "text-slate-400 hover:text-slate-200"}`} title={`Neighbors: ${mode}`}>
              {mode === "none" ? "None" : mode === "upstream" ? "Up" : mode === "downstream" ? "Down" : "Both"}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Search & Filters */}
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/80 px-2 py-1.5 text-[11px] text-slate-300 shadow-sm ring-1 ring-slate-700/50 backdrop-blur-md">
        <div className="flex items-center gap-1 pr-1">
          <Filter className="h-3.5 w-3.5 mr-1 text-slate-400" />
          {(["passed", "failed", "running", "blocked", "not_run"] as const).map((status) => {
            if (!statusCounts[status]) return null;
            return (
              <button key={status} type="button" onClick={() => onToggleStatusDim(status)} className={`flex items-center gap-1.5 rounded-full px-2 py-1 transition-all ${statusDim[status] ? "opacity-30 grayscale" : "hover:bg-slate-800"}`} title={`Toggle ${status}`}>
                <div className={`h-2 w-2 rounded-full ${status === 'passed' ? 'bg-emerald-500' : status === 'failed' ? 'bg-rose-500' : status === 'running' ? 'bg-sky-500 animate-pulse' : status === 'blocked' ? 'bg-slate-400' : 'bg-slate-600'}`} />
                <span>{statusCounts[status]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
