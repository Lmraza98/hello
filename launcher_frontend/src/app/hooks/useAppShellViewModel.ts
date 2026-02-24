import { useMemo } from "react";
import type * as React from "react";
import { isPytestGateAggregateId, normalizeChildSelectionId } from "../utils/ids";
import { toDetailsSelectedCase } from "../utils/detailsSelectedCase";
import type { Setter } from "../types/common";
import type { GraphEdgeLike, GraphNodeLike, GraphScope } from "../../components/graph/graphTypes";

type UseAppShellViewModelInput = {
  chrome: {
    bridge: unknown;
    bridgeError: unknown;
    startup: unknown;
    tab: string;
    setTab: Setter<string>;
    logs: string;
    liveMode: boolean;
    setLiveMode: Setter<boolean>;
    waitingFirstEvent: boolean;
    showIssuesDrawer: boolean;
    setShowIssuesDrawer: Setter<boolean>;
  };
  runOps: {
    loadingRun: boolean;
    previewLine: string;
    previewBusy: boolean;
    hasPausedRun: boolean;
    anyRunActive: boolean;
    handleRun: (ids?: string[], options?: { resumePaused?: boolean }) => Promise<void> | void;
    idsForRun: (scope: "selected" | "all") => string[];
    handlePauseRun: () => Promise<void> | void;
    handlePreview: () => Promise<void> | void;
    handleManualRefresh: () => Promise<void> | void;
    handleStop: (mode: "after_current" | "terminate_workers") => Promise<void> | void;
    copyLogs: () => Promise<void> | void;
    copyDiagnostics: () => Promise<void> | void;
    handleClearState: () => Promise<void> | void;
    handleClearCache: () => Promise<void> | void;
    handleSelectRun: (runId: string | null, options?: { scope?: boolean }) => void;
  };
  tests: {
    activeFilterCount: number;
    searchRef: React.RefObject<HTMLInputElement | null>;
    search: string;
    setSearch: Setter<string>;
    tag: string;
    setTag: Setter<string>;
    selectedSuiteId: string;
    setSelectedSuiteId: Setter<string>;
    suites: unknown[];
    kind: string;
    setKind: Setter<string>;
    outcome: string;
    setOutcome: Setter<string>;
    aggregateFilterIds: string[];
    setAggregateFilterIds: Setter<string[]>;
    aggregateFilterOptions: Array<{ id: string; name: string; total?: number }>;
    latestRun: unknown;
    statusById: Record<string, unknown>;
    aggregateScopedSuites: Array<{ suiteId: string; suiteName?: string; cases: Array<{ id: string; name?: string }> }>;
    collapsedSuites: Record<string, boolean>;
    setCollapsedSuites: Setter<Record<string, boolean>>;
    selectedTestId: string;
    selectedCaseIds: Set<string>;
    setSelectedCaseIds: Setter<Set<string>>;
    setSelectedTestId: Setter<string>;
    visibleCases: Array<{ id: string; name?: string; nodeid?: string; file_path?: string; suite_id?: string; tags?: string[] }>;
    selectedCase: { id: string; name?: string; nodeid?: string; file_path?: string; suite_id?: string; tags?: string[] } | null;
    setSelectedCaseId: Setter<string>;
    triageActive: boolean;
    tests: unknown[];
    runs: unknown[];
    selectedRunId: string | null;
  };
  testsActions: {
    clearFilters: () => void;
  };
  graph: {
    setGraphState: Setter<Record<string, unknown>>;
    selectGraphNode: (nodeId: string) => void;
    setGraphSelectedRunTargetId: Setter<string>;
    setManualGraphChildId: Setter<string>;
    setFollowActivePaused: Setter<boolean>;
    setGraphDetailsOpen: Setter<boolean>;
    graphScope: GraphScope;
    setGraphBubbleAggregateId: Setter<string>;
    graphNodesWithPlayback: GraphNodeLike[];
    setGraphScope: Setter<GraphScope>;
    graphDetailsNode: (GraphNodeLike & { aggregateChildren?: Array<{ id: string }> }) | null;
    followActiveChild: boolean;
    followActivePaused: boolean;
    setFollowActiveChild: Setter<boolean>;
    setGraphScopedModel: Setter<{ nodes: GraphNodeLike[]; edges: GraphEdgeLike[]; scope: string }>;
    setGraphBottomTab: Setter<"timeline" | "artifacts">;
    updateGraphPlayback: (patch: Partial<{ isPlaying: boolean; cursor: number; speed: number; mode: "timeline" | "path" }>) => void;
    graphBottomTab: "timeline" | "artifacts";
    graphBubbleAggregateId: string;
    graphDetailsOpen: boolean;
    graphState: Record<string, unknown>;
    graphScreenshotsById: Record<string, unknown>;
    graphActiveChildId: string;
    graphDetailChildId: string;
    graphSelectedEvent: unknown;
    childAttemptById: Record<string, string | number>;
    childScopeEvents: unknown[];
    childScopeProgress: unknown[];
    artifactReplayMode: boolean;
    runInspector: unknown;
    activeRunId: string;
  };
  layout: {
    tests: {
      ref: React.RefObject<HTMLDivElement | null>;
      detailsInline: boolean;
      suitesMinPx: number;
      casesMinPx: number;
      detailsMinPx: number;
      overlayDetailsMaxWidth: number;
    };
    graph: {
      ref: React.RefObject<HTMLDivElement | null>;
      canInlineDetails: boolean;
      centerMinPx: number;
      dividerPx: number;
      rightMinPx: number;
      rightWidthClamped: number;
      startDividerDrag: (e: React.PointerEvent) => void;
    };
    main: {
      artifactsHeight: number;
    } & Record<string, unknown>;
    mainDividerPx: number;
    overlayDetailsMinPx: number;
    startDrag: (axis: "v1" | "v2" | "ov" | "h", e: React.PointerEvent) => void;
  };
  ui: {
    setShowUtilityMenu: Setter<boolean>;
    showUtilityMenu: boolean;
    setDrawerOpen: Setter<boolean>;
    drawerOpen: boolean;
    runHistoryCollapsed: boolean;
    setRunHistoryCollapsed: Setter<boolean>;
    showArtifactsPopoverFor: string | null;
    setShowArtifactsPopoverFor: Setter<string | null>;
  };
};

export function useAppShellViewModel({ chrome, runOps, tests, testsActions, graph, layout, ui }: UseAppShellViewModelInput) {
  const detailsSelectedCase = useMemo(
    () => toDetailsSelectedCase(chrome.tab, graph.graphDetailsNode, graph.graphDetailChildId, tests.selectedCase),
    [chrome.tab, graph.graphDetailsNode, graph.graphDetailChildId, tests.selectedCase]
  );

  const topBar = useMemo(
    () => ({
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
      onStop: (mode: "after_current" | "terminate_workers") => void runOps.handleStop(mode),
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
    }),
    [chrome, runOps, tests.activeFilterCount, testsActions, ui]
  );

  const testsView = useMemo(
    () => ({
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
      setAggregateFilterIds: (ids: string[]) => {
        tests.setAggregateFilterIds(ids);
        if (Array.isArray(ids) && ids.length === 0) {
          graph.setFollowActiveChild(false);
          graph.setFollowActivePaused(false);
          graph.setGraphBubbleAggregateId("");
          graph.setManualGraphChildId("");
          graph.setGraphScopedModel({ nodes: [], edges: [], scope: "suite" });
          graph.setGraphScope({ level: "suite", aggregateId: "", childId: "" });
          graph.setGraphState((prev) => ({ ...prev, selectedNodeId: "" }));
        }
      },
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
    }),
    [tests, testsActions, runOps, layout, ui, detailsSelectedCase, chrome.bridge, chrome.logs, graph.runInspector]
  );

  const graphActions = useMemo(
    () => ({
      setStatusFilters: (filters: string[]) => graph.setGraphState((prev) => ({ ...prev, statusFilters: filters })),
      selectNode: graph.selectGraphNode,
      selectInlineChild: (childId: string, aggregateId: string) => {
        const canonicalChild = normalizeChildSelectionId(aggregateId, childId);
        tests.setAggregateFilterIds([aggregateId]);
        graph.setGraphSelectedRunTargetId(canonicalChild);
        graph.setGraphState((prev) => ({ ...prev, selectedNodeId: canonicalChild }));
        graph.setManualGraphChildId(canonicalChild);
        graph.setGraphScope({ level: "child", aggregateId, childId: canonicalChild });
        graph.setFollowActivePaused(true);
        graph.setGraphDetailsOpen(true);
      },
      enterAggregate: (aggregateId: string) => {
        if (!aggregateId) return;
        tests.setAggregateFilterIds([aggregateId]);
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
      openDetails: () => graph.setGraphDetailsOpen(Boolean(graph.graphDetailsNode)),
      closeDetails: () => graph.setGraphDetailsOpen(false),
      toggleFollow: () => {
        if (graph.followActiveChild && graph.followActivePaused) {
          graph.setFollowActivePaused(false);
        } else {
          graph.setFollowActiveChild((v) => !v);
          graph.setFollowActivePaused(false);
        }
      },
      pauseFollow: () => graph.setFollowActivePaused(true),
      setScopedGraph: (next: { nodes: GraphNodeLike[]; edges: GraphEdgeLike[]; scope: string } | null) =>
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
      setHighlightMode: (mode: "upstream" | "downstream" | "both" | "none") =>
        graph.setGraphState((prev) => ({ ...prev, highlightMode: mode, manualOverride: true })),
      setBottomTab: graph.setGraphBottomTab,
      setAggregateFilterIds: tests.setAggregateFilterIds,
      playback: graph.updateGraphPlayback,
      backScope: () => {
        graph.setFollowActivePaused(true);
        graph.setGraphScope((prev) => {
          if (prev.level === "child") {
            if (prev.aggregateId) tests.setAggregateFilterIds([prev.aggregateId]);
            return { level: "aggregate", aggregateId: prev.aggregateId, childId: "" };
          }
          tests.setAggregateFilterIds([]);
          return { level: "suite", aggregateId: "", childId: "" };
        });
      },
      selectChild: (childId: string) => {
        if (!childId) return;
        const canonicalChild = normalizeChildSelectionId(graph.graphDetailsNode?.id || "", childId);
        const aggregateId = String(graph.graphDetailsNode?.id || "");
        if (aggregateId) tests.setAggregateFilterIds([aggregateId]);
        graph.setFollowActivePaused(true);
        graph.setGraphSelectedRunTargetId(canonicalChild);
        graph.setGraphState((prev) => ({ ...prev, selectedNodeId: canonicalChild }));
        graph.setManualGraphChildId(canonicalChild);
        graph.setGraphScope({ level: "child", aggregateId, childId: canonicalChild });
        tests.setSelectedCaseId(canonicalChild);
        const testId = String(canonicalChild).split("::")[0] || "";
        if (testId) tests.setSelectedTestId(testId);
      },
      selectEvent: (event: { id?: string; nodeId?: string }, index: number) => {
        graph.setGraphState((prev) => ({
          ...prev,
          selectedEventId: event?.id || "",
          selectedNodeId: event?.nodeId || prev.selectedNodeId,
          playback: { ...(prev.playback as Record<string, unknown>), mode: "timeline", cursor: index, isPlaying: false },
        }));
      },
      selectRunDetails: (runId: string | null) => runOps.handleSelectRun(runId, { scope: false }),
      selectRunHistory: (runId: string | null) => runOps.handleSelectRun(runId, { scope: Boolean(runId) }),
      openRun: ({ runId }: { runId?: string }) => {
        if (runId) runOps.handleSelectRun(runId, { scope: true });
        chrome.setTab("tests");
        ui.setDrawerOpen(true);
      },
    }),
    [graph, tests, runOps, chrome.setTab, ui]
  );

  const graphView = useMemo(
    () => ({
      layout: {
        ref: layout.graph.ref,
        canInlineDetails: layout.graph.canInlineDetails,
        centerMinPx: layout.graph.centerMinPx,
        dividerPx: layout.graph.dividerPx,
        rightMinPx: layout.graph.rightMinPx,
        rightWidthClamped: layout.graph.rightWidthClamped,
        detailsOpen: graph.graphDetailsOpen,
        startDividerDrag: layout.graph.startDividerDrag,
        main: layout.main,
        startDrag: layout.startDrag,
      },
      graph: {
        state: graph.graphState,
        nodes: graph.graphNodesWithPlayback,
        scope: graph.graphScope,
        bottomTab: graph.graphBottomTab,
        bubbleId: graph.graphBubbleAggregateId,
        detailsNode: graph.graphDetailsNode,
        detailsSelectedCase,
        selectedEvent: graph.graphSelectedEvent,
        screenshotsById: graph.graphScreenshotsById,
        activeChildId: graph.graphActiveChildId,
        detailChildId: graph.graphDetailChildId,
        activeRunId: graph.activeRunId,
        selectedRunId: tests.selectedRunId,
        childAttemptById: graph.childAttemptById,
        waitingFirstEvent: chrome.waitingFirstEvent,
        artifactReplayMode: graph.artifactReplayMode,
        childScopeEvents: graph.childScopeEvents,
        childScopeProgress: graph.childScopeProgress,
        aggregateFilterIds: tests.aggregateFilterIds,
        aggregateFilterOptions: tests.aggregateFilterOptions,
        aggregateScopedSuites: tests.aggregateScopedSuites,
        selectedSuiteId: tests.selectedSuiteId,
        selectedTestId: tests.selectedTestId,
        follow: graph.followActiveChild && !graph.followActivePaused,
        runInspector: graph.runInspector,
        bridge: chrome.bridge,
        tests: tests.tests,
        statusById: tests.statusById,
        runs: tests.runs,
        logs: chrome.logs,
      },
      actions: graphActions,
      runHistory: {
        collapsed: ui.runHistoryCollapsed,
        setCollapsed: ui.setRunHistoryCollapsed,
        heightPx: layout.main.artifactsHeight,
        onStartResize: (e) => layout.startDrag("h", e),
        runs: tests.runs,
        showArtifactsPopoverFor: ui.showArtifactsPopoverFor,
        setShowArtifactsPopoverFor: ui.setShowArtifactsPopoverFor,
        bridge: chrome.bridge,
        selectedRunId: tests.selectedRunId,
        onSelectRun: graphActions.selectRunHistory,
      },
    }),
    [layout, graph, tests, chrome, ui, detailsSelectedCase, graphActions]
  );

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
