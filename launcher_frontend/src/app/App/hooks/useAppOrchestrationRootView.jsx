import React, { useEffect, useMemo, useRef, useState } from "react";
import BridgeState from "../../../components/BridgeState";
import { usePywebviewBridge } from "../../../hooks/usePywebviewBridge";
import { buildGraphModel } from "../../../lib/graph/buildGraphModel";
import AppShellView from "../views/AppShellView";
import { useSplitPaneLayout } from "./useSplitPaneLayout";
import { useFiltersAndSelection } from "./useFiltersAndSelection";
import { useGraphController } from "./useGraphController";
import { useGraphRuntime } from "./useGraphRuntime";
import { useRunHotkeys } from "./useRunHotkeys";
import { useRunSelectionActions } from "./useRunSelectionActions";
import { useRunOperations } from "./useRunOperations";
import {
  isPytestGateAggregaateId,
  normalizeChildSelectionId,
} from "../utils/ids";
import { toDetailsSelectedCase } from "../utils/detailsSelectedCase";

export function useAppOrchestrationRootView() {
  const SUITES_MIN_PX = 260;
  const CASES_MIN_PX = 420;
  const DETAILS_MIN_PX = 360;
  const DIVIDER_PX = 10;
  const OVERLAY_DETAILS_MIN_PX = 320;
  const GRAPH_DIVIDER_PX = 10;
  const GRAPH_RIGHT_MIN_PX = 320;
  const GRAPH_RIGHT_MAX_PX = 520;
  const GRAPH_CENTER_MIN_PX = 520;

  const searchRef = useRef(null);
  const { bridge, bridgeError } = usePywebviewBridge();

  const [tab, setTab] = useState("tests");
  const [logs, setLogs] = useState("");
  const [startup, setStartup] = useState(null);
  const [tests, setTests] = useState([]);
  const [statusById, setStatusById] = useState({});
  const [runs, setRuns] = useState([]);

  const [selectedCaseIds, setSelectedCaseIds] = useState(new Set());
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [selectedTestId, setSelectedTestId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [aggregateFilterIds, setAggregateFilterIds] = useState([]);
  const [collapsedSuites, setCollapsedSuites] = useState({});

  const [tag, setTag] = useState("");
  const [kind, setKind] = useState("");
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [previewLine, setPreviewLine] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);

  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [showIssuesDrawer, setShowIssuesDrawer] = useState(false);
  const [showArtifactsPopoverFor, setShowArtifactsPopoverFor] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [runScopeEnabled, setRunScopeEnabled] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [liveMode, setLiveMode] = useState(true);
  const [activeRunId, setActiveRunId] = useState("");
  const [pausedRunState, setPausedRunState] = useState(null);
  const [lastRunUpdateTs, setLastRunUpdateTs] = useState(0);
  const [waitingFirstEvent, setWaitingFirstEvent] = useState(false);
  const [statusResetActive, setStatusResetActive] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [runHistoryCollapsed, setRunHistoryCollapsed] = useState(false);
  const {
    followActiveChild,
    setFollowActiveChild,
    followActivePaused,
    setFollowActivePaused,
    manualGraphChildId,
    setManualGraphChildId,
    graphDetailsOpen,
    setGraphDetailsOpen,
    graphBottomTab,
    setGraphBottomTab,
    graphScope,
    setGraphScope,
    graphSelectedRunTargetId,
    setGraphSelectedRunTargetId,
    graphBubbleAggregateId,
    setGraphBubbleAggregateId,
    graphScopedModel,
    setGraphScopedModel,
    childScopeEvents,
    setChildScopeEvents,
    childProgressByParent,
    setChildProgressByParent,
    graphState,
    setGraphState,
    runAutoTrackRef,
  } = useGraphController();
  const {
    testsLayoutRef,
    graphLayoutRef,
    layout,
    containerSize,
    detailsInline,
    suitesMinPx,
    casesMinPx,
    detailsMinPx,
    overlayDetailsMaxWidth,
    graphCanInlineDetails,
    graphRightWidthClamped,
    graphAvailableWidth,
    startDrag,
    startGraphDividerDrag,
  } = useSplitPaneLayout({
    tab,
    runHistoryCollapsed,
    graphDetailsOpen,
    SUITES_MIN_PX,
    CASES_MIN_PX,
    DETAILS_MIN_PX,
    DIVIDER_PX,
    OVERLAY_DETAILS_MIN_PX,
    GRAPH_DIVIDER_PX,
    GRAPH_RIGHT_MIN_PX,
    GRAPH_RIGHT_MAX_PX,
    GRAPH_CENTER_MIN_PX,
  });
  const graphModelSigRef = useRef("");
  const runtimeDebug = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const fromGlobal = Boolean(window.__LP_DEBUG__);
      const fromStorage = window.localStorage?.getItem("LP_DEBUG") === "1";
      return fromGlobal || fromStorage;
    } catch {
      return false;
    }
  }, []);

  const {
    suites,
    aggregateFilterOptions,
    aggregateScopedSuites,
    visibleCases,
    selectedCase,
    latestRun,
    activeFilterCount,
    triageActive,
  } = useFiltersAndSelection({
    tests,
    statusById,
    runs,
    selectedRunId,
    runScopeEnabled,
    selectedSuiteId,
    setSelectedSuiteId,
    selectedTestId,
    setSelectedTestId,
    selectedCaseId,
    setSelectedCaseId,
    aggregateFilterIds,
    setAggregateFilterIds,
    tag,
    kind,
    outcome,
    search,
    tab,
    setSelectedRunId,
  });
  const graphSelectedTestId = tab === "graph" ? "" : selectedTestId;
  const graphModel = useMemo(
    () =>
      buildGraphModel({
        suites: aggregateScopedSuites,
        selectedSuiteId,
        selectedTestId: graphSelectedTestId,
        visibleCases,
        statusById,
        runs,
        selectedRunId,
        runScopeEnabled,
      }),
    [aggregateScopedSuites, selectedSuiteId, graphSelectedTestId, visibleCases, statusById, runs, selectedRunId, runScopeEnabled]
  );
  useEffect(() => {
    if (!runtimeDebug) return;
    const suiteSummaries = (aggregateScopedSuites || []).map((s) => `${s.suiteId}:${Array.isArray(s.cases) ? s.cases.length : 0}`).slice(0, 8);
    const sig = `${selectedSuiteId}|${selectedTestId}|${(graphModel?.nodes || []).length}|${(graphModel?.edges || []).length}|${suiteSummaries.join(",")}`;
    if (graphModelSigRef.current === sig) return;
    graphModelSigRef.current = sig;
    console.warn("[graph-model] summary", {
      selectedSuiteId,
      selectedTestId,
      runScopedSuites: suiteSummaries,
      nodes: Array.isArray(graphModel?.nodes) ? graphModel.nodes.length : 0,
      edges: Array.isArray(graphModel?.edges) ? graphModel.edges.length : 0,
      sampleNodes: (graphModel?.nodes || []).slice(0, 5).map((n) => ({ id: n.id, name: n.name, status: n.status })),
    });
  }, [runtimeDebug, selectedSuiteId, selectedTestId, aggregateScopedSuites, graphModel]);
  const {
    graphScreenshotsById,
    graphNodesWithPlayback,
    artifactReplayMode,
    graphDetailsNode,
    graphActiveChildId,
    graphDetailChildId,
    graphSelectedEvent,
    childAttemptById,
    childScopeProgress,
    runInspector,
    activeRunRow,
    anyRunActive,
    hasPausedRun,
    idsForRun,
    selectGraphNode,
    updateGraphPlayback,
  } = useGraphRuntime({
    runtimeDebug,
    bridge,
    tab,
    graphModel,
    graphState,
    setGraphState,
    graphScope,
    setGraphScope,
    graphScopedModel,
    selectedRunId,
    activeRunId,
    runs,
    statusById,
    setStatusById,
    tests,
    followActiveChild,
    followActivePaused,
    setFollowActivePaused,
    manualGraphChildId,
    setManualGraphChildId,
    graphSelectedRunTargetId,
    aggregateFilterIds,
    aggregateFilterOptions,
    setGraphBubbleAggregateId,
    aggregateScopedSuites,
    selectedCaseId,
    selectedCaseIds,
    selectedTestId,
    childScopeEvents,
    setChildScopeEvents,
    childProgressByParent,
    setChildProgressByParent,
    runAutoTrackRef,
    setGraphDetailsOpen,
  });

  const { refreshAll } = useBridgePolling({
    bridge,
    liveMode,
    anyRunActive,
    statusResetActive,
    selectedRunId,
    activeRunId,
    setLogs,
    setStartup,
    setTests,
    setStatusById,
    setRuns,
    setActiveRunId,
    setSelectedRunId,
    setWaitingFirstEvent,
    setLastRunUpdateTs,
    setStatusResetActive,
    setSelectedSuiteId,
    setSelectedTestId,
    setSelectedCaseId,
    lastRunUpdateTs,
  });

  async function handleStop(mode) {
    if (!bridge) return;
    if (bridge.stop) await bridge.stop(mode);
    else if (mode === "after_current") await bridge.cancel_current_test();
    else await bridge.cancel_run();
    if (mode !== "after_current") {
      setStatusById((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          next[id] = {
            ...(next[id] || {}),
            status: "not_run",
            duration: null,
            attempt: null,
            message: "",
            started_at: null,
            finished_at: null,
          };
        });
        return next;
      });
      setSelectedRunId(null);
      setRunScopeEnabled(false);
      setWaitingFirstEvent(false);
      setFollowActivePaused(false);
      setGraphScope((prev) => ({ ...prev, childId: "" }));
    }
    await refreshAll();
  }

  const {
    handlePreview,
    handleManualRefresh,
    handlePauseRun,
    handleRun,
    handleClearState,
    handleClearCache,
    copyLogs,
    copyDiagnostics,
  } = useRunController({
    bridge,
    loadingRun,
    setLoadingRun,
    idsForRun,
    runtimeDebug,
    graphState,
    graphScope,
    manualGraphChildId,
    graphDetailChildId,
    setStatusById,
    setLastRunUpdateTs,
    setPreviewBusy,
    setPreviewLine,
    activeRunRow,
    runs,
    setPausedRunState,
    handleStop,
    pausedRunState,
    hasPausedRun,
    tests,
    runAutoTrackRef,
    setActiveRunId,
    setSelectedRunId,
    setRunScopeEnabled,
    setLiveMode,
    setStatusResetActive,
    setWaitingFirstEvent,
    setFollowActivePaused,
    setGraphScope,
    refreshAll,
    anyRunActive,
    setChildScopeEvents,
    setChildProgressByParent,
    setShowUtilityMenu,
  });

  useEffect(() => {
    if (tab === "graph") {
      setDrawerOpen(false);
      setGraphDetailsOpen(Boolean(graphState.selectedNodeId));
    }
  }, [tab, graphState.selectedNodeId, setGraphDetailsOpen]);

  const { clearFilters, handleSelectRun } = useRunSelectionActions({
    setTag,
    setKind,
    setOutcome,
    setSelectedSuiteId,
    setAggregateFilterIds,
    setSelectedRunId,
    runScopeEnabled,
    setRunScopeEnabled,
    setGraphScopedModel,
    setGraphScope,
    selectedRunId,
  });

  useRunHotkeys({
    searchRef,
    idsForRun,
    handleRun,
    selectedCaseId,
    selectedCaseIds,
    selectedCase,
    selectedTestId,
    drawerOpen,
    setShowUtilityMenu,
    setShowArtifactsPopoverFor,
    setDrawerOpen,
    setSelectedCaseId,
    setSelectedTestId,
  });


  if (!bridge) return <BridgeState bridgeError={bridgeError} />;

  const detailsSelectedCase = useMemo(
    () => toDetailsSelectedCase(tab, graphDetailsNode, graphDetailChildId, selectedCase),
    [tab, graphDetailsNode, graphDetailChildId, selectedCase]
  );
  return (
    <AppShellView
      startup={startup}
      setShowIssuesDrawer={setShowIssuesDrawer}
      bridge={bridge}
      loadingRun={loadingRun}
      tab={tab}
      setTab={setTab}
      previewLine={previewLine}
      previewBusy={previewBusy}
      hasPausedRun={hasPausedRun}
      anyRunActive={anyRunActive}
      handleRun={handleRun}
      idsForRun={idsForRun}
      handlePauseRun={handlePauseRun}
      handlePreview={handlePreview}
      handleManualRefresh={handleManualRefresh}
      handleStop={handleStop}
      setShowUtilityMenu={setShowUtilityMenu}
      showUtilityMenu={showUtilityMenu}
      copyLogs={copyLogs}
      copyDiagnostics={copyDiagnostics}
      liveMode={liveMode}
      setLiveMode={setLiveMode}
      waitingFirstEvent={waitingFirstEvent}
      activeFilterCount={activeFilterCount}
      clearFilters={clearFilters}
      handleClearState={handleClearState}
      handleClearCache={handleClearCache}
      logs={logs}
      searchRef={searchRef}
      search={search}
      setSearch={setSearch}
      tag={tag}
      setTag={setTag}
      selectedSuiteId={selectedSuiteId}
      setSelectedSuiteId={setSelectedSuiteId}
      suites={suites}
      kind={kind}
      setKind={setKind}
      outcome={outcome}
      setOutcome={setOutcome}
      aggregateFilterIds={aggregateFilterIds}
      setAggregateFilterIds={setAggregateFilterIds}
      aggregateFilterOptions={aggregateFilterOptions}
      latestRun={latestRun}
      statusById={statusById}
      testsLayoutRef={testsLayoutRef}
      detailsInline={detailsInline}
      suitesMinPx={suitesMinPx}
      casesMinPx={casesMinPx}
      detailsMinPx={detailsMinPx}
      layout={layout}
      DIVIDER_PX={DIVIDER_PX}
      startDrag={startDrag}
      aggregateScopedSuites={aggregateScopedSuites}
      collapsedSuites={collapsedSuites}
      setCollapsedSuites={setCollapsedSuites}
      selectedTestId={selectedTestId}
      selectedCaseIds={selectedCaseIds}
      setSelectedCaseIds={setSelectedCaseIds}
      setSelectedTestId={setSelectedTestId}
      setDrawerOpen={setDrawerOpen}
      visibleCases={visibleCases}
      selectedCase={selectedCase}
      setSelectedCaseId={setSelectedCaseId}
      triageActive={triageActive}
      drawerOpen={drawerOpen}
      OVERLAY_DETAILS_MIN_PX={OVERLAY_DETAILS_MIN_PX}
      overlayDetailsMaxWidth={overlayDetailsMaxWidth}
      detailsSelectedCase={detailsSelectedCase}
      tests={tests}
      runs={runs}
      selectedRunId={selectedRunId}
      handleSelectRun={handleSelectRun}
      runInspector={runInspector}
      runHistoryCollapsed={runHistoryCollapsed}
      setRunHistoryCollapsed={setRunHistoryCollapsed}
      showArtifactsPopoverFor={showArtifactsPopoverFor}
      setShowArtifactsPopoverFor={setShowArtifactsPopoverFor}
      graphLayoutRef={graphLayoutRef}
      graphCanInlineDetails={graphCanInlineDetails}
      GRAPH_CENTER_MIN_PX={GRAPH_CENTER_MIN_PX}
      GRAPH_DIVIDER_PX={GRAPH_DIVIDER_PX}
      GRAPH_RIGHT_MIN_PX={GRAPH_RIGHT_MIN_PX}
      graphRightWidthClamped={graphRightWidthClamped}
      graphDetailsOpen={graphDetailsOpen}
      startGraphDividerDrag={startGraphDividerDrag}
      graphState={graphState}
      graphNodesWithPlayback={graphNodesWithPlayback}
      setGraphState={setGraphState}
      activeRunId={activeRunId}
      childAttemptById={childAttemptById}
      artifactReplayMode={artifactReplayMode}
      childScopeEvents={childScopeEvents}
      childScopeProgress={childScopeProgress}
      selectGraphNode={selectGraphNode}
      normalizeChildSelectionId={normalizeChildSelectionId}
      setGraphSelectedRunTargetId={setGraphSelectedRunTargetId}
      setManualGraphChildId={setManualGraphChildId}
      setFollowActivePaused={setFollowActivePaused}
      setGraphDetailsOpen={setGraphDetailsOpen}
      graphScope={graphScope}
      setGraphScope={setGraphScope}
      isPytestGateAggregateId={isPytestGateAggregateId}
      setGraphBubbleAggregateId={setGraphBubbleAggregateId}
      followActiveChild={followActiveChild}
      followActivePaused={followActivePaused}
      setFollowActiveChild={setFollowActiveChild}
      graphScopedModel={graphScopedModel}
      setGraphScopedModel={setGraphScopedModel}
      updateGraphPlayback={updateGraphPlayback}
      setGraphBottomTab={setGraphBottomTab}
      graphBottomTab={graphBottomTab}
      graphBubbleAggregateId={graphBubbleAggregateId}
      graphDetailsNode={graphDetailsNode}
      graphActiveChildId={graphActiveChildId}
      graphDetailChildId={graphDetailChildId}
      graphSelectedEvent={graphSelectedEvent}
      graphScreenshotsById={graphScreenshotsById}
      showIssuesDrawer={showIssuesDrawer}
    />
  );
}




