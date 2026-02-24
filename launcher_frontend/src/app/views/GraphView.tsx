import React from "react";
import { PanelLeft } from "lucide-react";
import DetailsPane from "../../components/DetailsPane";
import TestDependencyGraph from "../../components/graph/TestDependencyGraph";
import GraphErrorBoundary from "../../components/GraphErrorBoundary";
import { Z_GRAPH_UI } from "../../lib/zIndex";
import RunHistorySection from "./RunHistorySection";

export default function GraphView({ layout, graph, actions, runHistory }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden p-3">
      <div ref={layout.ref} className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          <div
            className="relative grid h-full min-h-0 overflow-hidden"
            style={{
              gridTemplateColumns: layout.canInlineDetails
                ? `minmax(${layout.centerMinPx}px, 1fr) ${layout.dividerPx}px minmax(${layout.rightMinPx}px, ${layout.rightWidthClamped}px)`
                : "minmax(0, 1fr)",
              gridTemplateRows: layout.detailsOpen && !layout.canInlineDetails ? "minmax(0,1fr) minmax(220px,40%)" : "minmax(0,1fr)",
              columnGap: 8,
              rowGap: 8,
            }}
          >
            <div className="relative min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: 1, gridRow: 1 }}>
              <GraphErrorBoundary>
                <TestDependencyGraph
                  graphState={{
                    ...graph.state,
                    nodes: graph.nodes,
                    onStatusFilterChange: actions.setStatusFilters,
                  }}
                  activeRunId={graph.activeRunId}
                  selectedRunId={graph.selectedRunId || graph.activeRunId}
                  childAttemptById={graph.childAttemptById}
                  waitingFirstEvent={graph.waitingFirstEvent}
                  artifactReplayMode={graph.artifactReplayMode}
                  childScopeEvents={graph.childScopeEvents}
                  childScopeProgress={graph.childScopeProgress}
                  onSelectNode={actions.selectNode}
                  onSelectInlineChild={actions.selectInlineChild}
                  onEnterAggregate={actions.enterAggregate}
                  onOpenNodeDetails={actions.openNodeDetails}
                  follow={graph.follow}
                  onToggleFollow={actions.toggleFollow}
                  onPauseFollow={actions.pauseFollow}
                  onScopedGraphChange={actions.setScopedGraph}
                  onHighlightMode={actions.setHighlightMode}
                  onPlayback={actions.playback}
                  onSetBottomTab={actions.setBottomTab}
                  bottomTab={graph.bottomTab}
                  rightPanelOpen={layout.detailsOpen}
                  aggregateFilterIds={graph.aggregateFilterIds}
                  aggregateFilterOptions={graph.aggregateFilterOptions}
                  onAggregateFilterChange={actions.setAggregateFilterIds}
                  bubbleAggregateId={graph.bubbleId}
                  breadcrumb={`${graph.aggregateScopedSuites.find((s) => s.suiteId === graph.selectedSuiteId)?.suiteName || "Suite"} / ${graph.scope.level === "child" ? `${graph.detailsNode?.name || "Aggregate"} / ${graph.detailsSelectedCase?.name || "Child"}` : graph.scope.level === "aggregate" ? (graph.detailsNode?.name || "Aggregate") : (graph.selectedTestId || "Graph")}`}
                  graphScope={graph.scope}
                  onBackScope={actions.backScope}
                />
              </GraphErrorBoundary>
              {!layout.detailsOpen ? (
                <div className="absolute right-0 top-20 flex w-10 flex-col items-center gap-2 rounded-l-md border border-r-0 border-slate-700 bg-slate-950/95 p-1" style={{ zIndex: Z_GRAPH_UI }}>
                  <button
                    type="button"
                    disabled={!graph.detailsNode}
                    onClick={actions.openDetails}
                    className="rounded border border-slate-700 p-1 text-xs text-slate-300 disabled:opacity-40"
                    title="Open details"
                  >
                    <PanelLeft className="h-3.5 w-3.5 rotate-180" />
                  </button>
                </div>
              ) : null}
            </div>

            {layout.canInlineDetails && layout.detailsOpen ? (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={layout.startDividerDrag}
                  className="group relative cursor-col-resize touch-none"
                  style={{ gridColumn: 2, gridRow: 1 }}
                >
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
                </div>
                <div className="min-h-0 min-w-0 overflow-hidden rounded-md border border-slate-800/60 bg-slate-950/95" style={{ gridColumn: 3, gridRow: 1 }}>
                  <DetailsPane
                    drawerOpen={layout.detailsOpen}
                    selectedCase={graph.detailsSelectedCase}
                    setDrawerOpen={actions.closeDetails}
                    bridge={graph.bridge}
                    tests={graph.tests}
                    statusById={graph.statusById}
                    runs={graph.runs}
                    logs={graph.logs}
                    selectedRunId={graph.selectedRunId}
                    onSelectRun={actions.selectRunDetails}
                    runInspector={graph.runInspector}
                    graphContext={{
                      active: true,
                      compactInspector: true,
                      selectedNode: graph.detailsNode,
                      activeChildId: graph.activeChildId,
                      currentChildId: graph.detailChildId,
                      events: graph.state.events,
                      selectedEventId: graph.state.selectedEventId,
                      selectedEvent: graph.selectedEvent,
                      screenshotsById: graph.screenshotsById,
                      onSelectChild: actions.selectChild,
                      onSelectEvent: actions.selectEvent,
                      onOpenRun: actions.openRun,
                    }}
                  />
                </div>
              </>
            ) : null}

            {!layout.canInlineDetails && layout.detailsOpen ? (
              <div className="min-h-0 min-w-0 overflow-hidden rounded-md border border-slate-800/60 bg-slate-950/95" style={{ gridColumn: 1, gridRow: 2 }}>
                <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-2 py-1">
                  <div className="text-xs text-slate-400">Details (stacked, narrow viewport)</div>
                  <button type="button" className="rounded border border-slate-700 px-2 py-0.5 text-xs" onClick={actions.closeDetails}>
                    Collapse
                  </button>
                </div>
                <DetailsPane
                  drawerOpen={layout.detailsOpen}
                  selectedCase={graph.detailsSelectedCase}
                  setDrawerOpen={actions.closeDetails}
                  bridge={graph.bridge}
                  tests={graph.tests}
                  statusById={graph.statusById}
                  runs={graph.runs}
                  logs={graph.logs}
                  selectedRunId={graph.selectedRunId}
                  onSelectRun={actions.selectRunDetails}
                  runInspector={graph.runInspector}
                  graphContext={{
                    active: true,
                    compactInspector: true,
                    selectedNode: graph.detailsNode,
                    activeChildId: graph.activeChildId,
                    currentChildId: graph.detailChildId,
                    events: graph.state.events,
                    selectedEventId: graph.state.selectedEventId,
                    selectedEvent: graph.selectedEvent,
                    screenshotsById: graph.screenshotsById,
                    onSelectChild: actions.selectChild,
                    onSelectEvent: actions.selectEvent,
                    onOpenRun: actions.openRun,
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <RunHistorySection
          collapsed={runHistory.collapsed}
          setCollapsed={runHistory.setCollapsed}
          heightPx={runHistory.heightPx}
          onStartResize={runHistory.onStartResize}
          runs={runHistory.runs}
          showArtifactsPopoverFor={runHistory.showArtifactsPopoverFor}
          setShowArtifactsPopoverFor={runHistory.setShowArtifactsPopoverFor}
          bridge={runHistory.bridge}
          selectedRunId={runHistory.selectedRunId}
          onSelectRun={runHistory.onSelectRun}
        />
      </div>
    </div>
  );
}
