import React, { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import AggregateDetailsPane from "./details/AggregateDetailsPane";
import NodeDetailsPane from "./details/NodeDetailsPane";
import TimelineTab from "./details/TimelineTab";
import ScreenshotViewer from "./details/ScreenshotViewer";
import { Z_PANE } from "../lib/zIndex";

function fmtTs(value) {
  if (!value) return "n/a";
  const ms = typeof value === "number" ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function fmtDuration(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}s`;
}

function idVariants(id) {
  const raw = String(id || "").trim();
  if (!raw) return [];
  const out = new Set([raw]);
  if (raw.includes("::")) {
    const parts = raw.split("::");
    const withoutRoot = parts.slice(1).join("::").trim();
    if (withoutRoot) out.add(withoutRoot);
  }
  return Array.from(out);
}

function runResultForNode(run, ids) {
  if (!run || !Array.isArray(run.tests)) return null;
  const wanted = new Set((ids || []).flatMap((id) => idVariants(id)));
  for (const row of run.tests) {
    const rowId = String(row?.id || "").trim();
    if (!rowId) continue;
    const rowIds = idVariants(rowId);
    if (rowIds.some((id) => wanted.has(id))) return row;
  }
  return null;
}

function pickAttempt(runResult, statusRow) {
  const val =
    runResult?.attempt ??
    runResult?.attempt_id ??
    runResult?.attemptId ??
    statusRow?.attempt ??
    statusRow?.attempt_id ??
    statusRow?.attemptId;
  return val == null || val === "" ? "latest" : val;
}

function pickDurationText(runResult, statusRow, graphNode) {
  const seconds =
    runResult?.duration_sec ??
    runResult?.durationSec ??
    (typeof runResult?.duration_ms === "number" ? runResult.duration_ms / 1000 : undefined) ??
    (typeof runResult?.durationMs === "number" ? runResult.durationMs / 1000 : undefined) ??
    (typeof runResult?.duration === "number" ? runResult.duration : undefined) ??
    (typeof statusRow?.duration === "number" ? statusRow.duration : undefined) ??
    (typeof graphNode?.durationMs === "number" ? graphNode.durationMs / 1000 : undefined);
  return fmtDuration(seconds);
}

function runLogsForRun(rawLogs, runId) {
  const lines = String(rawLogs || "").split("\n");
  if (!runId) return lines;
  const startNeedle = `[tests] run started: ${runId}`;
  const start = lines.findIndex((line) => line.includes(startNeedle));
  if (start < 0) return lines;
  const nextStart = lines.findIndex((line, idx) => idx > start && line.includes("[tests] run started: "));
  return nextStart > start ? lines.slice(start, nextStart) : lines.slice(start);
}

function hasScreenshotArtifact(row) {
  if (!row || typeof row !== "object") return false;
  const outputs = row?.outputs && typeof row.outputs === "object" ? row.outputs : {};
  const screenshot = outputs?.screenshot;
  if (typeof screenshot === "string" && screenshot.trim()) return true;
  if (screenshot && typeof screenshot === "object") {
    const urlRaw = String(screenshot.url || screenshot.path || "").trim();
    const b64 = String(screenshot.base64 || screenshot.screenshot_base64 || "").trim();
    if (urlRaw || b64) return true;
  }
  const b64 = String(outputs?.screenshot_base64 || "").trim();
  if (b64) return true;
  const artifacts = Array.isArray(row?.artifacts) ? row.artifacts : [];
  return artifacts.some((art) => {
    const p = String(art?.path || "").trim();
    const t = String(art?.type || "").toLowerCase();
    if (!p) return false;
    const isImageType = t.includes("image") || t.includes("screenshot") || t === "png" || t === "jpg" || t === "jpeg";
    const isImagePath = /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(p);
    return isImageType || isImagePath;
  });
}

function workflowPrefix(id) {
  const raw = String(id || "").trim();
  if (!raw) return "";
  const marker = "::workflow.";
  const idx = raw.indexOf(marker);
  if (idx < 0) return "";
  const tail = raw.slice(idx + marker.length);
  const lastDot = tail.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return `${raw.slice(0, idx + marker.length)}${tail.slice(0, lastDot)}`;
}

function workflowStepName(id) {
  const raw = String(id || "").trim();
  if (!raw) return "";
  const marker = "::workflow.";
  const idx = raw.indexOf(marker);
  if (idx < 0) return "";
  const tail = raw.slice(idx + marker.length);
  const lastDot = tail.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return tail.slice(lastDot + 1);
}

function shouldUseWorkflowScreenshotFallback(displayNodeId) {
  const step = workflowStepName(displayNodeId);
  return step === "open_or_reuse_tab" || step === "navigate_and_collect" || step === "capture_observation";
}

export default function DetailsPane({
  drawerOpen,
  selectedCase,
  setDrawerOpen,
  bridge,
  tests = [],
  statusById = {},
  runs = [],
  logs = "",
  selectedRunId = null,
  onSelectRun = () => {},
  graphContext = null,
  runInspector = null,
}) {
  const [tab, setTab] = useState("summary");
  const [traceTab, setTraceTab] = useState("overview");
  const [showMoreMeta, setShowMoreMeta] = useState(false);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [trace, setTrace] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState("");
  const [traceFetchState, setTraceFetchState] = useState("idle");
  const [childSearch, setChildSearch] = useState("");
  const [childFilter, setChildFilter] = useState("all");
  const [childSort, setChildSort] = useState("status_name");
  const [childScrollTop, setChildScrollTop] = useState(0);

  const graphActive = Boolean(graphContext?.active);
  const graphCompactInspector = Boolean(graphContext?.compactInspector);
  const graphNode = graphContext?.selectedNode || null;
  const timelineEventsRaw = graphContext?.events || [];
  const screenshotById = graphContext?.screenshotsById || {};
  const selectedTimelineEvent = graphContext?.selectedEvent || null;

  const testId = selectedCase?.testId || "";
  const caseNodeId = selectedCase?.id || "";
  const graphNodeId = graphNode?.id || "";
  const displayNodeId = caseNodeId || testId || graphNodeId || "";
  const candidateIds = useMemo(() => {
    const ids = [graphNodeId, caseNodeId, testId, selectedCase?.nodeid].filter(Boolean);
    return Array.from(new Set(ids));
  }, [graphNodeId, caseNodeId, testId, selectedCase?.nodeid]);
  const testMeta = useMemo(() => tests.find((t) => t.id === testId) || null, [tests, testId]);
  const statusRow = statusById[displayNodeId] || statusById[testId] || {};

  const relatedRuns = useMemo(() => {
    if (!candidateIds.length) return [];
    return runs.filter((run) => {
      if (Array.isArray(run.selected_test_ids) && candidateIds.some((id) => run.selected_test_ids.includes(id))) return true;
      if (Array.isArray(run.selected_step_ids) && candidateIds.some((id) => run.selected_step_ids.includes(id))) return true;
      if (Array.isArray(run.tests) && run.tests.some((row) => candidateIds.includes(row.id))) return true;
      return false;
    });
  }, [runs, candidateIds]);

  const selectedRun = useMemo(() => runs.find((r) => r.run_id === selectedRunId) || null, [runs, selectedRunId]);
  const latestRun = relatedRuns[0] || null;
  const activeRun = selectedRun || latestRun || null;
  const activeRunId = activeRun?.run_id || "";
  const dependencyAnalysis = activeRun?.dependency_analysis && typeof activeRun?.dependency_analysis === "object" ? activeRun.dependency_analysis : null;
  const dependencyNodes = Array.isArray(dependencyAnalysis?.nodes) ? dependencyAnalysis.nodes : [];
  const missingPlannedEdges = Array.isArray(dependencyAnalysis?.drift?.missing_planned_edges) ? dependencyAnalysis.drift.missing_planned_edges : [];
  const unexpectedObservedEdges = Array.isArray(dependencyAnalysis?.drift?.unexpected_observed_edges) ? dependencyAnalysis.drift.unexpected_observed_edges : [];
  const nodesStartedBeforeReady = Array.isArray(dependencyAnalysis?.drift?.nodes_started_before_planned_ready)
    ? dependencyAnalysis.drift.nodes_started_before_planned_ready
    : [];
  const runResult = useMemo(() => runResultForNode(activeRun, candidateIds), [activeRun, candidateIds]);
  const attemptId = pickAttempt(runResult, statusRow);
  const durationText = pickDurationText(runResult, statusRow, graphNode);
  const effectiveStatus = runResult?.status || statusRow?.status || graphNode?.status || "idle";
  const fallbackRunResult = useMemo(() => {
    if (!activeRun || !displayNodeId) return null;
    if (hasScreenshotArtifact(runResult)) return null;
    if (!shouldUseWorkflowScreenshotFallback(displayNodeId)) return null;
    const prefix = workflowPrefix(displayNodeId);
    if (!prefix) return null;
    const rows = Array.isArray(activeRun?.tests) ? activeRun.tests : [];
    for (const row of rows) {
      const rowId = String(row?.id || "").trim();
      if (!rowId || rowId === displayNodeId) continue;
      if (!rowId.startsWith(`${prefix}.`)) continue;
      if (hasScreenshotArtifact(row)) return row;
    }
    return null;
  }, [activeRun, displayNodeId, runResult]);
  const evidence = runResult?.evidence || null;
  const aggregateChildren = Array.isArray(graphNode?.aggregateChildren) ? graphNode.aggregateChildren : [];
  const aggregateSummary = graphNode?.aggregateSummary || null;
  const currentChildId = String(graphContext?.currentChildId || "");
  const activeChildId = String(graphContext?.activeChildId || "");
  const virtualRowH = 30;
  const virtualViewportH = 220;
  const filteredChildren = useMemo(() => {
    let rows = aggregateChildren;
    const q = childSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => `${row.name || ""} ${row.filePath || ""} ${row.id || ""}`.toLowerCase().includes(q));
    }
    if (childFilter !== "all") rows = rows.filter((row) => String(row.status || "not_run") === childFilter);
    const statusRank = { failed: 0, running: 1, not_run: 2, blocked: 2, passed: 3, skipped: 4 };
    const sorted = [...rows];
    if (childSort === "name") sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    else if (childSort === "duration_desc") sorted.sort((a, b) => Number(b.durationMs || 0) - Number(a.durationMs || 0));
    else {
      sorted.sort((a, b) => {
        const ra = statusRank[String(a.status || "not_run")] ?? 99;
        const rb = statusRank[String(b.status || "not_run")] ?? 99;
        if (ra !== rb) return ra - rb;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    }
    return sorted;
  }, [aggregateChildren, childSearch, childFilter, childSort]);
  const virtualMaxStart = Math.max(0, Math.floor(filteredChildren.length - virtualViewportH / virtualRowH));
  const virtualStart = Math.max(0, Math.min(virtualMaxStart, Math.floor(childScrollTop / virtualRowH)));
  const virtualVisibleCount = Math.ceil(virtualViewportH / virtualRowH) + 6;
  const virtualEnd = Math.min(filteredChildren.length, virtualStart + virtualVisibleCount);
  const virtualItems = filteredChildren.slice(virtualStart, virtualEnd);

  const timelineEvents = useMemo(() => {
    if (!graphActive) return [];
    if (!displayNodeId) return timelineEventsRaw;
    return timelineEventsRaw.filter((event) => !event?.nodeId || event.nodeId === displayNodeId);
  }, [graphActive, timelineEventsRaw, displayNodeId]);
  const nodeObservedInEvents = useMemo(() => {
    if (!graphActive || !displayNodeId) return true;
    const id = String(displayNodeId || "");
    const raw = id.includes("::") ? id.split("::").slice(1).join("::") : id;
    return (timelineEventsRaw || []).some((event) => {
      const nodeId = String(event?.nodeId || "");
      if (!nodeId) return false;
      return nodeId === id || nodeId.startsWith(`${id}::`) || nodeId === raw || nodeId.startsWith(`${raw}::`);
    });
  }, [graphActive, displayNodeId, timelineEventsRaw]);

  const filteredLogs = useMemo(() => {
    if (!logs || !candidateIds.length) return [];
    const scoped = runLogsForRun(logs, activeRunId);
    return scoped
      .filter((line) => candidateIds.some((id) => line.includes(`[tests:${id}]`) || line.includes(`[tests] ${id}`) || line.includes(id)))
      .slice(-200);
  }, [logs, candidateIds, activeRunId]);

  const tabCounts = useMemo(() => {
    return {
      logs: filteredLogs.length,
      trace: activeRunId ? 1 : 0,
      timeline: timelineEvents.length,
    };
  }, [filteredLogs.length, activeRunId, timelineEvents.length]);

  const traceRunId = activeRunId;
  useEffect(() => {
    let alive = true;
    async function loadTrace() {
      if (!bridge?.get_run_trace || !traceRunId) {
        if (!alive) return;
        setTrace(null);
        setTraceError("");
        setTraceFetchState("idle");
        return;
      }
      setTraceLoading(true);
      setTraceError("");
      setTraceFetchState("loading");
      try {
        const payload = await bridge.get_run_trace(traceRunId);
        if (!alive) return;
        const parsed = payload && typeof payload === "object" ? payload : null;
        setTrace(parsed);
        setTraceFetchState(parsed ? "ok" : "empty");
      } catch (error) {
        if (!alive) return;
        setTrace(null);
        setTraceError(error?.message ? String(error.message) : "Unable to load trace");
        setTraceFetchState("error");
      } finally {
        if (alive) setTraceLoading(false);
      }
    }
    void loadTrace();
    return () => {
      alive = false;
    };
  }, [bridge, traceRunId]);

  useEffect(() => {
    if (tab === "logs" && tabCounts.logs === 0) setTab("summary");
    if (tab === "trace" && tabCounts.trace === 0) setTab("summary");
    if (tab === "timeline" && tabCounts.timeline === 0) setTab("summary");
  }, [tab, tabCounts]);

  if (!drawerOpen) {
    return (
      <aside className="flex min-h-0 items-center justify-center overflow-y-auto overflow-x-hidden border-l border-slate-800/70 pl-3 text-sm text-slate-200">
        {graphActive ? (
          <div className="w-[92%] rounded-md border border-slate-800 bg-slate-900/70 px-3 py-3">
            <div className="text-sm font-semibold text-slate-100">Graph focus</div>
            <div className="mt-1 text-xs text-slate-300">Click a node to view details.</div>
            <div className="text-xs text-slate-500">Shift-click to multi-select.</div>
            <div className="text-xs text-slate-500">Press F to fit graph.</div>
          </div>
        ) : (
          <div className="rounded-md bg-slate-900/70 px-3 py-2">Select a case to open details.</div>
        )}
      </aside>
    );
  }

  const runActive = ["running", "queued", "retrying"].includes(String(activeRun?.status || "").toLowerCase());
  const logsEmptyText = runActive
    ? `No logs yet for ${displayNodeId || "this node"} in ${traceRunId || "active run"}.`
    : traceRunId
      ? `No logs captured for ${displayNodeId || "this node"} in run ${traceRunId}.`
      : "No run selected for log lookup.";

  const runSelectorValue = activeRunId || "latest";
  const isAggregateContext = Boolean(aggregateSummary);
  const nodeDependencyAnalysis = useMemo(() => {
    if (!dependencyNodes.length || !candidateIds.length) return null;
    const wanted = new Set(candidateIds.flatMap((id) => idVariants(id)));
    for (const row of dependencyNodes) {
      const rowId = String(row?.id || "").trim();
      if (!rowId) continue;
      const rowIds = idVariants(rowId);
      if (rowIds.some((id) => wanted.has(id))) return row;
    }
    return null;
  }, [dependencyNodes, candidateIds]);
  const aggregateDependencySummary = useMemo(() => {
    const aggregateId = String(graphNode?.id || "");
    if (!aggregateId || !dependencyAnalysis) return null;
    const prefix = `${aggregateId}::`;
    const inScopeNodeId = (id) => {
      const sid = String(id || "");
      return sid === aggregateId || sid.startsWith(prefix);
    };
    const inScopeEdge = (row) => inScopeNodeId(row?.to) || inScopeNodeId(row?.from);
    const nodeRows = dependencyNodes.filter((row) => inScopeNodeId(row?.id));
    const missing = missingPlannedEdges.filter(inScopeEdge);
    const unexpected = unexpectedObservedEdges.filter(inScopeEdge);
    const early = nodesStartedBeforeReady.filter((row) => inScopeNodeId(row?.id));
    if (!nodeRows.length && !missing.length && !unexpected.length && !early.length) return null;
    return {
      nodeCount: nodeRows.length,
      missingPlannedEdges: missing,
      unexpectedObservedEdges: unexpected,
      startedBeforeReady: early,
    };
  }, [graphNode?.id, dependencyAnalysis, dependencyNodes, missingPlannedEdges, unexpectedObservedEdges, nodesStartedBeforeReady]);
  const tabOrder = isAggregateContext
    ? ["summary", "runs", "logs", "trace", "timeline"]
    : ["summary", "timeline", "logs", "trace", "runs"];
  const tabLabelById = {
    summary: "Summary",
    runs: "Runs",
    logs: `Logs ${tabCounts.logs > 0 ? `(${tabCounts.logs})` : ""}`.trim(),
    trace: "Trace",
    timeline: `Timeline ${tabCounts.timeline > 0 ? `(${tabCounts.timeline})` : ""}`.trim(),
  };

  return (
    <aside className="h-full min-h-0 overflow-y-auto overflow-x-hidden border-l border-slate-800/70 px-2">
      <div className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/95 pb-1.5">
        <div className="flex items-start justify-between gap-1.5 pt-0.5">
          <div className="min-w-0">
            <div className="break-words text-[13px] font-semibold leading-tight text-slate-100">{selectedCase?.name || "No case selected"}</div>
            <div className="mt-0.5 truncate text-[11px] text-slate-400" title={selectedCase?.nodeid || displayNodeId || ""}>
              {selectedCase?.nodeid || displayNodeId || ""}
            </div>
            {graphActive && !nodeObservedInEvents ? (
              <div className="mt-1 rounded-sm border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-[10px] leading-tight text-amber-200">
                Not observed in run events. This node has not emitted runtime events for the selected run.
              </div>
            ) : null}
            <div className="mt-0.5 truncate text-[11px] text-slate-500" title={selectedCase?.file_path || graphNode?.filePath || ""}>
              {selectedCase?.file_path || graphNode?.filePath || ""}
            </div>
          </div>
          <button type="button" onClick={() => setDrawerOpen(false)} className="inline-flex h-7 items-center justify-center rounded-md border border-slate-700 px-2 text-xs">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-300">
          <label className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0 text-[10px] text-slate-500">Run:</span>
            <select
              value={runSelectorValue}
              onChange={(e) => onSelectRun(e.target.value === "latest" ? null : e.target.value)}
              className="h-7 w-full rounded border border-slate-700 bg-slate-900 px-1.5 text-[11px] text-slate-200 outline-none"
            >
              <option value="latest">latest</option>
              {relatedRuns.map((run) => (
                <option key={run.run_id} value={run.run_id}>
                  {run.run_id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0 text-[10px] text-slate-500">Attempt:</span>
            <input readOnly value={String(attemptId)} className="h-7 w-full rounded border border-slate-700 bg-slate-900 px-1.5 text-[11px] text-slate-200 outline-none" />
          </label>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            disabled={!selectedCase}
            onClick={() => selectedCase && bridge.run_plan([selectedCase.id], [])}
            className="h-7 rounded-md bg-blue-600 px-2.5 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rerun Test
          </button>
          {graphActive ? (
            <button
              type="button"
              disabled={!activeRunId}
              onClick={() => graphContext?.onOpenRun?.({ runId: activeRunId, nodeId: displayNodeId })}
              className="h-7 rounded-md border border-slate-700 px-2.5 text-[11px] text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open Run
            </button>
          ) : null}
          <div className="relative">
            <button
              type="button"
              disabled={!selectedCase}
              onClick={() => setShowCopyMenu((v) => !v)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-700 px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              Copy
            </button>
            {showCopyMenu ? (
              <div className="absolute left-0 top-8 w-44 rounded-md border border-slate-700 bg-slate-900 p-1" style={{ zIndex: Z_PANE }}>
                <button type="button" onClick={() => { navigator.clipboard.writeText(selectedCase?.nodeid || displayNodeId || ""); setShowCopyMenu(false); }} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Node ID</button>
                <button type="button" onClick={() => { navigator.clipboard.writeText(selectedCase?.file_path || graphNode?.filePath || ""); setShowCopyMenu(false); }} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">File Path</button>
                <button type="button" onClick={() => { navigator.clipboard.writeText(JSON.stringify({ runId: activeRunId, nodeId: displayNodeId, attemptId, traceFetchState }, null, 2)); setShowCopyMenu(false); }} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800">Diagnostics</button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-2 border-t border-slate-800/70 pt-2" />

        <div className="overflow-x-auto overflow-y-hidden">
          <div className="flex items-center gap-1 whitespace-nowrap">
          {tabOrder.map((tabId) => {
            if (tabId === "timeline" && !graphActive) return null;
            const disabled =
              (tabId === "logs" && tabCounts.logs === 0 && !runActive) ||
              (tabId === "trace" && tabCounts.trace === 0) ||
              (tabId === "timeline" && tabCounts.timeline === 0);
            return (
              <button
                key={tabId}
                type="button"
                disabled={disabled}
                onClick={() => setTab(tabId)}
                className={`h-7 shrink-0 rounded-md border px-2 text-[10px] disabled:opacity-45 ${tab === tabId ? "border-blue-500 bg-blue-950/30 text-blue-300" : "border-slate-700"}`}
              >
                {tabLabelById[tabId]}
              </button>
            );
          })}
          </div>
        </div>
      </div>

      {tab === "summary" ? (
        <>
          {aggregateSummary ? (
            <AggregateDetailsPane
              effectiveStatus={effectiveStatus}
              graphNode={graphNode}
              statusRow={statusRow}
              selectedCase={selectedCase}
              testMeta={testMeta}
              activeRunId={activeRunId}
              attemptId={attemptId}
              evidence={evidence}
              runResult={runResult}
              durationText={durationText}
              showMoreMeta={showMoreMeta}
              setShowMoreMeta={setShowMoreMeta}
              displayNodeId={displayNodeId}
              fmtDuration={fmtDuration}
              fmtTs={fmtTs}
              aggregateSummary={aggregateSummary}
              aggregateChildren={aggregateChildren}
              graphCompactInspector={graphCompactInspector}
              childSearch={childSearch}
              setChildSearch={setChildSearch}
              childFilter={childFilter}
              setChildFilter={setChildFilter}
              filteredChildren={filteredChildren}
              childSort={childSort}
              setChildSort={setChildSort}
              virtualViewportH={virtualViewportH}
              setChildScrollTop={setChildScrollTop}
              virtualRowH={virtualRowH}
              virtualStart={virtualStart}
              virtualItems={virtualItems}
              currentChildId={currentChildId}
              graphContext={graphContext}
              activeChildId={activeChildId}
              dependencySummary={aggregateDependencySummary}
            />
          ) : (
            <NodeDetailsPane
              bridge={bridge}
              effectiveStatus={effectiveStatus}
              graphNode={graphNode}
              statusRow={statusRow}
              selectedCase={selectedCase}
              testMeta={testMeta}
              activeRunId={activeRunId}
              attemptId={attemptId}
              durationText={durationText}
              runResult={runResult}
              evidence={evidence}
              showMoreMeta={showMoreMeta}
              setShowMoreMeta={setShowMoreMeta}
              displayNodeId={displayNodeId}
              fmtDuration={fmtDuration}
              fmtTs={fmtTs}
              nodeDependencyAnalysis={nodeDependencyAnalysis}
              fallbackRunResult={fallbackRunResult}
            />
          )}
          {selectedTimelineEvent?.screenshotId ? (
            <ScreenshotViewer screenshot={screenshotById[selectedTimelineEvent.screenshotId]} title="Event Screenshot" />
          ) : null}
        </>
      ) : null}

      {tab === "runs" ? (
        <div className="mt-3 space-y-2 text-xs">
          <div className="mb-1 text-slate-400">Recent Related Runs ({relatedRuns.length})</div>
          <div className="max-h-80 space-y-2 overflow-y-auto overflow-x-hidden">
            {relatedRuns.length === 0 ? <div className="text-slate-500">No related runs found.</div> : null}
            {relatedRuns.slice(0, 30).map((run) => {
              const result = runResultForNode(run, candidateIds);
              return (
                <button key={run.run_id || `${run.started_at}-${run.status}`} type="button" onClick={() => onSelectRun(run.run_id || null)} className={`w-full border-b border-slate-800/70 pb-2 text-left ${selectedRunId === run.run_id ? "bg-blue-900/20" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-medium text-slate-200">{run.run_id || "unknown"}</div>
                    <div className="text-slate-300">{run.status || "unknown"}</div>
                  </div>
                  <div className="mt-1 text-slate-400">Started: {fmtTs(run.started_at)}</div>
                  <div className="text-slate-400">Finished: {fmtTs(run.finished_at)}</div>
                  <div className="text-slate-400">Duration: {fmtDuration(run.duration_sec)}</div>
                  <div className="text-slate-400">Node status: {result?.status || "n/a"}</div>
                  <div className="break-all text-slate-500">{result?.message || ""}</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "logs" ? (
        <div className="mt-3 text-xs">
          <div className="mb-1 text-slate-400">Node Logs ({filteredLogs.length})</div>
          <div className="max-h-80 overflow-y-auto overflow-x-hidden border border-slate-800/70 p-2 font-mono text-[11px] text-slate-200">
            {filteredLogs.length ? filteredLogs.join("\n") : logsEmptyText}
          </div>
        </div>
      ) : null}

      {tab === "trace" ? (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex items-center gap-1">
            {[{ id: "overview", label: "Overview" }, { id: "plan", label: "Plan" }, { id: "evidence", label: "Evidence" }, { id: "code", label: "Code" }].map((item) => (
              <button key={item.id} type="button" onClick={() => setTraceTab(item.id)} className={`rounded-md border px-2 py-1 text-[11px] ${traceTab === item.id ? "border-blue-500 bg-blue-950/30 text-blue-300" : "border-slate-700"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="text-slate-400">Run: {traceRunId || "n/a"} | Node: {displayNodeId || "n/a"} | Attempt: {String(attemptId)}</div>
          {traceLoading ? <div className="text-slate-400">Loading trace...</div> : null}
          {traceError ? <div className="text-rose-400">{traceError}</div> : null}
          {!traceLoading && !traceError && !trace ? <div className="text-slate-500">{traceRunId ? `Trace not found for run ${traceRunId}.` : "Select a run to load trace."}</div> : null}
          {trace ? (
            <div className="max-h-80 overflow-y-auto overflow-x-hidden rounded border border-slate-800/70 p-2">
              {traceTab === "overview" ? (
                <div className="space-y-1">
                  <div>Status: <span className="text-slate-100">{trace.run?.status || "unknown"}</span></div>
                  <div>Started: <span className="text-slate-100">{fmtTs(trace.run?.timestamp || trace.run?.started_at)}</span></div>
                  <div>Finished: <span className="text-slate-100">{fmtTs(trace.run?.finished_at || trace.run?.finished_at_ts)}</span></div>
                  <div>Duration: <span className="text-slate-100">{fmtDuration(trace.run?.duration_sec)}</span></div>
                  <div>Timeline: <span className="text-slate-100">{Array.isArray(trace.timeline) ? trace.timeline.length : 0} events</span></div>
                  <div>Steps: <span className="text-slate-100">{Array.isArray(trace.steps) ? trace.steps.length : 0}</span></div>
                </div>
              ) : null}
              {traceTab === "plan" ? (
                <div className="space-y-2">
                  <div className="text-slate-300">Mode: {trace.plan?.mode || "n/a"}</div>
                  {(trace.plan?.ordered_steps || []).map((step) => (
                    <div key={`${step.order}-${step.id}`} className="rounded border border-slate-800/70 p-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-slate-100">{step.order}. {step.label || step.id}</div>
                        <div className="text-slate-400">{step.skip ? "cached skip" : step.kind || "step"}</div>
                      </div>
                      <div className="truncate text-slate-500">{step.id}</div>
                      <div className="text-slate-500">{Array.isArray(step.dependency_reasons) && step.dependency_reasons.length ? step.dependency_reasons.join(", ") : "no dependencies"}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {traceTab === "evidence" ? (
                <div className="space-y-2">
                  <div className="text-slate-300">Logs</div>
                  <div className="max-h-32 overflow-y-auto overflow-x-hidden rounded border border-slate-800/70 p-1 font-mono text-[10px]">
                    {(trace.evidence?.logs || []).slice(-120).map((row, idx) => (
                      <div key={`${row.ts || idx}-${idx}`} className="text-slate-300">{row.message || JSON.stringify(row)}</div>
                    ))}
                  </div>
                  <div className="text-slate-300">Artifacts</div>
                  <div className="space-y-1">
                    {(trace.evidence?.artifacts || []).map((row, idx) => (
                      <div key={`${row.path || idx}-${idx}`} className="truncate text-slate-400">{row.type}: {row.path}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              {traceTab === "code" ? (
                <div className="space-y-2">
                  {(trace.changes || []).length === 0 ? <div className="text-slate-500">No code changes captured for this run.</div> : null}
                  {(trace.changes || []).map((change, idx) => (
                    <div key={`${change.file_path || idx}-${idx}`} className="rounded border border-slate-800/70 p-1.5">
                      <div className="truncate text-slate-200">{change.file_path || "unknown file"}</div>
                      <pre className="mt-1 max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap font-mono text-[10px] text-slate-300">{change.diff || ""}</pre>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "timeline" && graphActive ? (
        <div className="mt-3 space-y-2 text-xs">
          <TimelineTab
            events={timelineEvents}
            screenshotsById={screenshotById}
            selectedEventId={graphContext?.selectedEventId}
            onSelectEvent={(event, index) => graphContext?.onSelectEvent?.(event, index)}
          />
          {selectedTimelineEvent?.screenshotId ? <ScreenshotViewer screenshot={screenshotById[selectedTimelineEvent.screenshotId]} title="Timeline Screenshot" /> : null}
        </div>
      ) : null}

      {import.meta.env.DEV && runInspector ? (
        <div className="mt-3 rounded border border-slate-800/70 bg-slate-900/40 p-2 text-[11px] text-slate-300">
          <div className="font-semibold text-slate-200">Run Inspector (dev)</div>
          <div className="mt-1 text-slate-400">Selected context</div>
          <div>runId: {String(runInspector?.selectedContext?.runId || "latest")}</div>
          <div>attemptId: {String(runInspector?.selectedContext?.attemptId ?? "latest")}</div>
          <div>selectedNodeId: {String(runInspector?.selectedContext?.selectedNodeId || "n/a")}</div>
          <div>scope: {String(runInspector?.selectedContext?.graphScope?.level || "n/a")} / {String(runInspector?.selectedContext?.graphScope?.aggregateId || "")} / {String(runInspector?.selectedContext?.graphScope?.childId || "")}</div>

          <div className="mt-2 text-slate-400">IDs in model</div>
          <div>aggregateId: {String(runInspector?.modelIds?.aggregateNodeId || "n/a")}</div>
          <div className="max-h-24 overflow-auto rounded border border-slate-800/60 p-1">
            {(runInspector?.modelIds?.aggregateChildren || []).map((row, idx) => (
              <div key={`${row.id || idx}-${idx}`} className="truncate">{row.id} {row.raw ? `(raw:${row.raw})` : ""}</div>
            ))}
          </div>

          <div className="mt-2 text-slate-400">Run data</div>
          <div>tests: {Number(runInspector?.runData?.testsCount || 0)}</div>
          <div className="max-h-24 overflow-auto rounded border border-slate-800/60 p-1">
            {(runInspector?.runData?.testsSample || []).map((t, idx) => (
              <div key={`${t.id || idx}-${idx}`} className="mb-1">
                <div className="truncate">{String(t.id)} [{String(t.status || "n/a")}]</div>
                {(t.children || []).map((c, cIdx) => (
                  <div key={`${c.id || cIdx}-${cIdx}`} className="truncate pl-2 text-slate-400">- {String(c.id)} [{String(c.status || "n/a")}]</div>
                ))}
              </div>
            ))}
          </div>

          <div className="mt-2 text-slate-400">Event stream summary</div>
          <div>total: {Number(runInspector?.eventSummary?.total || 0)}</div>
          <div>child events: {Number(runInspector?.eventSummary?.childEventsCount || 0)}</div>
          <div>nodeId contains '::': {Number(runInspector?.eventSummary?.withDoubleColon || 0)}</div>
          <div>nodeId == selected child: {Number(runInspector?.eventSummary?.equalsSelectedChild || 0)}</div>
          <div>nodeId == raw child: {Number(runInspector?.eventSummary?.equalsRawChild || 0)}</div>
          <div className="max-h-28 overflow-auto rounded border border-slate-800/60 p-1">
            {(runInspector?.eventSummary?.lastEvents || []).map((ev, idx) => (
              <div key={`${ev.ts || idx}-${idx}`} className="truncate">
                {String(ev.ts || "")} {String(ev.type || "")} {String(ev.nodeId || "")} {String(ev.message || "")}
              </div>
            ))}
          </div>

          <div className="mt-2 text-slate-400">Mismatch detector</div>
          <div>mismatch count: {Number(runInspector?.mismatchDetector?.mismatchCount || 0)}</div>
          <div className="max-h-20 overflow-auto rounded border border-slate-800/60 p-1">
            {(runInspector?.mismatchDetector?.samples || []).map((id, idx) => (
              <div key={`${id}-${idx}`} className="truncate">{String(id)}</div>
            ))}
          </div>
          <div className="mt-2 text-slate-400">Progress summary</div>
          <div>progress rows: {Number(runInspector?.progressSummary?.progressCount || 0)}</div>
          <div className="max-h-20 overflow-auto rounded border border-slate-800/60 p-1">
            {(runInspector?.progressSummary?.runningSample || []).map((row, idx) => (
              <div key={`${row.childId || idx}-${idx}`} className="truncate">{String(row.childId)} [{String(row.status || "")}]</div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

