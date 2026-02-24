import { useMemo } from "react";
import { isPytestGateAggregateId, normalizeChildSelectionId } from "../utils/ids";
import { toDetailsSelectedCase } from "../utils/detailsSelectedCase";

export function useAppShellViewModel({ chrome, runOps, tests, testsActions, graph, layout, ui }) {
  const detailsSelectedCase = useMemo(
    () => toDetailsSelectedCase(chrome.tab, graph.graphDetailsNode, graph.graphDetailChildId, tests.selectedCase),
    [chrome.tab, graph.graphDetailsNode, graph.graphDetailChildId, tests.selectedCase]
  );

  const topBar = {
    bridge: chrome.bridge,
    loadingRun: runOps.loadingRun,
    tab: chrome.tab,
    setTab: chrome.setTab,
    previewLine: runOps.previewLine,
    previewBusy: runOps.previewBusy,
    runPrimaryLabel: runOps.hasPausedRun && !runOps.anyRunActive ? "Resume Run" : "Run",
    onRunPrimary: () => void runOps.handleRun(undefined, { resumePaused: true }),
    onRunSelected: () => {
      const selectedIds = runOps.idsForRun("selected");
      void runOps.handleRun(selectedIds.length ? selectedIds : undefined);
    },
    onPauseRun: () => void runOps.handlePauseRun(),
    onPreview: () => void runOps.handlePreview(),
    onRefresh: () => void runOps.handleManualRefresh(),
    onStop: (mode) => void runOps.handleStop(mode),
    onToggleUtilityMenu: () => ui.setShowUtilityMenu((v) => !v),
    showUtilityMenu: ui.showUtilityMenu,
    onCopyLogs: () => void runOps.copyLogs(),
    onCopyDiagnostics: () => void runOps.copyDiagnostics(),
    liveMode: chrome.liveMode,
    onToggleLiveMode: () => chrome.setLiveMode((v) => !v),
    anyRunActive: runOps.anyRunActive,
    waitingFirstEvent: chrome.waitingFirstEvent,
    activeFilterCount: tests.activeFilterCount,
    onClearFilters: testsActions.clearFilters,
    onClearState: runOps.handleClearState,
    onClearCache: () => void runOps.handleClearCache(),
  };

  const testsView = {
    searchRef: tests.searchRef,
    search: tests.search,
    setSearch: tests.setSearch,
    tag: tests.tag,
    setTag: tests.setTag,
    selectedSuiteId: tests.selectedSuiteId,
    setSelectedSuiteId: tests.setSelectedSuiteId,
    suites: tests.suites,
    kind: tests.kind,
    setKind: tests.setKind,
    outcome: tests.outcome,
    setOutcome: tests.setOutcome,
    aggregateFilterIds: tests.aggregateFilterIds,
    setAggregateFilterIds: tests.setAggregateFilterIds,
    aggregateFilterOptions: tests.aggregateFilterOptions,
    activeFilterCount: tests.activeFilterCount,
    clearFilters: testsActions.clearFilters,
    latestRun: tests.latestRun,
    statusById: tests.statusById,
    handleStop: runOps.handleStop,
    layoutRef: layout.tests.ref,
    detailsInline: layout.tests.detailsInline,
    suitesMinPx: layout.tests.suitesMinPx,
    casesMinPx: layout.tests.casesMinPx,
    detailsMinPx: layout.tests.detailsMinPx,
    layout: layout.main,
    DIVIDER_PX: layout.mainDividerPx,
    startDrag: layout.startDrag,
    aggregateScopedSuites: tests.aggregateScopedSuites,
    collapsedSuites: tests.collapsedSuites,
    setCollapsedSuites: tests.setCollapsedSuites,
    handleRun: runOps.handleRun,
    selectedTestId: tests.selectedTestId,
    selectedCaseIds: tests.selectedCaseIds,
    setSelectedCaseIds: tests.setSelectedCaseIds,
    setSelectedTestId: tests.setSelectedTestId,
    setDrawerOpen: ui.setDrawerOpen,
    visibleCases: tests.visibleCases,
    selectedCase: tests.selectedCase,
    setSelectedCaseId: tests.setSelectedCaseId,
    triageActive: tests.triageActive,
    drawerOpen: ui.drawerOpen,
    OVERLAY_DETAILS_MIN_PX: layout.overlayDetailsMinPx,
    overlayDetailsMaxWidth: layout.tests.overlayDetailsMaxWidth,
    detailsSelectedCase,
    bridge: chrome.bridge,
    tests: tests.tests,
    runs: tests.runs,
    logs: chrome.logs,
    selectedRunId: tests.selectedRunId,
    handleSelectRun: runOps.handleSelectRun,
    runInspector: graph.runInspector,
    runHistoryCollapsed: ui.runHistoryCollapsed,
    setRunHistoryCollapsed: ui.setRunHistoryCollapsed,
    showArtifactsPopoverFor: ui.showArtifactsPopoverFor,
    setShowArtifactsPopoverFor: ui.setShowArtifactsPopoverFor,
  };

  const graphActions = {
    setStatusFilters: (filters) => graph.setGraphState((prev) => ({ ...prev, statusFilters: filters })),
    selectInlineChild: (childId, aggregateId) => {
      const canonicalChild = normalizeChildSelectionId(aggregateId, childId);
      graph.setGraphSelectedRunTargetId(canonicalChild);
      graph.setGraphState((prev) => ({ ...prev, selectedNodeId: canonicalChild }));
      graph.setManualGraphChildId(canonicalChild);
      graph.setFollowActivePaused(true);
      graph.setGraphDetailsOpen(true);
    },
    enterAggregate: (aggregateId) => {
      if (!aggregateId) return;
      graph.setGraphSelectedRunTargetId(String(aggregateId));
      graph.setFollowActivePaused(true);
      graph.setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
      graph.setGraphDetailsOpen(true);
      if (String(graph.graphScope?.level || "suite") !== "suite") {
        graph.setGraphBubbleAggregateId("");
        graph.setGraphScope({ level: "aggregate", aggregateId, childId: "" });
        return;
      }
      if (!isPytestGateAggregateId(aggregateId, graph.graphNodesWithPlayback)) graph.setGraphBubbleAggregateId(aggregateId);
      else graph.setGraphBubbleAggregateId("");
    },
    openNodeDetails: () => graph.setGraphDetailsOpen(true),
    toggleFollow: () => {
      if (graph.followActiveChild && graph.followActivePaused) {
        graph.setFollowActivePaused(false);
      } else {
        graph.setFollowActiveChild((v) => !v);
        graph.setFollowActivePaused(false);
      }
    },
    pauseFollow: () => graph.setFollowActivePaused(true),
    setScopedGraph: (next) =>
      graph.setGraphScopedModel((prev) => {
        const scoped = next || { nodes: [], edges: [], scope: "suite" };
        const prevNodeSig = (prev?.nodes || []).map((n) => String(n?.id || "")).join("|");
        const nextNodeSig = (scoped?.nodes || []).map((n) => String(n?.id || "")).join("|");
        const prevEdgeSig = (prev?.edges || []).map((e) => `${String(e?.from || "")}->${String(e?.to || "")}`).join("|");
        const nextEdgeSig = (scoped?.edges || []).map((e) => `${String(e?.from || "")}->${String(e?.to || "")}`).join("|");
        if (
          String(prev?.scope || "suite") === String(scoped?.scope || "suite") &&
          prevNodeSig === nextNodeSig &&
          prevEdgeSig === nextEdgeSig
        ) {
          return prev;
        }
        return scoped;
      }),
    setHighlightMode: (mode) => graph.setGraphState((prev) => ({ ...prev, highlightMode: mode, manualOverride: true })),
    backScope: () => {
      graph.setFollowActivePaused(true);
      graph.setGraphScope((prev) =>
        prev.level === "child"
          ? { level: "aggregate", aggregateId: prev.aggregateId, childId: "" }
          : { level: "suite", aggregateId: "", childId: "" }
      );
    },
    openDetails: () => graph.setGraphDetailsOpen(Boolean(graph.graphDetailsNode)),
    closeDetails: () => graph.setGraphDetailsOpen(false),
    selectChild: (childId) => {
      if (!childId) return;
      const canonicalChild = normalizeChildSelectionId(graph.graphDetailsNode?.id || "", childId);
      graph.setFollowActivePaused(true);
      graph.setGraphSelectedRunTargetId(canonicalChild);
      graph.setGraphState((prev) => ({ ...prev, selectedNodeId: canonicalChild }));
      graph.setManualGraphChildId(canonicalChild);
      graph.setGraphScope({ level: "child", aggregateId: graph.graphDetailsNode?.id || "", childId: canonicalChild });
      tests.setSelectedCaseId(canonicalChild);
      const testId = String(canonicalChild).split("::")[0] || "";
      if (testId) tests.setSelectedTestId(testId);
    },
    selectEvent: (event, index) => {
      graph.setGraphState((prev) => ({
        ...prev,
        selectedEventId: event?.id || "",
        selectedNodeId: event?.nodeId || prev.selectedNodeId,
        playback: { ...prev.playback, mode: "timeline", cursor: index, isPlaying: false },
      }));
    },
    openRun: ({ runId }) => {
      if (runId) runOps.handleSelectRun(runId, { scope: true });
      chrome.setTab("tests");
      ui.setDrawerOpen(true);
    },
  };

  const graphView = {
    layoutRef: layout.graph.ref,
    graphCanInlineDetails: layout.graph.canInlineDetails,
    GRAPH_CENTER_MIN_PX: layout.graph.centerMinPx,
    GRAPH_DIVIDER_PX: layout.graph.dividerPx,
    GRAPH_RIGHT_MIN_PX: layout.graph.rightMinPx,
    graphRightWidthClamped: layout.graph.rightWidthClamped,
    graphDetailsOpen: graph.graphDetailsOpen,
    startGraphDividerDrag: layout.graph.startDividerDrag,
    graphState: graph.graphState,
    graphNodesWithPlayback: graph.graphNodesWithPlayback,
    setGraphState: graph.setGraphState,
    activeRunId: graph.activeRunId,
    selectedRunId: tests.selectedRunId,
    childAttemptById: graph.childAttemptById,
    waitingFirstEvent: chrome.waitingFirstEvent,
    artifactReplayMode: graph.artifactReplayMode,
    childScopeEvents: graph.childScopeEvents,
    childScopeProgress: graph.childScopeProgress,
    selectGraphNode: graph.selectGraphNode,
    normalizeChildSelectionId,
    graphScope: graph.graphScope,
    setGraphScope: graph.setGraphScope,
    isPytestGateAggregateId,
    setGraphBubbleAggregateId: graph.setGraphBubbleAggregateId,
    followActiveChild: graph.followActiveChild,
    followActivePaused: graph.followActivePaused,
    setFollowActiveChild: graph.setFollowActiveChild,
    graphScopedModel: graph.graphScopedModel,
    setGraphScopedModel: graph.setGraphScopedModel,
    updateGraphPlayback: graph.updateGraphPlayback,
    setGraphBottomTab: graph.setGraphBottomTab,
    graphBottomTab: graph.graphBottomTab,
    aggregateFilterIds: tests.aggregateFilterIds,
    aggregateFilterOptions: tests.aggregateFilterOptions,
    setAggregateFilterIds: tests.setAggregateFilterIds,
    graphBubbleAggregateId: graph.graphBubbleAggregateId,
    aggregateScopedSuites: tests.aggregateScopedSuites,
    selectedSuiteId: tests.selectedSuiteId,
    selectedTestId: tests.selectedTestId,
    graphDetailsNode: graph.graphDetailsNode,
    detailsSelectedCase,
    bridge: chrome.bridge,
    tests: tests.tests,
    statusById: tests.statusById,
    runs: tests.runs,
    logs: chrome.logs,
    handleSelectRun: runOps.handleSelectRun,
    runInspector: graph.runInspector,
    graphActiveChildId: graph.graphActiveChildId,
    graphDetailChildId: graph.graphDetailChildId,
    graphSelectedEvent: graph.graphSelectedEvent,
    graphScreenshotsById: graph.graphScreenshotsById,
    setSelectedCaseId: tests.setSelectedCaseId,
    setSelectedTestId: tests.setSelectedTestId,
    setTab: chrome.setTab,
    setDrawerOpen: ui.setDrawerOpen,
    runHistoryCollapsed: ui.runHistoryCollapsed,
    setRunHistoryCollapsed: ui.setRunHistoryCollapsed,
    layout: layout.main,
    startDrag: layout.startDrag,
    showArtifactsPopoverFor: ui.showArtifactsPopoverFor,
    setShowArtifactsPopoverFor: ui.setShowArtifactsPopoverFor,
    actions: graphActions,
  };

  return {
    chrome: {
      bridge: chrome.bridge,
      bridgeError: chrome.bridgeError,
      startup: chrome.startup,
      tab: chrome.tab,
      logs: chrome.logs,
      showIssuesDrawer: chrome.showIssuesDrawer,
      setShowIssuesDrawer: chrome.setShowIssuesDrawer,
    },
    topBar,
    testsView,
    graphView,
  };
}
