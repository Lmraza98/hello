import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import ArtifactsSection from "../../../components/ArtifactsSection";
import { Z_GRAPH_UI, Z_PANE } from "../../../lib/zIndex";

export default function RunHistorySection({
  collapsed,
  setCollapsed,
  heightPx,
  onStartResize,
  runs,
  showArtifactsPopoverFor,
  setShowArtifactsPopoverFor,
  bridge,
  selectedRunId,
  onSelectRun,
}) {
  const runHistoryCollapsedHeight = 34;

  return !collapsed ? (
    <>
      <div role="separator" aria-orientation="horizontal" onPointerDown={onStartResize} className="group relative my-1 h-[10px] cursor-row-resize touch-none" style={{ zIndex: Z_GRAPH_UI }}>
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-slate-700 group-hover:bg-blue-400" />
      </div>
      <div className="relative min-h-0 overflow-hidden" style={{ height: `${heightPx}px`, zIndex: Z_PANE }}>
        <ArtifactsSection
          runs={runs}
          showArtifactsPopoverFor={showArtifactsPopoverFor}
          setShowArtifactsPopoverFor={setShowArtifactsPopoverFor}
          bridge={bridge}
          selectedRunId={selectedRunId}
          onSelectRun={onSelectRun}
        />
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900/85 px-2 py-1 text-[10px] text-slate-200"
          style={{ zIndex: Z_GRAPH_UI }}
        >
          <ChevronDown className="h-3 w-3" />
          Minimize
        </button>
      </div>
    </>
  ) : (
    <div className="relative shrink-0 overflow-hidden rounded border border-slate-800/80 bg-slate-950/95" style={{ height: `${runHistoryCollapsedHeight}px`, zIndex: Z_PANE }}>
      <div className="flex h-full items-center justify-between">
        <div className="pl-3 text-[11px] font-semibold uppercase tracking-wide text-slate-300">Run History</div>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mr-3 inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-200"
        >
          <ChevronUp className="h-3 w-3" />
          Open
        </button>
      </div>
    </div>
  );
}
