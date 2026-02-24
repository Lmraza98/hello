import React from "react";
import { PanelLeft } from "lucide-react";
import DetailsPane from "../../../components/DetailsPane";
import TestDependencyGraph from "../../../components/graph/TestDependencyGraph";
import GraphErrorBoundary from "../../../components/GraphErrorBoundary";
import { Z_GRAPH_UI } from "../../../lib/zIndex";
import RunHistorySection from "./RunHistorySection";

export default function GraphView(props) {
  const {
    layoutRef,
    graphCanInlineDetails,
    GRAPH_CENTER_MIN_PX,
    GRAPH_DIVIDER_PX,
    GRAPH_RIGHT_MIN_PX,
    graphRightWidthClamped,
    graphDetailsOpen,
    startGraphDividerDrag,
    graphState,
    graphNodesWithPlayback,
    setGraphState,
    activeRunId,
    selectedRunId,
    childAttemptById,
    waitingFirstEvent,
    artifactReplayMode,
    childScopeEvents,
    childScopeProgress,
    selectGraphNode,
    normalizeChildSelectionId,
    setGraphSelectedRunTargetId,
    setManualGraphChildId,
    setFollowActivePaused,
    setGraphDetailsOpen,
    graphScope,
    setGraphScope,
    isPytestGateAggregateId,
    setGraphBubbleAggregateId,
    followActiveChild,
    followActivePaused,
    setFollowActiveChild,
    graphScopedModel,
    setGraphScopedModel,
    updateGraphPlayback,
    setGraphBottomTab,
    graphBottomTab,
    aggregateFilterIds,
    aggregateFilterOptions,
    setAggregateFilterIds,
    graphBubbleAggregateId,
    aggregateScopedSuites,
    selectedSuiteId,
    selectedTestId,
    graphDetailsNode,
    detailsSelectedCase,
    bridge,
    tests,
    statusById,
    runs,
    logs,
    handleSelectRun,
    runInspector,
    graphActiveChildId,
    graphDetailChildId,
    graphSelectedEvent,
    graphScreenshotsById,
    setSelectedCaseId,
    setSelectedTestId,
    setTab,
    setDrawerOpen,
    runHistoryCollapsed,
    setRunHistoryCollapsed,
    layout,
    startDrag,
    showArtifactsPopoverFor,
    setShowArtifactsPopoverFor,
    actions,
  } = props;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden p-3">
      <div ref={layoutRef} className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          <div
            className="relative grid h-full min-h-0 overflow-hidden"
            style={{
              gridTemplateColumns:
                graphCanInlineDetails
                  ? `minmax(${GRAPH_CENTER_MIN_PX}px, 1fr) ${GRAPH_DIVIDER_PX}px minmax(${GRAPH_RIGHT_MIN_PX}px, ${graphRightWidthClamped}px)`
                  : "minmax(0, 1fr)",
              gridTemplateRows: graphDetailsOpen && !graphCanInlineDetails ? "minmax(0,1fr) minmax(220px,40%)" : "minmax(0,1fr)",
              columnGap: 8,
              rowGap: 8,
            }}
          >
            <div className="relative min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: 1, gridRow: 1 }}>
              <GraphErrorBoundary>
                <TestDependencyGraph
                  graphState={{
                    ...graphState,
                    nodes: graphNodesWithPlayback,
                    onStatusFilterChange: actions?.setStatusFilters || ((filters) => setGraphState((prev) => ({ ...prev, statusFilters: filters }))),
                  }}
                  activeRunId={activeRunId}
                  selectedRunId={selectedRunId || activeRunId}
                  childAttemptById={childAttemptById}
                  waitingFirstEvent={waitingFirstEvent}
                  artifactReplayMode={artifactReplayMode}
                  childScopeEvents={childScopeEvents}
                  childScopeProgress={childScopeProgress}
                  onSelectNode={selectGraphNode}
                  onSelectInlineChild={actions?.selectInlineChild || ((childId, aggregateId) => {
                    const canonicalChild = normalizeChildSelectionId(aggregateId, childId);
                    setGraphSelectedRunTargetId(canonicalChild);
                    setGraphState((prev) => ({ ...prev, selectedNodeId: canonicalChild }));
                    setManualGraphChildId(canonicalChild);
                    setFollowActivePaused(true);
                    setGraphDetailsOpen(true);
                  })}
                  onEnterAggregate={actions?.enterAggregate || ((aggregateId) => {
                    if (!aggregateId) return;
                    setGraphSelectedRunTargetId(String(aggregateId));
                    setFollowActivePaused(true);
                    setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
                    setGraphDetailsOpen(true);
                    if (String(graphScope?.level || "suite") !== "suite") {
                      setGraphBubbleAggregateId("");
                      setGraphScope({ level: "aggregate", aggregateId, childId: "" });
                      return;
                    }
                    if (!isPytestGateAggregateId(aggregateId, graphNodesWithPlayback)) setGraphBubbleAggregateId(aggregateId);
                    else setGraphBubbleAggregateId("");
                  })}
                  onOpenNodeDetails={actions?.openNodeDetails || (() => setGraphDetailsOpen(true))}
                  follow={followActiveChild && !followActivePaused}
                  onToggleFollow={actions?.toggleFollow || (() => {
                    if (followActiveChild && followActivePaused) {
                      setFollowActivePaused(false);
                    } else {
                      setFollowActiveChild((v) => !v);
                      setFollowActivePaused(false);
                    }
                  })}
                  onPauseFollow={actions?.pauseFollow || (() => setFollowActivePaused(true))}
                  onScopedGraphChange={actions?.setScopedGraph || ((graph) =>
                    setGraphScopedModel((prev) => {
                      const next = graph || { nodes: [], edges: [], scope: "suite" };
                      const prevNodeSig = (prev?.nodes || []).map((n) => String(n?.id || "")).join("|");
                      const nextNodeSig = (next?.nodes || []).map((n) => String(n?.id || "")).join("|");
                      const prevEdgeSig = (prev?.edges || []).map((e) => `${String(e?.from || "")}->${String(e?.to || "")}`).join("|");
                      const nextEdgeSig = (next?.edges || []).map((e) => `${String(e?.from || "")}->${String(e?.to || "")}`).join("|");
                      if (
                        String(prev?.scope || "suite") === String(next?.scope || "suite") &&
                        prevNodeSig === nextNodeSig &&
                        prevEdgeSig === nextEdgeSig
                      ) {
                        return prev;
                      }
                      return next;
                    })
                  )}
                  onHighlightMode={actions?.setHighlightMode || ((mode) => setGraphState((prev) => ({ ...prev, highlightMode: mode, manualOverride: true })))}
                  onPlayback={updateGraphPlayback}
                  onSetBottomTab={setGraphBottomTab}
                  bottomTab={graphBottomTab}
                  rightPanelOpen={graphDetailsOpen}
                  aggregateFilterIds={aggregateFilterIds}
                  aggregateFilterOptions={aggregateFilterOptions}
                  onAggregateFilterChange={setAggregateFilterIds}
                  bubbleAggregateId={graphBubbleAggregateId}
                  breadcrumb={`${aggregateScopedSuites.find((s) => s.suiteId === selectedSuiteId)?.suiteName || "Suite"} / ${graphScope.level === "child" ? `${graphDetailsNode?.name || "Aggregate"} / ${detailsSelectedCase?.name || "Child"}` : graphScope.level === "aggregate" ? (graphDetailsNode?.name || "Aggregate") : (selectedTestId || "Graph")}`}
                  graphScope={graphScope}
                  onBackScope={actions?.backScope || (() => {
                    setFollowActivePaused(true);
                    setGraphScope((prev) =>
                      prev.level === "child"
                        ? { level: "aggregate", aggregateId: prev.aggregateId, childId: "" }
                        : { level: "suite", aggregateId: "", childId: "" }
                    );
                  })}
                />
              </GraphErrorBoundary>
              {!graphDetailsOpen ? (
                <div className="absolute right-0 top-20 flex w-10 flex-col items-center gap-2 rounded-l-md border border-r-0 border-slate-700 bg-slate-950/95 p-1" style={{ zIndex: Z_GRAPH_UI }}>
                  <button
                    type="button"
                    disabled={!graphDetailsNode}
                    onClick={actions?.openDetails || (() => setGraphDetailsOpen(Boolean(graphDetailsNode)))}
                    className="rounded border border-slate-700 p-1 text-xs text-slate-300 disabled:opacity-40"
                    title="Open details"
                  >
                    <PanelLeft className="h-3.5 w-3.5 rotate-180" />
                  </button>
                </div>
              ) : null}
            </div>

            {graphCanInlineDetails && graphDetailsOpen ? (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={startGraphDividerDrag}
                  className="group relative cursor-col-resize touch-none"
                  style={{ gridColumn: 2, gridRow: 1 }}
                >
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
                </div>
                <div className="min-h-0 min-w-0 overflow-hidden rounded-md border border-slate-800/60 bg-slate-950/95" style={{ gridColumn: 3, gridRow: 1 }}>
                  <DetailsPane
                    drawerOpen={graphDetailsOpen}
                    selectedCase={detailsSelectedCase}
                    setDrawerOpen={() => setGraphDetailsOpen(false)}
                    bridge={bridge}
                    tests={tests}
                    statusById={statusById}
                    runs={runs}
                    logs={logs}
                    selectedRunId={selectedRunId}
                    onSelectRun={(runId) => handleSelectRun(runId, { scope: false })}
                    runInspector={runInspector}
                    graphContext={{
                      active: true,
                      compactInspector: true,
                      selectedNode: graphDetailsNode,
                      activeChildId: graphActiveChildId,
                      currentChildId: graphDetailChildId,
                      events: graphState.events,
                      selectedEventId: graphState.selectedEventId,
                      selectedEvent: graphSelectedEvent,
                      screenshotsById: graphScreenshotsById,
                      onSelectChild: actions?.selectChild || ((childId) => {
                        if (!childId) return;
                        const canonicalChild = normalizeChildSelectionId(graphDetailsNode?.id || "", childId);
                        setFollowActivePaused(true);
                        setGraphSelectedRunTargetId(canonicalChild);
                        setGraphState((prev) => ({ ...prev, selectedNodeId: canonicalChild }));
                        setManualGraphChildId(canonicalChild);
                        setGraphScope({ level: "child", aggregateId: graphDetailsNode?.id || "", childId: canonicalChild });
                        setSelectedCaseId(canonicalChild);
                        const testId = String(canonicalChild).split("::")[0] || "";
                        if (testId) setSelectedTestId(testId);
                      }),
                      onSelectEvent: actions?.selectEvent || ((event, index) => {
                        setGraphState((prev) => ({
                          ...prev,
                          selectedEventId: event?.id || "",
                          selectedNodeId: event?.nodeId || prev.selectedNodeId,
                          playback: { ...prev.playback, mode: "timeline", cursor: index, isPlaying: false },
                        }));
                      }),
                      onOpenRun: actions?.openRun || (({ runId }) => {
                        if (runId) handleSelectRun(runId, { scope: true });
                        setTab("tests");
                        setDrawerOpen(true);
                      }),
                    }}
                  />
                </div>
              </>
            ) : null}

            {!graphCanInlineDetails && graphDetailsOpen ? (
              <div className="min-h-0 min-w-0 overflow-hidden rounded-md border border-slate-800/60 bg-slate-950/95" style={{ gridColumn: 1, gridRow: 2 }}>
                <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-2 py-1">
                  <div className="text-xs text-slate-400">Details (stacked, narrow viewport)</div>
                  <button type="button" className="rounded border border-slate-700 px-2 py-0.5 text-xs" onClick={actions?.closeDetails || (() => setGraphDetailsOpen(false))}>
                    Collapse
                  </button>
                </div>
                <DetailsPane
                  drawerOpen={graphDetailsOpen}
                  selectedCase={detailsSelectedCase}
                  setDrawerOpen={() => setGraphDetailsOpen(false)}
                  bridge={bridge}
                  tests={tests}
                  statusById={statusById}
                  runs={runs}
                  logs={logs}
                  selectedRunId={selectedRunId}
                  onSelectRun={(runId) => handleSelectRun(runId, { scope: false })}
                  runInspector={runInspector}
                  graphContext={{
                    active: true,
                    compactInspector: true,
                    selectedNode: graphDetailsNode,
                    activeChildId: graphActiveChildId,
                    currentChildId: graphDetailChildId,
                    events: graphState.events,
                    selectedEventId: graphState.selectedEventId,
                    selectedEvent: graphSelectedEvent,
                    screenshotsById: graphScreenshotsById,
                    onSelectChild: actions?.selectChild || ((childId) => {
                      if (!childId) return;
                      const canonicalChild = normalizeChildSelectionId(graphDetailsNode?.id || "", childId);
                      setFollowActivePaused(true);
                      setGraphSelectedRunTargetId(canonicalChild);
                      setGraphState((prev) => ({ ...prev, selectedNodeId: canonicalChild }));
                      setManualGraphChildId(canonicalChild);
                      setGraphScope({ level: "child", aggregateId: graphDetailsNode?.id || "", childId: canonicalChild });
                      setSelectedCaseId(canonicalChild);
                      const testId = String(canonicalChild).split("::")[0] || "";
                      if (testId) setSelectedTestId(testId);
                    }),
                    onSelectEvent: actions?.selectEvent || ((event, index) => {
                      setGraphState((prev) => ({
                        ...prev,
                        selectedEventId: event?.id || "",
                        selectedNodeId: event?.nodeId || prev.selectedNodeId,
                        playback: { ...prev.playback, mode: "timeline", cursor: index, isPlaying: false },
                      }));
                    }),
                    onOpenRun: actions?.openRun || (({ runId }) => {
                      if (runId) handleSelectRun(runId, { scope: true });
                      setTab("tests");
                      setDrawerOpen(true);
                    }),
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <RunHistorySection
          collapsed={runHistoryCollapsed}
          setCollapsed={setRunHistoryCollapsed}
          heightPx={layout.artifactsHeight}
          onStartResize={(e) => startDrag("h", e)}
          runs={runs}
          showArtifactsPopoverFor={showArtifactsPopoverFor}
          setShowArtifactsPopoverFor={setShowArtifactsPopoverFor}
          bridge={bridge}
          selectedRunId={selectedRunId}
          onSelectRun={(runId) => handleSelectRun(runId, { scope: Boolean(runId) })}
        />
      </div>
    </div>
  );
}
