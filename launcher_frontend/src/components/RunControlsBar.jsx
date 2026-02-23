import React from "react";
import { Square } from "lucide-react";

export default function RunControlsBar({
  tab,
  setTab,
  previewLine,
  onRefresh,
  onPreview,
  onRunSelectedFiltered,
  onToggleStopMenu,
  showStopMenu,
  onStop,
}) {
  return (
    <div className="border-b border-slate-800 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onRefresh} className="rounded border border-slate-700 px-2 py-1 text-xs">Refresh</button>
        <button type="button" onClick={onPreview} className="rounded border border-slate-700 px-2 py-1 text-xs">Preview Run Plan</button>
        <button type="button" onClick={onRunSelectedFiltered} className="rounded border border-slate-700 px-2 py-1 text-xs">Run Selected/Filtered</button>
        <div className="relative">
          <button type="button" onClick={onToggleStopMenu} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs"><Square className="h-3 w-3" />Stop</button>
          {showStopMenu ? (
            <div className="absolute left-0 top-8 z-20 w-48 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl">
              <button type="button" onClick={() => onStop("run")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Stop run</button>
              <button type="button" onClick={() => onStop("after_current")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Stop after current test</button>
              <button type="button" onClick={() => onStop("terminate_workers")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Terminate workers</button>
            </div>
          ) : null}
        </div>
        <button type="button" onClick={() => setTab("logs")} className={`rounded border px-2 py-1 text-xs ${tab === "logs" ? "border-blue-500 bg-blue-950/30 text-blue-300" : "border-slate-700"}`}>Logs</button>
        <button type="button" onClick={() => setTab("tests")} className={`rounded border px-2 py-1 text-xs ${tab === "tests" ? "border-blue-500 bg-blue-950/30 text-blue-300" : "border-slate-700"}`}>Tests</button>
      </div>
      {previewLine ? <div className="mt-1 text-xs text-slate-400">{previewLine}</div> : null}
    </div>
  );
}
