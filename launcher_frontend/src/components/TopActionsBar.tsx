import React from "react";
import { Eye, GitBranch, ListChecks, MoreVertical, Pause, Play, RefreshCw, Square, TestTube2 } from "lucide-react";
import { Z_APP_TOPBAR, Z_PANE } from "../lib/zIndex";

const primaryBtn = "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium";
const secondaryBtn = "inline-flex h-7 items-center gap-1 rounded-md border border-slate-700/50 bg-slate-900/30 px-2 text-[11px] text-slate-300";

export default function TopActionsBar({
  loadingRun,
  tab,
  setTab,
  previewLine,
  previewBusy,
  runPrimaryLabel = "Run",
  onRunPrimary,
  onRunSelected,
  onPauseRun,
  onPreview,
  onRefresh,
  onStop,
  onToggleUtilityMenu,
  showUtilityMenu,
  onCopyLogs,
  onCopyDiagnostics,
  bridge,
  liveMode,
  onToggleLiveMode,
  anyRunActive,
  waitingFirstEvent,
  onClearState,
  onClearCache,
  activeFilterCount = 0,
  onClearFilters,
}) {
  return (
    <div
      className="sticky top-[44px] flex items-center gap-4 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-slate-950/85"
      style={{ zIndex: Z_APP_TOPBAR - 1 }}
    >
      <div className="flex items-center gap-2">
        {!anyRunActive ? (
          <>
            <button type="button" disabled={loadingRun} onClick={onRunPrimary} className={`${primaryBtn} border-blue-600 bg-blue-600 text-white disabled:opacity-50`}>
              <Play className="h-3.5 w-3.5" />
              {runPrimaryLabel}
            </button>
            <button type="button" disabled={loadingRun} onClick={onRunSelected} className={`${primaryBtn} border-blue-500/70 bg-blue-900/35 text-blue-100 disabled:opacity-50`}>
              <TestTube2 className="h-3.5 w-3.5" />
              Run Selected
            </button>
          </>
        ) : null}
        {anyRunActive ? (
          <button type="button" disabled={loadingRun} onClick={onPauseRun} className={`${primaryBtn} border-amber-600/70 bg-amber-950/30 text-amber-200 disabled:opacity-50`}>
            <Pause className="h-3.5 w-3.5" />
            Pause
          </button>
        ) : null}
        {anyRunActive ? (
          <button type="button" disabled={loadingRun} onClick={() => onStop("terminate_workers")} className={`${primaryBtn} border-rose-600/60 bg-rose-950/30 text-rose-200 disabled:opacity-50`}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : null}
      </div>

      <div className="ml-auto">
        <div className="flex items-center gap-1.5">
          <button type="button" title={previewLine ? `Preview: ${previewLine}` : "Preview Run Plan"} onClick={onPreview} disabled={previewBusy} className={`${secondaryBtn} disabled:cursor-not-allowed disabled:opacity-60`}>
            <Eye className="h-3.5 w-3.5" />
            {previewBusy ? "Previewing..." : "Preview"}
          </button>
          <button type="button" title="Logs" onClick={() => setTab("logs")} className={`${secondaryBtn} ${tab === "logs" ? "border-blue-500/50 bg-blue-950/25 text-blue-200" : ""}`}>
            <ListChecks className="h-3.5 w-3.5" />
            Logs
          </button>
          <button type="button" title="Tests" onClick={() => setTab("tests")} className={`${secondaryBtn} ${tab === "tests" ? "border-blue-500/50 bg-blue-950/25 text-blue-200" : ""}`}>
            <TestTube2 className="h-3.5 w-3.5" />
            Tests
          </button>
          <button type="button" title="Graph" onClick={() => setTab("graph")} className={`${secondaryBtn} ${tab === "graph" ? "border-blue-500/50 bg-blue-950/25 text-blue-200" : ""}`}>
            <GitBranch className="h-3.5 w-3.5" />
            Graph
          </button>
          <div className="h-4 w-[1px] bg-slate-800" />
          <button type="button" title="Refresh" onClick={onRefresh} className={secondaryBtn}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          {activeFilterCount > 0 ? (
            <button type="button" title="Clear active filters" onClick={onClearFilters} className={`${secondaryBtn} border-blue-500/40 text-blue-200 hover:bg-blue-950/35`}>
              Clear Filters ({activeFilterCount})
            </button>
          ) : null}
          <button type="button" title="Clear/Reset UI State" onClick={onClearState} className={`${secondaryBtn} border-rose-500/30 text-rose-300 hover:bg-rose-950/40`}>
            Reset State
          </button>
          <button
            type="button"
            title="Clear test step cache"
            onClick={onClearCache}
            className={`${secondaryBtn} border-amber-500/30 text-amber-200 hover:bg-amber-950/30`}
          >
            Clear Cache
          </button>
          <button
            type="button"
            title="Live updates"
            onClick={onToggleLiveMode}
            className={`${secondaryBtn} ${liveMode ? "border-emerald-500/50 bg-emerald-950/25 text-emerald-200" : ""}`}
          >
            LIVE {liveMode ? "ON" : "OFF"}
          </button>
          {anyRunActive && waitingFirstEvent ? <span className="text-[11px] text-amber-300">Waiting for first event...</span> : null}
          <div className="relative">
            <button type="button" onClick={onToggleUtilityMenu} className="inline-flex h-7 items-center rounded-md border border-slate-700/50 px-2"><MoreVertical className="h-4 w-4 text-slate-300" /></button>
            {showUtilityMenu ? (
              <div className="absolute right-0 top-9 w-44 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl" style={{ zIndex: Z_PANE }}>
                <button type="button" onClick={() => bridge.open_app()} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Open App</button>
                <button type="button" onClick={onCopyLogs} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Copy Logs</button>
                <button type="button" onClick={onCopyDiagnostics} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Copy Diagnostics</button>
                <button type="button" onClick={() => bridge.shutdown()} className="w-full rounded px-2 py-1 text-left text-xs text-rose-300 hover:bg-slate-800">Stop Launcher</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
