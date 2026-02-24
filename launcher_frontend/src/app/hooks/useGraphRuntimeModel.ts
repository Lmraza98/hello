import { useMemo } from "react";
import { deriveDagWalkPlaybackState } from "../../lib/graph/playback/GraphPlaybackEngine";
import { derivePlaybackStatus } from "../../lib/graph/buildGraphModel";
import { canonicalChildId, createIdsForRun } from "../utils/ids";
import type { GraphEdgeLike, GraphNodeLike, GraphPathStep, GraphScope, GraphTransition } from "../../components/graph/graphTypes";
import type { RunEvent } from "../../lib/graph/types";
import type { ChildProgressRow, RunRow, StatusRow, TestRow } from "../types/contracts";

type GraphRuntimeState = {
  nodes: GraphNodeLike[];
  edges: GraphEdgeLike[];
  events: RunEvent[];
  screenshots: Array<{ id: string; [key: string]: unknown }>;
  selectedNodeId: string;
  selectedEventId: string;
  playback?: {
    mode?: "timeline" | "path";
    transitions?: GraphTransition[];
    pathSteps?: GraphPathStep[];
    cursor?: number;
    isPlaying?: boolean;
  };
};

type GraphScopedModel = {
  nodes: GraphNodeLike[];
  edges: GraphEdgeLike[];
  scope: string;
};

type StatusRowLike = StatusRow & {
  attempt?: number | string | null;
  lastRun?: number | string | null;
};

type AggregateScopedSuite = {
  cases: Array<{ id?: string }>;
};

export type UseGraphRuntimeModelParams = {
  graphState: GraphRuntimeState;
  graphScopedModel: GraphScopedModel;
  selectedRunId: string | null;
  activeRunId: string;
  runs: RunRow[];
  graphScope: GraphScope;
  followActiveChild: boolean;
  followActivePaused: boolean;
  manualGraphChildId: string;
  statusById: Record<string, StatusRowLike>;
  tests: TestRow[];
  childScopeEvents: RunEvent[];
  childProgressByParent: Record<string, ChildProgressRow[]>;
  graphSelectedRunTargetId: string;
  selectedCaseId: string;
  selectedCaseIds: Set<string>;
  selectedTestId: string;
  aggregateScopedSuites: AggregateScopedSuite[];
};

export function useGraphRuntimeModel(params: UseGraphRuntimeModelParams) {
  const {
    graphState,
    graphScopedModel,
    selectedRunId,
    activeRunId,
    runs,
    graphScope,
    followActiveChild,
    followActivePaused,
    manualGraphChildId,
    statusById,
    tests,
    childScopeEvents,
    childProgressByParent,
    graphSelectedRunTargetId,
    selectedCaseId,
    selectedCaseIds,
    selectedTestId,
    aggregateScopedSuites,
  } = params;
  const safeStatusById = (statusById || {}) as Record<string, StatusRowLike>;

  const graphScreenshotsById = useMemo(() => {
    const map = {};
    (graphState.screenshots || []).forEach((shot) => {
      map[shot.id] = shot;
    });
    return map;
  }, [graphState.screenshots]);
  const pathPlaybackState = useMemo(
    () =>
      deriveDagWalkPlaybackState({
        nodes: graphState.nodes || [],
        edges: graphState.edges || [],
        transitions: graphState.playback?.transitions || [],
        pathSteps: graphState.playback?.pathSteps || [],
        pathCursor: graphState.playback?.cursor || 0,
      }),
    [graphState.nodes, graphState.edges, graphState.playback?.transitions, graphState.playback?.pathSteps, graphState.playback?.cursor]
  );
  const playbackStatuses = useMemo(() => {
    const mode = graphState.playback?.mode || "timeline";
    if (mode !== "path") return derivePlaybackStatus(graphState.nodes || [], graphState.events || [], graphState.playback?.cursor || 0);
    const out = {};
    (graphState.nodes || []).forEach((node) => {
      const nodeId = String(node?.id || "");
      if (!nodeId) return;
      if (pathPlaybackState.completed.has(nodeId)) out[nodeId] = "passed";
      else if (pathPlaybackState.running.has(nodeId)) out[nodeId] = "running";
      else if (pathPlaybackState.blocked.has(nodeId)) out[nodeId] = "blocked";
      else out[nodeId] = "not_run";
    });
    const activeTr = pathPlaybackState.activeTransition;
    if (activeTr?.kind === "failed" && activeTr.nodeId) out[activeTr.nodeId] = "failed";
    return out;
  }, [graphState.playback?.mode, graphState.nodes, graphState.events, graphState.playback?.cursor, pathPlaybackState]);
  const playbackOverrideEnabled = Boolean(graphState.playback?.isPlaying);
  const graphNodesWithPlayback = useMemo(
    () =>
      (graphState.nodes || []).map((node) => ({
        ...node,
        status: playbackOverrideEnabled ? (playbackStatuses[node.id] || node.status || "not_run") : (node.status || "not_run"),
      })),
    [graphState.nodes, playbackStatuses, playbackOverrideEnabled]
  );
  const graphScopedNodes = useMemo(
    () => (Array.isArray(graphScopedModel?.nodes) ? graphScopedModel.nodes : []),
    [graphScopedModel]
  );
  const graphScopedNodeById = useMemo(() => {
    const map = new Map();
    (graphScopedNodes || []).forEach((node) => {
      const id = String(node?.id || "");
      if (!id) return;
      map.set(id, node);
    });
    return map;
  }, [graphScopedNodes]);
  const selectedRunRow = useMemo(() => {
    const rid = String(selectedRunId || "");
    if (!rid) return null;
    return runs.find((r) => String(r?.run_id || "") === rid) || null;
  }, [runs, selectedRunId]);
  const selectedRunIsActive = useMemo(() => {
    const status = String(selectedRunRow?.status || "").toLowerCase();
    return status === "running" || status === "queued" || status === "retrying";
  }, [selectedRunRow]);
  const artifactReplayMode = Boolean(selectedRunId) && !selectedRunIsActive;
  const suppressLiveGraphAutotrack = artifactReplayMode || Boolean(graphState.playback?.isPlaying);
  const graphSelectedNode = useMemo(
    () =>
      graphScopedNodeById.get(String(graphState.selectedNodeId || "")) ||
      graphNodesWithPlayback.find((node) => node.id === graphState.selectedNodeId) ||
      null,
    [graphScopedNodeById, graphNodesWithPlayback, graphState.selectedNodeId]
  );
  const playbackActiveNodeId = useMemo(() => {
    const mode = graphState.playback?.mode || "timeline";
    const cursor = Number(graphState.playback?.cursor || 0);
    if (mode === "path") {
      const steps = graphState.playback?.pathSteps || [];
      const step = steps[cursor] || null;
      return String(step?.focusNodeId || "");
    }
    const events = graphState.events || [];
    const event = events[cursor] || null;
    return String(event?.nodeId || "");
  }, [graphState.playback?.mode, graphState.playback?.cursor, graphState.playback?.pathSteps, graphState.events]);
  const activeAggregateNode = useMemo(() => {
    if (graphScope?.level === "child") {
      const aggregateId = String(graphScope?.aggregateId || "");
      if (!aggregateId) return null;
      return graphNodesWithPlayback.find((node) => node.id === aggregateId) || null;
    }
    if (graphSelectedNode?.aggregateSummary) return graphSelectedNode;
    return null;
  }, [graphScope, graphSelectedNode, graphNodesWithPlayback]);
  const activeRunGraphNode = useMemo(() => {
    const runId = String(selectedRunId || activeRunId || "");
    const runRow = runId
      ? (runs.find((r) => String(r?.run_id || "") === runId) || null)
      : ((runs.find((r) => ["running", "queued", "retrying"].includes(String(r?.status || "").toLowerCase())) || runs[0] || null));
    const testsInRun = Array.isArray(runRow?.tests) ? runRow.tests : [];
    const statusRank = { running: 0, retrying: 1, queued: 2 };
    const activeTest = [...testsInRun]
      .filter((row) => Object.prototype.hasOwnProperty.call(statusRank, String(row?.status || "").toLowerCase()))
      .sort((a, b) => {
        const ar = statusRank[String(a?.status || "").toLowerCase()] ?? 99;
        const br = statusRank[String(b?.status || "").toLowerCase()] ?? 99;
        if (ar !== br) return ar - br;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      })[0];
    const activeId = String(activeTest?.id || "");
    if (activeId) {
      const fromRun = graphNodesWithPlayback.find((n) => String(n?.id || "") === activeId) || null;
      if (fromRun) return fromRun;
    }
    const fallback = graphNodesWithPlayback.find((n) => ["running", "retrying", "queued"].includes(String(n?.status || "").toLowerCase())) || null;
    return fallback;
  }, [selectedRunId, activeRunId, runs, graphNodesWithPlayback]);
  const graphDetailsNode = useMemo(() => {
    const scopeLevel = String(graphScope?.level || "suite");
    if (!suppressLiveGraphAutotrack && followActiveChild && !followActivePaused && activeRunGraphNode) return activeRunGraphNode;
    const manualChildId = String(manualGraphChildId || "");
    if (manualChildId) {
      const manualScopedNode = graphScopedNodeById.get(manualChildId) || null;
      const manualGlobalNode = graphNodesWithPlayback.find((n) => String(n?.id || "") === manualChildId) || null;
      const manualNode = manualScopedNode || manualGlobalNode;
      if (manualNode && String(manualNode?.id || "").includes("::")) return manualNode;
    }
    const selectedId = String(graphState.selectedNodeId || "");
    const selectedScopedNode = graphScopedNodeById.get(selectedId) || null;
    const selectedGlobalNode = graphNodesWithPlayback.find((n) => String(n?.id || "") === selectedId) || null;
    const selectedNodeAny = selectedScopedNode || selectedGlobalNode;
    if (selectedNodeAny && String(selectedNodeAny?.id || "").includes("::")) return selectedNodeAny;
    if (scopeLevel === "child") {
      const selectedChildNode = selectedNodeAny;
      if (selectedChildNode && String(selectedChildNode?.id || "").includes("::")) return selectedChildNode;
      const scopedChildId = String(graphScope?.childId || "");
      const scopedChildNode = graphScopedNodeById.get(scopedChildId) || null;
      if (scopedChildNode && String(scopedChildNode?.id || "").includes("::")) return scopedChildNode;
      const aid = String(graphScope?.aggregateId || "");
      return graphNodesWithPlayback.find((n) => String(n?.id || "") === aid) || activeAggregateNode || graphSelectedNode || null;
    }
    if (scopeLevel === "aggregate") {
      const aid = String(graphScope?.aggregateId || "");
      return graphNodesWithPlayback.find((n) => String(n?.id || "") === aid) || activeAggregateNode || graphSelectedNode || null;
    }
    if (!suppressLiveGraphAutotrack && followActiveChild && !followActivePaused && activeAggregateNode?.aggregateSummary) return activeAggregateNode;
    return graphSelectedNode || activeAggregateNode || null;
  }, [
    graphScope,
    graphState.selectedNodeId,
    manualGraphChildId,
    graphNodesWithPlayback,
    graphScopedNodeById,
    activeAggregateNode,
    graphSelectedNode,
    followActiveChild,
    followActivePaused,
    activeRunGraphNode,
    suppressLiveGraphAutotrack,
  ]);
  const detailsAggregateNode = useMemo(
    () => (graphDetailsNode?.aggregateSummary && Array.isArray(graphDetailsNode?.aggregateChildren) ? graphDetailsNode : null),
    [graphDetailsNode]
  );
  const graphActiveChildId = useMemo(() => {
    const summary = detailsAggregateNode?.aggregateSummary;
    if (!summary) return "";
    return String(summary.activeChildId || "");
  }, [detailsAggregateNode]);
  const graphDetailChildId = useMemo(() => {
    if (!detailsAggregateNode?.aggregateSummary) return "";
    if (followActiveChild && !followActivePaused) return canonicalChildId(detailsAggregateNode.id, graphActiveChildId);
    return canonicalChildId(detailsAggregateNode.id, manualGraphChildId || graphActiveChildId);
  }, [detailsAggregateNode, followActiveChild, followActivePaused, manualGraphChildId, graphActiveChildId]);
  const graphSelectedEvent = useMemo(
    () => (graphState.events || []).find((ev) => ev.id === graphState.selectedEventId) || null,
    [graphState.events, graphState.selectedEventId]
  );
  const childAttemptById = useMemo(() => {
    const out = {};
    const rawToCanonical = {};
    (tests || []).forEach((row) => {
      const parentId = String(row?.id || "");
      const children = Array.isArray(row?.children) ? row.children : [];
      children.forEach((child) => {
        const raw = String(child?.id || child?.nodeid || child?.name || "");
        if (!raw || !parentId) return;
        rawToCanonical[raw] = canonicalChildId(parentId, raw);
      });
    });
    Object.entries(safeStatusById).forEach(([id, row]) => {
      if (!row || row.attempt == null) return;
      const key = String(id || "");
      if (rawToCanonical[key]) {
        out[rawToCanonical[key]] = row.attempt;
        return;
      }
      if (key.includes("::")) out[key] = row.attempt;
    });
    return out;
  }, [safeStatusById, tests]);
  const activeProgressParentId = useMemo(() => {
    if (graphScope?.level === "child") return String(graphScope?.aggregateId || "");
    if (detailsAggregateNode?.aggregateChildren?.length) return String(detailsAggregateNode.id || "");
    return "";
  }, [graphScope, detailsAggregateNode]);
  const activeChildProgressRows = useMemo(
    () => (activeProgressParentId ? (childProgressByParent[activeProgressParentId] || []) : []),
    [childProgressByParent, activeProgressParentId]
  );
  const childScopeProgress = activeChildProgressRows;
  const runInspector = useMemo(() => {
    const runId = String(selectedRunId || activeRunId || "");
    const run = runs.find((r) => String(r.run_id || "") === runId) || runs[0] || null;
    const aggregateId = String(activeProgressParentId || graphScope?.aggregateId || detailsAggregateNode?.id || "");
    const childId = String(graphScope?.childId || "");
    const rawChildId = childId.includes("::") ? childId.split("::").slice(1).join("::") : childId;
    const aggregateChildren = Array.isArray(detailsAggregateNode?.aggregateChildren) ? detailsAggregateNode.aggregateChildren : [];
    const canonicalChildIdsSet = new Set(aggregateChildren.map((c) => String(c.id || "")));
    const globalEvents = Array.isArray(graphState?.events) ? graphState.events : [];
    const childEvents = Array.isArray(childScopeEvents) ? childScopeEvents : [];
    const eventNodeIdsSet = new Set(globalEvents.map((ev) => String(ev?.nodeId || "")).filter(Boolean));
    const mismatched = Array.from(eventNodeIdsSet).filter((id) => !canonicalChildIdsSet.has(id));
    const runningProgress = (activeChildProgressRows || []).filter((row) => String(row?.status || "").toLowerCase() === "running").slice(0, 5);
    return {
      selectedContext: {
        runId,
        attemptId: childAttemptById?.[childId] ?? (safeStatusById[aggregateId]?.attempt ?? "latest"),
        selectedNodeId: graphState.selectedNodeId || "",
        graphScope,
      },
      modelIds: {
        aggregateNodeId: aggregateId,
        aggregateChildren: aggregateChildren.slice(0, 10).map((c) => ({ id: c.id, raw: c.rawChildKey || "" })),
      },
      runData: {
        testsCount: Array.isArray(run?.tests) ? run.tests.length : 0,
        testsSample: (Array.isArray(run?.tests) ? run.tests : []).slice(0, 5).map((t) => ({
          id: t?.id,
          status: t?.status,
          children: (Array.isArray(t?.children) ? t.children : []).slice(0, 5).map((ch) => ({ id: ch?.id || ch?.nodeid || ch?.name, status: ch?.status })),
        })),
      },
      progressSummary: {
        progressCount: activeChildProgressRows.length,
        runningSample: runningProgress.map((row) => ({ childId: row.childId, status: row.status })),
      },
      eventSummary: {
        total: globalEvents.length,
        childEventsCount: childEvents.length,
        withDoubleColon: globalEvents.filter((ev) => String(ev?.nodeId || "").includes("::")).length,
        equalsSelectedChild: globalEvents.filter((ev) => String(ev?.nodeId || "") === childId).length,
        equalsRawChild: globalEvents.filter((ev) => String(ev?.nodeId || "") === rawChildId).length,
        lastEvents: globalEvents.slice(-10).map((ev) => ({ ts: ev?.ts, type: ev?.type, nodeId: ev?.nodeId, message: ev?.message })),
      },
      mismatchDetector: {
        mismatchCount: mismatched.length,
        samples: mismatched.slice(0, 10),
      },
    };
  }, [selectedRunId, activeRunId, runs, graphScope, detailsAggregateNode, childScopeEvents, childAttemptById, graphState, activeProgressParentId, activeChildProgressRows, safeStatusById]);
  const activeRunRow = useMemo(() => {
    const rid = String(activeRunId || "");
    if (!rid) return null;
    return runs.find((r) => String(r?.run_id || "") === rid) || null;
  }, [runs, activeRunId]);
  const hasInFlightStatus = useMemo(
    () =>
      Object.values(safeStatusById).some((row) => {
        const st = String(row?.status || "").toLowerCase();
        return st === "running" || st === "queued" || st === "retrying";
      }),
    [safeStatusById]
  );
  const anyRunActive = useMemo(() => {
    const activeSet = new Set(["running", "queued", "retrying"]);
    if (activeRunId) {
      const row = runs.find((r) => String(r.run_id || "") === String(activeRunId));
      if (row) return activeSet.has(String(row.status || "").toLowerCase()) && hasInFlightStatus;
    }
    return false;
  }, [runs, activeRunId, hasInFlightStatus]);
  const idsForRun = useMemo(
    () =>
      createIdsForRun({
        tests,
        graphNodesWithPlayback,
        graphSelectedRunTargetId,
        graphScope,
        manualGraphChildId,
        graphDetailChildId,
        graphState,
        selectedCaseId,
        selectedCaseIds,
        selectedTestId,
        aggregateScopedSuites,
      }),
    [
      tests,
      graphNodesWithPlayback,
      graphSelectedRunTargetId,
      graphScope,
      manualGraphChildId,
      graphDetailChildId,
      graphState,
      selectedCaseId,
      selectedCaseIds,
      selectedTestId,
      aggregateScopedSuites,
    ]
  );

  return {
    graphScreenshotsById,
    pathPlaybackState,
    graphNodesWithPlayback,
    artifactReplayMode,
    suppressLiveGraphAutotrack,
    playbackActiveNodeId,
    activeAggregateNode,
    graphDetailsNode,
    detailsAggregateNode,
    graphActiveChildId,
    graphDetailChildId,
    graphSelectedEvent,
    childAttemptById,
    activeChildProgressRows,
    childScopeProgress,
    runInspector,
    activeRunRow,
    anyRunActive,
    idsForRun,
  };
}
