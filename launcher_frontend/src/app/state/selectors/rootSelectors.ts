import type { RefObject } from "react";
import type { Setter, BridgeApi } from "../../types/common";
import type { RunRow, StatusRow, TestRow } from "../../types/contracts";
import type { GraphEdgeLike, GraphNodeLike, GraphScope } from "../../../components/graph/graphTypes";
import type { RunEvent } from "../../../lib/graph/types";

type SelectorState = {
  ui?: {
    tab?: string;
    showIssuesDrawer?: boolean;
  };
  run?: {
    waitingFirstEvent?: boolean;
    liveMode?: boolean;
    loadingRun?: boolean;
    previewLine?: string;
    previewBusy?: boolean;
    selectedRunId?: string | null;
    activeRunId?: string;
  };
  data?: {
    tests?: TestRow[];
    runs?: RunRow[];
    statusById?: Record<string, StatusRow>;
  };
  selection?: {
    search?: string;
    tag?: string;
    kind?: string;
    outcome?: string;
    aggregateFilterIds?: string[];
    selectedSuiteId?: string;
    selectedTestId?: string;
    selectedCaseId?: string;
    selectedCaseIds?: Set<string>;
    collapsedSuites?: Record<string, boolean>;
  };
  refs?: {
    searchRef?: RefObject<HTMLInputElement | null>;
  };
  graph?: {
    graphDetailsOpen?: boolean;
    graphState?: Record<string, unknown>;
    setGraphState?: Setter<Record<string, unknown>>;
    childScopeEvents?: RunEvent[];
    setGraphSelectedRunTargetId?: Setter<string>;
    setManualGraphChildId?: Setter<string>;
    setFollowActivePaused?: Setter<boolean>;
    setGraphDetailsOpen?: Setter<boolean>;
    graphScope?: GraphScope;
    setGraphScope?: Setter<GraphScope>;
    setGraphBubbleAggregateId?: Setter<string>;
    followActiveChild?: boolean;
    followActivePaused?: boolean;
    setFollowActiveChild?: Setter<boolean>;
    graphScopedModel?: { nodes: GraphNodeLike[]; edges: GraphEdgeLike[]; scope: string };
    setGraphScopedModel?: Setter<{ nodes: GraphNodeLike[]; edges: GraphEdgeLike[]; scope: string }>;
    setGraphBottomTab?: Setter<"timeline" | "artifacts">;
    graphBottomTab?: "timeline" | "artifacts";
    graphBubbleAggregateId?: string;
  };
  layout?: {
    graphLayoutRef?: RefObject<HTMLDivElement | null>;
    graphCanInlineDetails?: boolean;
    graphRightWidthClamped?: number;
  };
};

type SelectorDerived = {
  bridge?: BridgeApi | null;
  bridgeError?: unknown;
  startup?: unknown;
  logs?: string;
  hasPausedRun?: boolean;
  anyRunActive?: boolean;
  idsForRun?: (scope: "selected" | "all") => string[];
  latestRun?: RunRow | null;
  suites?: Array<{ suiteId: string; suiteName: string; cases: TestRow[] }>;
  aggregateScopedSuites?: Array<{ suiteId: string; suiteName: string; cases: TestRow[] }>;
  visibleCases?: TestRow[];
  selectedCase?: TestRow | null;
  triageActive?: boolean;
  activeFilterCount?: number;
  aggregateFilterOptions?: Array<{ id: string; name: string; total?: number }>;
  childAttemptById?: Record<string, string | number>;
  artifactReplayMode?: boolean;
  childScopeProgress?: unknown[];
  selectGraphNode?: (nodeId: string) => void;
  updateGraphPlayback?: (patch: Partial<{ isPlaying: boolean; cursor: number; speed: number; mode: "timeline" | "path" }>) => void;
  graphDetailsNode?: GraphNodeLike | null;
  graphActiveChildId?: string;
  graphDetailChildId?: string;
  graphSelectedEvent?: RunEvent | null;
  graphScreenshotsById?: Record<string, unknown>;
  graphNodesWithPlayback?: GraphNodeLike[];
  runInspector?: unknown;
};

type SelectorActions = {
  ui?: {
    setTab?: Setter<string>;
    setShowIssuesDrawer?: Setter<boolean>;
  };
  run?: {
    setLiveMode?: Setter<boolean>;
    handleRun?: (ids?: string[], options?: { resumePaused?: boolean }) => Promise<void> | void;
    handlePauseRun?: () => Promise<void> | void;
    handlePreview?: () => Promise<void> | void;
    handleManualRefresh?: () => Promise<void> | void;
    handleStop?: (mode: "after_current" | "terminate_workers") => Promise<void> | void;
    copyLogs?: () => Promise<void> | void;
    copyDiagnostics?: () => Promise<void> | void;
    handleClearState?: () => Promise<void> | void;
    handleClearCache?: () => Promise<void> | void;
    handleSelectRun?: (runId: string | null, options?: { scope?: boolean }) => void;
  };
  selection?: {
    setSearch?: Setter<string>;
    setTag?: Setter<string>;
    setKind?: Setter<string>;
    setOutcome?: Setter<string>;
    setAggregateFilterIds?: Setter<string[]>;
    setSelectedSuiteId?: Setter<string>;
    setSelectedTestId?: Setter<string>;
    setSelectedCaseId?: Setter<string>;
    setSelectedCaseIds?: Setter<Set<string>>;
    setCollapsedSuites?: Setter<Record<string, boolean>>;
  };
};

export function selectChromeInput(state: SelectorState, derived: SelectorDerived, actions: SelectorActions) {
  return {
    bridge: derived?.bridge,
    bridgeError: derived?.bridgeError,
    startup: derived?.startup,
    logs: derived?.logs,
    tab: state?.ui?.tab,
    waitingFirstEvent: state?.run?.waitingFirstEvent,
    liveMode: state?.run?.liveMode,
    setTab: actions?.ui?.setTab,
    setShowIssuesDrawer: actions?.ui?.setShowIssuesDrawer,
    showIssuesDrawer: state?.ui?.showIssuesDrawer,
    setLiveMode: actions?.run?.setLiveMode,
  };
}

export function selectRunOpsInput(state: SelectorState, derived: SelectorDerived, actions: SelectorActions) {
  return {
    loadingRun: state?.run?.loadingRun,
    previewLine: state?.run?.previewLine,
    previewBusy: state?.run?.previewBusy,
    hasPausedRun: derived?.hasPausedRun,
    anyRunActive: derived?.anyRunActive,
    handleRun: actions?.run?.handleRun,
    idsForRun: derived?.idsForRun,
    handlePauseRun: actions?.run?.handlePauseRun,
    handlePreview: actions?.run?.handlePreview,
    handleManualRefresh: actions?.run?.handleManualRefresh,
    handleStop: actions?.run?.handleStop,
    copyLogs: actions?.run?.copyLogs,
    copyDiagnostics: actions?.run?.copyDiagnostics,
    handleClearState: actions?.run?.handleClearState,
    handleClearCache: actions?.run?.handleClearCache,
    handleSelectRun: actions?.run?.handleSelectRun,
  };
}

export function selectTestsInput(state: SelectorState, derived: SelectorDerived, actions: SelectorActions) {
  return {
    tests: state?.data?.tests,
    runs: state?.data?.runs,
    statusById: state?.data?.statusById,
    latestRun: derived?.latestRun,
    suites: derived?.suites,
    aggregateScopedSuites: derived?.aggregateScopedSuites,
    visibleCases: derived?.visibleCases,
    selectedCase: derived?.selectedCase,
    triageActive: derived?.triageActive,
    activeFilterCount: derived?.activeFilterCount,
    aggregateFilterOptions: derived?.aggregateFilterOptions,
    searchRef: state?.refs?.searchRef,
    search: state?.selection?.search,
    setSearch: actions?.selection?.setSearch,
    tag: state?.selection?.tag,
    setTag: actions?.selection?.setTag,
    kind: state?.selection?.kind,
    setKind: actions?.selection?.setKind,
    outcome: state?.selection?.outcome,
    setOutcome: actions?.selection?.setOutcome,
    aggregateFilterIds: state?.selection?.aggregateFilterIds,
    setAggregateFilterIds: actions?.selection?.setAggregateFilterIds,
    selectedSuiteId: state?.selection?.selectedSuiteId,
    setSelectedSuiteId: actions?.selection?.setSelectedSuiteId,
    selectedTestId: state?.selection?.selectedTestId,
    setSelectedTestId: actions?.selection?.setSelectedTestId,
    selectedCaseId: state?.selection?.selectedCaseId,
    setSelectedCaseId: actions?.selection?.setSelectedCaseId,
    selectedCaseIds: state?.selection?.selectedCaseIds,
    setSelectedCaseIds: actions?.selection?.setSelectedCaseIds,
    selectedRunId: state?.run?.selectedRunId,
    collapsedSuites: state?.selection?.collapsedSuites,
    setCollapsedSuites: actions?.selection?.setCollapsedSuites,
  };
}

export function selectGraphInput(state: SelectorState, derived: SelectorDerived, actions: SelectorActions) {
  return {
    graphLayoutRef: state?.layout?.graphLayoutRef,
    graphCanInlineDetails: state?.layout?.graphCanInlineDetails,
    graphRightWidthClamped: state?.layout?.graphRightWidthClamped,
    graphDetailsOpen: state?.graph?.graphDetailsOpen,
    graphState: state?.graph?.graphState,
    setGraphState: state?.graph?.setGraphState,
    activeRunId: state?.run?.activeRunId,
    childAttemptById: derived?.childAttemptById,
    artifactReplayMode: derived?.artifactReplayMode,
    childScopeEvents: state?.graph?.childScopeEvents,
    childScopeProgress: derived?.childScopeProgress,
    selectGraphNode: derived?.selectGraphNode,
    setGraphSelectedRunTargetId: state?.graph?.setGraphSelectedRunTargetId,
    setManualGraphChildId: state?.graph?.setManualGraphChildId,
    setFollowActivePaused: state?.graph?.setFollowActivePaused,
    setGraphDetailsOpen: state?.graph?.setGraphDetailsOpen,
    graphScope: state?.graph?.graphScope,
    setGraphScope: state?.graph?.setGraphScope,
    setGraphBubbleAggregateId: state?.graph?.setGraphBubbleAggregateId,
    followActiveChild: state?.graph?.followActiveChild,
    followActivePaused: state?.graph?.followActivePaused,
    setFollowActiveChild: state?.graph?.setFollowActiveChild,
    graphScopedModel: state?.graph?.graphScopedModel,
    setGraphScopedModel: state?.graph?.setGraphScopedModel,
    updateGraphPlayback: derived?.updateGraphPlayback,
    setGraphBottomTab: state?.graph?.setGraphBottomTab,
    graphBottomTab: state?.graph?.graphBottomTab,
    graphBubbleAggregateId: state?.graph?.graphBubbleAggregateId,
    graphDetailsNode: derived?.graphDetailsNode,
    graphActiveChildId: derived?.graphActiveChildId,
    graphDetailChildId: derived?.graphDetailChildId,
    graphSelectedEvent: derived?.graphSelectedEvent,
    graphScreenshotsById: derived?.graphScreenshotsById,
    graphNodesWithPlayback: derived?.graphNodesWithPlayback,
    runInspector: derived?.runInspector,
  };
}
