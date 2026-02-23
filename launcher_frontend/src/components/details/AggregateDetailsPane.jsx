import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function AggregateDetailsPane({
  effectiveStatus,
  graphNode,
  statusRow,
  selectedCase,
  testMeta,
  activeRunId,
  attemptId,
  evidence,
  showMoreMeta,
  setShowMoreMeta,
  displayNodeId,
  fmtDuration,
  fmtTs,
  aggregateSummary,
  aggregateChildren,
  graphCompactInspector,
  childSearch,
  setChildSearch,
  childFilter,
  setChildFilter,
  filteredChildren,
  childSort,
  setChildSort,
  virtualViewportH,
  setChildScrollTop,
  virtualRowH,
  virtualStart,
  virtualItems,
  currentChildId,
  graphContext,
  activeChildId,
  dependencySummary,
}) {
  const passed = Number(aggregateSummary?.passed || 0);
  const failed = Number(aggregateSummary?.failed || 0);
  const running = Number(aggregateSummary?.running || 0);
  const notRun = Number(aggregateSummary?.not_run || 0);
  const total = Number(aggregateSummary?.total || aggregateChildren.length || 0);
  const progressPct = Math.max(0, Math.min(100, Number(aggregateSummary?.progressPct || 0)));
  const hasRunData = Boolean(activeRunId || statusRow?.started_at || statusRow?.finished_at || statusRow?.lastRun || passed || failed || running);
  const segPassed = total > 0 ? (passed / total) * 100 : 0;
  const segFailed = total > 0 ? (failed / total) * 100 : 0;
  const segRunning = total > 0 ? (running / total) * 100 : 0;
  const segNotRun = Math.max(0, 100 - segPassed - segFailed - segRunning);
  const [showChildrenList, setShowChildrenList] = React.useState(true);

  return (
    <div className="mt-2.5 space-y-2 text-xs">
      <div className="rounded border border-slate-700/70 bg-slate-900/35 px-2 py-1.5">
        <div className="grid grid-cols-4 gap-2 text-[11px]">
          <div><span className="text-emerald-300">{passed}</span> Passed</div>
          <div><span className="text-rose-300">{failed}</span> Failed</div>
          <div><span className="text-cyan-300">{running}</span> Running</div>
          <div><span className="text-slate-200">{total}</span> Total</div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-800/80">
          <div className="h-full bg-cyan-400" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-slate-300">
          {progressPct.toFixed(0)}% {notRun > 0 ? `${notRun} tests ready to run` : "coverage complete"}
        </div>
      </div>

      {!hasRunData ? <div className="text-[11px] text-slate-300">No execution data for selected run.</div> : null}

      <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2 py-1.5">
        <div className="text-[11px] font-semibold text-slate-200">Runtime</div>
        <div>Status: <span className="text-slate-100">{effectiveStatus}</span></div>
        <div>Duration: <span className="text-slate-100">{graphNode?.durationMs ? `${(graphNode.durationMs / 1000).toFixed(2)}s` : fmtDuration(statusRow.duration)}</span></div>
        <div>Run: <span className="text-slate-100">{activeRunId || "latest"}</span></div>
        <div>Attempt: <span className="text-slate-100">{String(attemptId)}</span></div>
        {statusRow.lastRun || statusRow.updated_at || statusRow.started_at ? (
          <div>Last run: <span className="text-slate-100">{fmtTs(statusRow.lastRun || statusRow.updated_at || statusRow.started_at)}</span></div>
        ) : null}
      </div>

      <button type="button" onClick={() => setShowMoreMeta((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-slate-100">
        {showMoreMeta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Details
      </button>
      {showMoreMeta ? (
        <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2 py-1.5 text-slate-300">
          <div className="truncate">File: <span className="text-slate-100" title={graphNode?.filePath || selectedCase?.file_path || ""}>{graphNode?.filePath || selectedCase?.file_path || "-"}</span></div>
          <div>Suite: <span className="text-slate-100">{graphNode?.suiteId || testMeta?.suite_name || testMeta?.suite_id || "-"}</span></div>
          <div>Retries: <span className="text-slate-100">{testMeta?.retries ?? "-"}</span></div>
          <div>Timeout: <span className="text-slate-100">{testMeta?.timeout_sec ?? "-"}</span></div>
          <div>Tags: <span className="text-slate-100">{(testMeta?.tags || []).join(", ") || "-"}</span></div>
          <div>Enabled: <span className="text-slate-100">{String(testMeta?.enabled ?? "-")}</span></div>
          <div>Selection node ID: <span className="break-all text-slate-100">{displayNodeId || "n/a"}</span></div>
        </div>
      ) : null}

      <div className="mt-1.5 rounded border border-slate-800/70 p-1.5">
        <button type="button" onClick={() => setShowChildrenList((v) => !v)} className="mb-1 flex w-full items-center justify-between gap-2 text-left">
          <div className="text-[11px] font-semibold text-slate-200">Children ({aggregateSummary.total})</div>
          <div className="text-[10px] text-slate-400">
            Passed {passed} | Failed {failed} | Running {running} | Not Run {notRun}
          </div>
        </button>
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded bg-slate-800/70">
          <div className="flex h-full w-full">
            <div className="h-full bg-emerald-400" style={{ width: `${segPassed}%` }} />
            <div className="h-full bg-rose-400" style={{ width: `${segFailed}%` }} />
            <div className="h-full bg-cyan-400" style={{ width: `${segRunning}%` }} />
            <div className="h-full bg-slate-600" style={{ width: `${segNotRun}%` }} />
          </div>
        </div>
        {aggregateSummary.running > 0 ? (
          <div className="mb-1 truncate text-[10px] text-cyan-200">
            {aggregateSummary.running > 1
              ? `Running ${aggregateSummary.running}: ${(aggregateSummary.activeChildIds || [])
                  .map((id) => aggregateChildren.find((c) => c.id === id)?.name || id)
                  .slice(0, 2)
                  .join(", ")}${(aggregateSummary.activeChildIds || []).length > 2 ? ` +${(aggregateSummary.activeChildIds || []).length - 2} more` : ""}`
              : `Now running: ${aggregateSummary.latestRunningChildName || "child"}`}
          </div>
        ) : null}
        {graphCompactInspector ? (
          <div className="mt-1 text-[10px] text-slate-500">
            Graph mode keeps the inspector compact. Use Overview/Test view for the full child list.
          </div>
        ) : showChildrenList ? (
          <>
            <div className="mb-2 grid grid-cols-3 gap-1">
              <input value={childSearch} onChange={(e) => setChildSearch(e.target.value)} placeholder="Search children" className="col-span-2 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-200 outline-none" />
              <select value={childFilter} onChange={(e) => setChildFilter(e.target.value)} className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-200 outline-none">
                <option value="all">All</option>
                <option value="failed">Failed</option>
                <option value="running">Running</option>
                <option value="not_run">Not run</option>
                <option value="passed">Passed</option>
              </select>
            </div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[10px] text-slate-500">{filteredChildren.length} shown</div>
              <select value={childSort} onChange={(e) => setChildSort(e.target.value)} className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10px] text-slate-200 outline-none">
                <option value="status_name">Sort: status</option>
                <option value="name">Sort: name</option>
                <option value="duration_desc">Sort: duration</option>
              </select>
            </div>
            <div
              className="overflow-y-auto overflow-x-hidden rounded border border-slate-800/70 bg-slate-900/20"
              style={{ height: `${virtualViewportH}px` }}
              onScroll={(e) => setChildScrollTop(e.currentTarget.scrollTop)}
            >
              <div style={{ height: `${filteredChildren.length * virtualRowH}px`, position: "relative" }}>
                {virtualItems.map((child, idx) => {
                  const rowIdx = virtualStart + idx;
                  return (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => {
                        if (graphContext?.onSelectChild) graphContext.onSelectChild(child.id);
                      }}
                      className={`absolute left-0 right-0 flex items-center justify-between gap-2 border-b border-slate-800/60 px-2 py-1 text-left hover:bg-slate-800/50 ${currentChildId === child.id ? "bg-cyan-950/25 ring-1 ring-cyan-500/50" : ""}`}
                      style={{ top: `${rowIdx * virtualRowH}px`, height: `${virtualRowH}px` }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[11px] text-slate-200">{child.name}</div>
                        <div className="truncate text-[10px] text-slate-500">{child.filePath}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {activeChildId === child.id ? <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> : null}
                        <div className="rounded border border-slate-700/60 px-1 py-0.5 text-[10px] text-slate-400">{child.status}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="text-[10px] text-slate-500">Click Children row to show filtered list.</div>
        )}
      </div>

      {dependencySummary ? (
        <div className="rounded border border-slate-800/70 bg-slate-900/20 px-2 py-1.5 text-[11px]">
          <div className="font-semibold text-slate-200">Dependency Drift</div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-slate-300">
            <div>Nodes analyzed: <span className="text-slate-100">{Number(dependencySummary.nodeCount || 0)}</span></div>
            <div>Missing planned edges: <span className="text-slate-100">{Number(dependencySummary.missingPlannedEdges?.length || 0)}</span></div>
            <div>Unexpected observed edges: <span className="text-slate-100">{Number(dependencySummary.unexpectedObservedEdges?.length || 0)}</span></div>
            <div>Started before ready: <span className="text-slate-100">{Number(dependencySummary.startedBeforeReady?.length || 0)}</span></div>
          </div>
          {(dependencySummary.startedBeforeReady || []).length > 0 ? (
            <div className="mt-1 text-[10px] text-amber-300">
              Sample: {String(dependencySummary.startedBeforeReady[0]?.id || "n/a")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
