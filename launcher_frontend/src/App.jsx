import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, PanelLeft } from "lucide-react";
import BridgeState from "./components/BridgeState";
import HeaderBar from "./components/HeaderBar";
import TopActionsBar from "./components/TopActionsBar";
import FilterBar from "./components/FilterBar";
import SuitesPane from "./components/SuitesPane";
import CasesPane from "./components/CasesPane";
import DetailsPane from "./components/DetailsPane";
import TestDependencyGraph from "./components/graph/TestDependencyGraph";
import GraphErrorBoundary from "./components/GraphErrorBoundary";
import ArtifactsSection from "./components/ArtifactsSection";
import IssuesDrawer from "./components/IssuesDrawer";
import LogsPanel from "./components/LogsPanel";
import LastRunStrip from "./components/LastRunStrip";
import { usePywebviewBridge } from "./hooks/usePywebviewBridge";
import { filterSuites, groupSuites, visibleCases as selectVisibleCases } from "./lib/launcherSelectors";
import { buildGraphModel, derivePlaybackStatus } from "./lib/graph/buildGraphModel";
import { buildNodeTransitions } from "./lib/graph/playback/transitions";
import { buildPathSteps, deriveDagWalkPlaybackState, stepNextCursor } from "./lib/graph/playback/GraphPlaybackEngine";
import { Z_PANE, Z_GRAPH_UI } from "./lib/zIndex";

export default function App() {
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
  const layoutRef = useRef(null);
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
  const [followActiveChild, setFollowActiveChild] = useState(false);
  const [followActivePaused, setFollowActivePaused] = useState(false);
  const [manualGraphChildId, setManualGraphChildId] = useState("");
  const [loadingRun, setLoadingRun] = useState(false);
  const [liveMode, setLiveMode] = useState(true);
  const [activeRunId, setActiveRunId] = useState("");
  const [pausedRunState, setPausedRunState] = useState(null);
  const [lastRunUpdateTs, setLastRunUpdateTs] = useState(0);
  const [waitingFirstEvent, setWaitingFirstEvent] = useState(false);
  const [statusResetActive, setStatusResetActive] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [layout, setLayout] = useState({
    suites: 25,
    cases: 47,
    details: 28,
    detailsOverlayWidth: 520,
    artifactsHeight: 150,
    detailsCollapsed: false,
  });
  const [runHistoryCollapsed, setRunHistoryCollapsed] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [graphContainerWidth, setGraphContainerWidth] = useState(0);
  const [graphRightWidth, setGraphRightWidth] = useState(() => {
    try {
      const raw = Number(localStorage.getItem("launcher.graph.rightWidth") || "420");
      if (Number.isFinite(raw)) return raw;
    } catch {}
    return 420;
  });
  const [graphDrag, setGraphDrag] = useState(null);
  const [graphDetailsOpen, setGraphDetailsOpen] = useState(false);
  const [graphBottomTab, setGraphBottomTab] = useState("timeline");
  const [graphScope, setGraphScope] = useState({ level: "suite", aggregateId: "", childId: "" });
  const [graphBubbleAggregateId, setGraphBubbleAggregateId] = useState("");
  const [graphScopedModel, setGraphScopedModel] = useState({ nodes: [], edges: [], scope: "suite" });
  const [childScopeEvents, setChildScopeEvents] = useState([]);
  const [childProgressByParent, setChildProgressByParent] = useState({});
  const [graphState, setGraphState] = useState({
    nodes: [],
    edges: [],
    events: [],
    screenshots: [],
    selectedNodeId: "",
    selectedEventId: "",
    highlightMode: "both",
    playback: {
      isPlaying: false,
      cursor: 0,
      speed: 1,
      mode: "timeline",
      transitions: [],
      pathSteps: [],
      transitionCursor: -1,
      branchLockId: "",
    },
    manualOverride: false,
    statusFilters: [],
  });
  const graphAutoScopeDoneRef = useRef({});
  const runAutoTrackRef = useRef({ runId: "", aggregateId: "", engaged: false });
  const graphModelSigRef = useRef("");
  const missingSelectedRunRef = useRef(0);
  const graphBubbleTimerRef = useRef(null);
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

  useEffect(() => {
    return () => {
      if (graphBubbleTimerRef.current != null) {
        window.clearTimeout(graphBubbleTimerRef.current);
        graphBubbleTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (String(graphScope?.level || "suite") === "suite") return;
    if (graphBubbleTimerRef.current != null) {
      window.clearTimeout(graphBubbleTimerRef.current);
      graphBubbleTimerRef.current = null;
    }
    if (graphBubbleAggregateId) setGraphBubbleAggregateId("");
  }, [graphScope?.level, graphBubbleAggregateId]);

  function canonicalChildId(parentId, rawChildId) {
    const parent = String(parentId || "").trim();
    const raw = String(rawChildId || "").trim();
    if (!raw) return `${parent}::child`;
    if (raw.startsWith(`${parent}::`)) return raw;
    return `${parent}::${raw}`;
  }

  function isPytestGateAggregateId(aggregateId, nodes = []) {
    const id = String(aggregateId || "").toLowerCase();
    if (!id) return false;
    if (id === "backend-gate-pytest-ready") return true;
    if (id.includes("pytest") && id.includes("ready")) return true;
    const node = (nodes || []).find((n) => String(n?.id || "").toLowerCase() === id) || null;
    const name = String(node?.name || "").toLowerCase();
    return name.includes("pytest runtime ready");
  }

  function sameProgressRows(a, b) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      const x = left[i] || {};
      const y = right[i] || {};
      if (
        String(x.childId || "") !== String(y.childId || "") ||
        String(x.status || "") !== String(y.status || "") ||
        String(x.attemptId ?? "") !== String(y.attemptId ?? "") ||
        String(x.startedAt ?? "") !== String(y.startedAt ?? "") ||
        String(x.finishedAt ?? "") !== String(y.finishedAt ?? "") ||
        String(x.message || "") !== String(y.message || "")
      ) {
        return false;
      }
    }
    return true;
  }

  function readContainerSize() {
    const el = layoutRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }
    if (typeof window !== "undefined") {
      return { width: Math.max(0, window.innerWidth - 32), height: Math.max(0, window.innerHeight - 220) };
    }
    return { width: 0, height: 0 };
  }

  const suites = useMemo(() => groupSuites(tests), [tests]);
  const filteredSuites = useMemo(
    () => filterSuites({ suites, statusById, selectedSuiteId, tag, kind, outcome }),
    [suites, statusById, selectedSuiteId, tag, kind, outcome]
  );
  const runScopedSuites = useMemo(() => {
    if (!runScopeEnabled) return filteredSuites;
    if (!selectedRunId) return filteredSuites;
    const run = runs.find((r) => r.run_id === selectedRunId);
    if (!run) return filteredSuites;
    const caseIdSet = new Set(
      (filteredSuites || [])
        .flatMap((suite) => (Array.isArray(suite?.cases) ? suite.cases : []))
        .map((row) => String(row?.id || ""))
        .filter(Boolean)
    );
    const childToParent = new Map();
    (filteredSuites || []).forEach((suite) => {
      (Array.isArray(suite?.cases) ? suite.cases : []).forEach((row) => {
        const parentId = String(row?.id || "");
        if (!parentId) return;
        const children = Array.isArray(row?.children) ? row.children : [];
        children.forEach((child) => {
          const raw = String(child?.nodeid || child?.id || child?.name || "");
          if (!raw) return;
          childToParent.set(raw, parentId);
          childToParent.set(canonicalChildId(parentId, raw), parentId);
        });
      });
    });
    const resolved = new Set();
    const addResolved = (rawId) => {
      const id = String(rawId || "");
      if (!id) return;
      if (caseIdSet.has(id)) resolved.add(id);
      if (childToParent.has(id)) resolved.add(String(childToParent.get(id) || ""));
      if (id.includes("::")) {
        const root = String(id.split("::")[0] || "");
        if (caseIdSet.has(root)) resolved.add(root);
      }
    };
    if (Array.isArray(run.selected_test_ids)) run.selected_test_ids.forEach(addResolved);
    if (Array.isArray(run.selected_step_ids)) run.selected_step_ids.forEach(addResolved);
    if (Array.isArray(run.tests)) {
      run.tests.forEach((t) => {
        addResolved(t?.id);
        const children = Array.isArray(t?.children) ? t.children : [];
        children.forEach((child) => {
          const raw = String(child?.nodeid || child?.id || child?.name || "");
          if (!raw) return;
          addResolved(raw);
          addResolved(canonicalChildId(String(t?.id || ""), raw));
        });
      });
    }
    if (!resolved.size) return filteredSuites;
    const next = filteredSuites
      .map((suite) => ({ ...suite, cases: suite.cases.filter((row) => resolved.has(String(row?.id || ""))) }))
      .filter((suite) => suite.cases.length > 0);
    return next.length ? next : filteredSuites;
  }, [filteredSuites, runs, selectedRunId, runScopeEnabled]);
  const aggregateFilterOptions = useMemo(() => {
    const fromSuites = runScopedSuites
      .flatMap((suite) => suite.cases || [])
      .filter((row) => Array.isArray(row?.children) && row.children.length > 0)
      .map((row) => ({
        id: String(row?.id || ""),
        name: String(row?.name || row?.id || ""),
        total: Array.isArray(row?.children) ? row.children.length : undefined,
      }))
      .filter((row) => row.id);
    const uniq = new Map();
    fromSuites.forEach((row) => {
      if (!uniq.has(row.id)) uniq.set(row.id, row);
    });
    return Array.from(uniq.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [runScopedSuites]);
  useEffect(() => {
    if (!aggregateFilterIds.length) return;
    const allowed = new Set(aggregateFilterOptions.map((row) => row.id));
    const next = aggregateFilterIds.filter((id) => allowed.has(id));
    if (next.length !== aggregateFilterIds.length) setAggregateFilterIds(next);
  }, [aggregateFilterIds, aggregateFilterOptions]);
  useEffect(() => {
    if (graphBubbleAggregateId) setGraphBubbleAggregateId("");
  }, [aggregateFilterIds]);
  const aggregateScopedSuites = useMemo(() => {
    if (!aggregateFilterIds.length) return runScopedSuites;
    const selected = new Set(aggregateFilterIds);
    return runScopedSuites
      .map((suite) => ({
        ...suite,
        cases: (suite.cases || []).filter((row) => {
          const id = String(row?.id || "");
          for (const aid of selected) {
            if (id === aid || id.startsWith(`${aid}::`)) return true;
          }
          return false;
        }),
      }))
      .filter((suite) => Array.isArray(suite.cases) && suite.cases.length > 0);
  }, [runScopedSuites, aggregateFilterIds]);
  const visibleTestIds = useMemo(() => aggregateScopedSuites.flatMap((suite) => suite.cases.map((row) => row.id)), [aggregateScopedSuites]);
  const visibleCases = useMemo(() => selectVisibleCases(aggregateScopedSuites, selectedTestId, search), [aggregateScopedSuites, selectedTestId, search]);
  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null;
    return visibleCases.find((row) => row.id === selectedCaseId) || null;
  }, [visibleCases, selectedCaseId]);
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
      return String(step?.focusNodeId || step?.nodeId || "");
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
    Object.entries(statusById || {}).forEach(([id, row]) => {
      if (!row || row.attempt == null) return;
      const key = String(id || "");
      if (rawToCanonical[key]) {
        out[rawToCanonical[key]] = row.attempt;
        return;
      }
      if (key.includes("::")) out[key] = row.attempt;
    });
    return out;
  }, [statusById, tests]);
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
        attemptId: childAttemptById?.[childId] ?? (statusById[aggregateId]?.attempt ?? "latest"),
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
  }, [selectedRunId, activeRunId, runs, graphScope, detailsAggregateNode, childScopeEvents, childAttemptById, graphState, activeProgressParentId, activeChildProgressRows, statusById]);
  const rightPaneSigRef = useRef("");
  useEffect(() => {
    if (!runtimeDebug) return;
    const parentId = String(detailsAggregateNode?.id || "");
    const childId = String(graphDetailChildId || "");
    const runningRow = (activeChildProgressRows || []).find((row) => String(row?.status || "").toLowerCase() === "running");
    const runningChild = String(runningRow?.childId || "");
    const sig = `${parentId}|${childId}|${runningChild}|${followActiveChild}|${followActivePaused}`;
    if (rightPaneSigRef.current === sig) return;
    rightPaneSigRef.current = sig;
    console.warn("[graph] right-pane binding", {
      parentId,
      childId,
      runningChild,
      followActiveChild,
      followActivePaused,
      scope: graphScope,
    });
  }, [runtimeDebug, detailsAggregateNode, graphDetailChildId, activeChildProgressRows, followActiveChild, followActivePaused, graphScope]);

  useEffect(() => {
    if (!bridge || typeof bridge.get_child_events !== "function") {
      setChildScopeEvents([]);
      return;
    }
    if (tab !== "graph" || graphScope?.level !== "child") {
      setChildScopeEvents([]);
      return;
    }
    const runId = String(selectedRunId || activeRunId || "");
    const childId = String(graphScope?.childId || "");
    if (!runId || !childId) {
      setChildScopeEvents([]);
      return;
    }
    const attempt = childAttemptById?.[childId] ?? "latest";
    let alive = true;
    const load = async () => {
      try {
        const rows = await bridge.get_child_events(runId, childId, attempt);
        if (!alive) return;
        setChildScopeEvents(Array.isArray(rows) ? rows : []);
      } catch {
        if (!alive) return;
        setChildScopeEvents([]);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 800);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [bridge, tab, graphScope, selectedRunId, activeRunId, childAttemptById]);

  useEffect(() => {
    if (!bridge || typeof bridge.get_child_progress !== "function") {
      setChildProgressByParent({});
      return;
    }
    if (tab !== "graph") {
      return;
    }
    const runId = String(selectedRunId || activeRunId || "");
    const runRow = runs.find((r) => String(r?.run_id || "") === runId) || null;
    const runStatus = String(runRow?.status || "").toLowerCase();
    const runIsActive = ["running", "queued", "retrying"].includes(runStatus);
    let parentId = "";
    if (graphScope?.level === "child") {
      parentId = String(graphScope?.aggregateId || "");
    } else if (activeAggregateNode?.aggregateChildren?.length) {
      parentId = String(activeAggregateNode?.id || "");
    }
    if (!runId || !parentId) {
      setChildProgressByParent((prev) => {
        if (!Object.keys(prev || {}).length) return prev;
        const next = { ...prev };
        delete next[parentId];
        return next;
      });
      return;
    }
    if (!runIsActive) {
      // keep last progress rows for diagnostics, but stop polling in terminal states
      return;
    }
    const attempt = statusById[parentId]?.attempt ?? "latest";
    let alive = true;
    const load = async () => {
      try {
        const rows = await bridge.get_child_progress(runId, parentId, attempt);
        if (!alive) return;
        const normalized = Array.isArray(rows) ? rows : [];
        setChildProgressByParent((prev) => {
          const prevRows = prev[parentId] || [];
          if (sameProgressRows(prevRows, normalized)) return prev;
          return { ...prev, [parentId]: normalized };
        });
        setStatusById((prev) => {
          let changed = false;
          const next = { ...prev };
          normalized.forEach((row) => {
            const id = String(row?.childId || "");
            if (!id) return;
            const cur = next[id] || {};
            const nextRow = {
              ...cur,
              status: String(row?.status || cur.status || "not_run"),
              attempt: row?.attemptId ?? cur.attempt,
              started_at: row?.startedAt ?? cur.started_at,
              finished_at: row?.finishedAt ?? cur.finished_at,
              message: row?.message ?? cur.message,
              updated_at: Date.now() / 1000,
            };
            if (
              String(cur.status || "") !== String(nextRow.status || "") ||
              String(cur.attempt ?? "") !== String(nextRow.attempt ?? "") ||
              String(cur.started_at ?? "") !== String(nextRow.started_at ?? "") ||
              String(cur.finished_at ?? "") !== String(nextRow.finished_at ?? "") ||
              String(cur.message || "") !== String(nextRow.message || "")
            ) {
              changed = true;
            }
            next[id] = nextRow;
          });
          return changed ? next : prev;
        });
      } catch {
        if (!alive) return;
        setChildProgressByParent((prev) => {
          const prevRows = prev[parentId] || [];
          if (!prevRows.length) return prev;
          return { ...prev, [parentId]: [] };
        });
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 800);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [bridge, tab, graphScope, selectedRunId, activeRunId, activeAggregateNode, runs]);
  const effectiveWidth = containerSize.width > 0
    ? containerSize.width
    : (typeof window !== "undefined" ? Math.max(0, window.innerWidth - 32) : 0);

  const suitesMinPx = useMemo(() => {
    if (effectiveWidth >= 1500) return SUITES_MIN_PX;
    if (effectiveWidth >= 1320) return 230;
    return 210;
  }, [effectiveWidth]);
  const casesMinPx = useMemo(() => {
    if (effectiveWidth >= 1500) return CASES_MIN_PX;
    if (effectiveWidth >= 1320) return 370;
    return 340;
  }, [effectiveWidth]);
  const detailsMinPx = useMemo(() => {
    if (effectiveWidth >= 1500) return DETAILS_MIN_PX;
    if (effectiveWidth >= 1320) return 330;
    return 300;
  }, [effectiveWidth]);

  const canFitThreePanes = useMemo(() => {
    const usable = Math.max(0, effectiveWidth - DIVIDER_PX * 2);
    return usable >= suitesMinPx + casesMinPx + detailsMinPx;
  }, [effectiveWidth, suitesMinPx, casesMinPx, detailsMinPx]);
  const detailsInline = useMemo(() => canFitThreePanes, [canFitThreePanes]);
  const overlayDetailsMaxWidth = useMemo(() => {
    const base = containerSize.width > 0 ? containerSize.width : (typeof window !== "undefined" ? window.innerWidth : 900);
    return Math.max(OVERLAY_DETAILS_MIN_PX, base - 120);
  }, [containerSize.width]);
  const graphAvailableWidth = useMemo(() => {
    const base = graphContainerWidth > 0 ? graphContainerWidth : containerSize.width;
    return Math.max(0, base);
  }, [graphContainerWidth, containerSize.width]);
  const graphCanInlineDetails = useMemo(() => {
    if (!graphDetailsOpen) return false;
    return graphAvailableWidth >= GRAPH_CENTER_MIN_PX + GRAPH_RIGHT_MIN_PX + GRAPH_DIVIDER_PX;
  }, [graphAvailableWidth, graphDetailsOpen]);
  const graphRightWidthClamped = useMemo(() => {
    const maxByViewport = Math.max(GRAPH_RIGHT_MIN_PX, Math.min(GRAPH_RIGHT_MAX_PX, graphAvailableWidth - GRAPH_CENTER_MIN_PX - GRAPH_DIVIDER_PX));
    return Math.max(GRAPH_RIGHT_MIN_PX, Math.min(graphRightWidth, maxByViewport));
  }, [graphAvailableWidth, graphRightWidth]);
  const graphCenterMin = useMemo(() => {
    if (!graphCanInlineDetails) return 0;
    return Math.max(GRAPH_CENTER_MIN_PX, graphAvailableWidth - graphRightWidthClamped - GRAPH_DIVIDER_PX);
  }, [graphAvailableWidth, graphRightWidthClamped, graphCanInlineDetails]);

  const latestRun = runs[0] || null;
  const activeRunRow = useMemo(() => {
    const rid = String(activeRunId || "");
    if (!rid) return null;
    return runs.find((r) => String(r?.run_id || "") === rid) || null;
  }, [runs, activeRunId]);
  const hasInFlightStatus = useMemo(
    () =>
      Object.values(statusById || {}).some((row) => {
        const st = String(row?.status || "").toLowerCase();
        return st === "running" || st === "queued" || st === "retrying";
      }),
    [statusById]
  );
  const anyRunActive = useMemo(() => {
    const activeSet = new Set(["running", "queued", "retrying"]);
    if (activeRunId) {
      const row = runs.find((r) => String(r.run_id || "") === String(activeRunId));
      if (row) return activeSet.has(String(row.status || "").toLowerCase()) && hasInFlightStatus;
    }
    return false;
  }, [runs, activeRunId, hasInFlightStatus]);
  const hasPausedRun = useMemo(
    () => Boolean(pausedRunState && Array.isArray(pausedRunState.remainingIds) && pausedRunState.remainingIds.length > 0),
    [pausedRunState]
  );
  const activeFilterCount = Number(Boolean(tag)) + Number(Boolean(kind)) + Number(Boolean(outcome)) + Number(Boolean(selectedSuiteId)) + Number(aggregateFilterIds.length);
  const triageActive = Boolean(outcome) || Boolean(latestRun && latestRun.status && latestRun.status !== "passed");

  function idsForRun(scope = "all") {
    const validTopIds = new Set((tests || []).map((row) => String(row?.id || "")).filter(Boolean));
    const findAggregateForChildToken = (token) => {
      const childToken = String(token || "").trim();
      if (!childToken) return "";
      const host = (graphNodesWithPlayback || []).find((node) => {
        if (!node?.aggregateSummary || !Array.isArray(node?.aggregateChildren)) return false;
        return node.aggregateChildren.some((child) => {
          const cid = String(child?.id || "");
          const raw = String(child?.rawChildKey || "");
          return (
            cid === childToken ||
            raw === childToken ||
            cid.endsWith(`::${childToken}`) ||
            raw.endsWith(`::${childToken}`)
          );
        });
      });
      const hostId = String(host?.id || "");
      return validTopIds.has(hostId) ? hostId : "";
    };
    const normalizeRequestedIds = (ids) => {
      const out = [];
      const push = (val) => {
        const rid = String(val || "").trim();
        if (!rid || rid.startsWith("placeholder:")) return;
        if (!out.includes(rid)) out.push(rid);
      };
      (Array.isArray(ids) ? ids : []).forEach((rawId) => {
        const rid = String(rawId || "").trim();
        if (!rid || rid.startsWith("placeholder:")) return;
        if (validTopIds.has(rid)) {
          push(rid);
          return;
        }
        if (rid.includes("::")) {
          const [prefix, ...rest] = rid.split("::");
          const rawChild = rest.join("::").trim();
          if (prefix && validTopIds.has(prefix) && rawChild) {
            push(`${prefix}::${rawChild}`);
            return;
          }
          const aggregateHostId = findAggregateForChildToken(rawChild || rid);
          if (aggregateHostId && rawChild) {
            push(`${aggregateHostId}::${rawChild}`);
            return;
          }
          if (aggregateHostId) {
            push(aggregateHostId);
            return;
          }
        }
        const aggregateHostId = findAggregateForChildToken(rid);
        if (aggregateHostId) {
          push(aggregateHostId);
        }
      });
      if (!out.length) {
        if (selectedTestId && validTopIds.has(String(selectedTestId))) push(selectedTestId);
        else if (graphScope?.aggregateId && validTopIds.has(String(graphScope.aggregateId))) push(graphScope.aggregateId);
      }
      return out;
    };

    if (scope === "selected") {
      const scopedChildId = String(graphScope?.level === "child" ? graphScope?.childId || "" : "").trim();
      if (scopedChildId && !scopedChildId.startsWith("placeholder:")) {
        return normalizeRequestedIds([scopedChildId]);
      }
      const manualChild = String(manualGraphChildId || "").trim();
      if (manualChild && !manualChild.startsWith("placeholder:") && manualChild.includes("::")) {
        return normalizeRequestedIds([manualChild]);
      }
      const detailChildId = String(graphDetailChildId || "").trim();
      if (detailChildId && !detailChildId.startsWith("placeholder:") && detailChildId.includes("::")) {
        return normalizeRequestedIds([detailChildId]);
      }
      const graphSelected = String(graphState?.selectedNodeId || "").trim();
      if (graphSelected && !graphSelected.startsWith("placeholder:")) {
        const graphNode = (graphNodesWithPlayback || []).find((row) => String(row?.id || "") === graphSelected) || null;
        const isAggregate = Boolean(graphNode?.aggregateSummary && Array.isArray(graphNode?.aggregateChildren));
        if (isAggregate) return normalizeRequestedIds([graphSelected]);
        if (graphSelected.includes("::")) {
          const [, ...parts] = graphSelected.split("::");
          const rawNodeId = parts.join("::").trim();
          const isPytestNodeId =
            rawNodeId.startsWith("tests/") ||
            rawNodeId.startsWith("tests\\") ||
            rawNodeId.includes("::test_");
          if (rawNodeId && isPytestNodeId) return normalizeRequestedIds([`${graphSelected}`, `python-tests-all::${rawNodeId}`]);
          return normalizeRequestedIds([graphSelected]);
        }
        return normalizeRequestedIds([graphSelected]);
      }
      if (selectedCaseId) return normalizeRequestedIds([selectedCaseId]);
      if (selectedCaseIds.size > 0) return normalizeRequestedIds(Array.from(selectedCaseIds));
      if (selectedTestId) return normalizeRequestedIds([selectedTestId]);
      return [];
    }
    // "Run" should execute the currently filtered scope, not stale checked rows.
    // Checked rows are reserved for "Run Selected".
    return normalizeRequestedIds(aggregateScopedSuites.flatMap((suite) => suite.cases.map((row) => row.id)));
  }

  function pickPreferredAggregateId(runRow, graphNodes) {
    const nodes = Array.isArray(graphNodes) ? graphNodes : [];
    const aggregateNodes = nodes.filter((n) => n?.aggregateSummary && Array.isArray(n?.aggregateChildren));
    if (!aggregateNodes.length) return "";
    const selectedIds = new Set((Array.isArray(runRow?.selected_test_ids) ? runRow.selected_test_ids : []).map((id) => String(id || "")));
    const candidates = aggregateNodes.filter((n) => selectedIds.has(String(n?.id || "")));
    const pool = candidates.length ? candidates : aggregateNodes;
    const preferred = [...pool].sort((a, b) => {
      const aid = String(a?.id || "");
      const bid = String(b?.id || "");
      if (aid === "python-tests-all" && bid !== "python-tests-all") return -1;
      if (bid === "python-tests-all" && aid !== "python-tests-all") return 1;
      const ac = Array.isArray(a?.aggregateChildren) ? a.aggregateChildren.length : 0;
      const bc = Array.isArray(b?.aggregateChildren) ? b.aggregateChildren.length : 0;
      if (ac !== bc) return bc - ac;
      return aid.localeCompare(bid);
    })[0];
    return String(preferred?.id || "");
  }

  function pickActiveRunNodeId(runRow, graphNodes, statusMap) {
    const nodes = Array.isArray(graphNodes) ? graphNodes : [];
    const nodeIds = new Set(nodes.map((n) => String(n?.id || "")).filter(Boolean));
    const testsInRun = Array.isArray(runRow?.tests) ? runRow.tests : [];
    const statusRank = { running: 0, retrying: 1, queued: 2 };
    const byId = statusMap || {};
    const active = [...testsInRun]
      .filter((t) => nodeIds.has(String(t?.id || "")) && Object.prototype.hasOwnProperty.call(statusRank, String(t?.status || "").toLowerCase()))
      .sort((a, b) => {
        const ar = statusRank[String(a?.status || "").toLowerCase()] ?? 99;
        const br = statusRank[String(b?.status || "").toLowerCase()] ?? 99;
        if (ar !== br) return ar - br;
        const aLast = Number(byId[String(a?.id || "")]?.lastRun || 0);
        const bLast = Number(byId[String(b?.id || "")]?.lastRun || 0);
        if (aLast !== bLast) return bLast - aLast;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      })[0];
    return String(active?.id || "");
  }

  function pickActiveAggregateFromGraph(graphNodes, statusMap) {
    const nodes = (Array.isArray(graphNodes) ? graphNodes : []).filter(
      (n) => n?.aggregateSummary && Array.isArray(n?.aggregateChildren)
    );
    if (!nodes.length) return "";
    const byId = statusMap || {};
    const statusRank = { running: 0, retrying: 1, queued: 2 };
    const active = [...nodes]
      .filter((n) => Object.prototype.hasOwnProperty.call(statusRank, String(n?.status || "").toLowerCase()))
      .sort((a, b) => {
        const ar = statusRank[String(a?.status || "").toLowerCase()] ?? 99;
        const br = statusRank[String(b?.status || "").toLowerCase()] ?? 99;
        if (ar !== br) return ar - br;
        const aLast = Number(byId[String(a?.id || "")]?.lastRun || 0);
        const bLast = Number(byId[String(b?.id || "")]?.lastRun || 0);
        if (aLast !== bLast) return bLast - aLast;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      })[0];
    return String(active?.id || "");
  }

  function pickAggregateForActiveChild(activeChildId, graphNodes, fallbackAggregateId = "") {
    const childId = String(activeChildId || "").trim();
    if (!childId) return String(fallbackAggregateId || "");
    const nodes = Array.isArray(graphNodes) ? graphNodes : [];
    const matches = nodes
      .filter((n) => n?.aggregateSummary && Array.isArray(n?.aggregateChildren))
      .filter((n) => (n.aggregateChildren || []).some((c) => String(c?.id || "") === childId))
      .sort((a, b) => {
        const aid = String(a?.id || "");
        const bid = String(b?.id || "");
        if (aid === "python-tests-all" && bid !== "python-tests-all") return 1;
        if (bid === "python-tests-all" && aid !== "python-tests-all") return -1;
        const ac = Array.isArray(a?.aggregateChildren) ? a.aggregateChildren.length : 0;
        const bc = Array.isArray(b?.aggregateChildren) ? b.aggregateChildren.length : 0;
        if (ac !== bc) return ac - bc;
        return aid.localeCompare(bid);
      });
    return String(matches[0]?.id || fallbackAggregateId || "");
  }

  function pickActiveChildFromAggregateNode(aggregateNode) {
    const aggregateId = String(aggregateNode?.id || "");
    if (!aggregateId) return "";
    const summaryChild = String(aggregateNode?.aggregateSummary?.activeChildId || "").trim();
    if (summaryChild) return canonicalChildId(aggregateId, summaryChild);
    const children = Array.isArray(aggregateNode?.aggregateChildren) ? aggregateNode.aggregateChildren : [];
    const pickByStatus = (status) => {
      for (let idx = children.length - 1; idx >= 0; idx -= 1) {
        const row = children[idx];
        if (String(row?.status || "").toLowerCase() !== status) continue;
        const childId = String(row?.id || row?.rawChildKey || "");
        if (childId) return canonicalChildId(aggregateId, childId);
      }
      return "";
    };
    return pickByStatus("running") || pickByStatus("retrying") || pickByStatus("queued") || "";
  }

  async function refreshAll() {
    if (!bridge) return;
    const [logText, startupState, testRows, statusRows, runRows] = await Promise.all([
      bridge.get_logs(),
      bridge.get_startup_state(),
      bridge.get_tests(),
      bridge.get_test_status(),
      bridge.get_runs(),
    ]);
    setLogs(logText || "");
    setStartup(startupState || null);
    setTests(testRows || []);
    const hasActiveSelection = Boolean(selectedRunId || activeRunId);
    if (!statusResetActive || hasActiveSelection) {
      setStatusById(statusRows || {});
    } else {
      setStatusById({});
    }
    setRuns(runRows || []);
    const runningRun = (runRows || []).find((row) => ["running", "queued", "retrying"].includes(String(row?.status || "").toLowerCase()));
    const currentRunRow = activeRunId ? (runRows || []).find((row) => String(row?.run_id || "") === String(activeRunId)) : null;
    const hasProgress = Object.values(statusRows || {}).some((row) => {
      const st = String(row?.status || "").toLowerCase();
      return ["running", "queued", "retrying", "passed", "failed", "timed_out", "canceled"].includes(st);
    });
    if (runningRun?.run_id && hasProgress) {
      setActiveRunId(String(runningRun.run_id));
      if (!selectedRunId) setSelectedRunId(String(runningRun.run_id));
    } else if (!currentRunRow) {
      setWaitingFirstEvent(false);
      setActiveRunId("");
    }
    const sawActiveRun = Boolean(currentRunRow || (runningRun?.run_id && String(runningRun.run_id) === String(activeRunId)));
    if (hasProgress || sawActiveRun) {
      setLastRunUpdateTs(Date.now());
      setWaitingFirstEvent(false);
    }
    if (runningRun?.run_id || hasActiveSelection) {
      setStatusResetActive(false);
    }
    const rows = testRows || [];
    const availableSuiteIds = new Set(rows.map((r) => r.suite_id));
    const availableTestIds = new Set(rows.map((r) => r.id));
    setSelectedSuiteId((prev) => {
      if (prev && availableSuiteIds.has(prev)) return prev;
      return "";
    });
    setSelectedTestId((prev) => {
      if (prev && availableTestIds.has(prev)) return prev;
      return "";
    });
    setSelectedCaseId((prev) => {
      if (prev) return prev;
      return "";
    });
  }

  useEffect(() => {
    if (!bridge) return;
    void refreshAll();
    const intervalMs = liveMode || anyRunActive ? 700 : 1200;
    const id = window.setInterval(() => void refreshAll(), intervalMs);
    return () => window.clearInterval(id);
  }, [bridge, liveMode, anyRunActive, statusResetActive, selectedRunId, activeRunId]);

  useEffect(() => {
    if (!activeRunId) return;
    if (!liveMode) return;
    if (!anyRunActive) {
      setWaitingFirstEvent(false);
      return;
    }
    const id = window.setTimeout(() => {
      const stale = Date.now() - (lastRunUpdateTs || 0) > 2000;
      setWaitingFirstEvent(stale);
    }, 2100);
    return () => window.clearTimeout(id);
  }, [activeRunId, liveMode, anyRunActive, lastRunUpdateTs]);

  useEffect(() => {
    const el = layoutRef.current;
    setContainerSize(readContainerSize());

    const onWindowResize = () => setContainerSize(readContainerSize());
    window.addEventListener("resize", onWindowResize);

    if (!el || typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, []);

  useEffect(() => {
    setLayout((prev) => {
      if (!canFitThreePanes) {
        const usable = Math.max(1, effectiveWidth - DIVIDER_PX);
        const suitesPx = Math.max(180, Math.min((prev.suites / 100) * usable, Math.min(usable * 0.33, usable - 260)));
        const casesPx = Math.max(260, usable - suitesPx);
        const suites = (suitesPx / usable) * 100;
        const cases = (casesPx / usable) * 100;
        return { ...prev, suites, cases, detailsCollapsed: true, details: 0 };
      }
      const usable = Math.max(1, effectiveWidth - DIVIDER_PX * 2);
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const suitesPxMin = suitesMinPx;
      const casesPxMin = casesMinPx;
      const detailsPxMin = detailsMinPx;
      const suitesPxMax = Math.min(usable * 0.33, usable - casesPxMin - detailsPxMin);

      let suitesPx = clamp((prev.suites / 100) * usable, suitesPxMin, suitesPxMax);
      const remAfterSuites = usable - suitesPx;
      let casesPx = clamp((prev.cases / 100) * usable, casesPxMin, remAfterSuites - detailsPxMin);
      let detailsPx = remAfterSuites - casesPx;
      if (detailsPx < detailsPxMin) {
        detailsPx = detailsPxMin;
        casesPx = remAfterSuites - detailsPx;
      }

      const suites = (suitesPx / usable) * 100;
      const cases = (casesPx / usable) * 100;
      const normalizedDetails = (detailsPx / usable) * 100;
      return {
        ...prev,
        suites,
        cases,
        details: normalizedDetails,
        detailsCollapsed: false,
      };
    });
  }, [canFitThreePanes]);

  useEffect(() => {
    if (layout.suites > 33) {
      setLayout((prev) => {
        const suites = 33;
        const remaining = 100 - suites;
        const cases = Math.min(prev.cases, remaining);
        const details = Math.max(0, remaining - cases);
        return { ...prev, suites, cases, details };
      });
    }
  }, [layout.suites]);

  useEffect(() => {
    setLayout((prev) => {
      const width = Math.max(OVERLAY_DETAILS_MIN_PX, Math.min(prev.detailsOverlayWidth || 520, overlayDetailsMaxWidth));
      if (width === prev.detailsOverlayWidth) return prev;
      return { ...prev, detailsOverlayWidth: width };
    });
  }, [overlayDetailsMaxWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("launcher.graph.rightWidth", String(Math.round(graphRightWidthClamped)));
    } catch {}
  }, [graphRightWidthClamped]);

  useEffect(() => {
    if (graphRightWidth !== graphRightWidthClamped) {
      setGraphRightWidth(graphRightWidthClamped);
    }
  }, [graphRightWidthClamped]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (graphCanInlineDetails && graphAvailableWidth < GRAPH_CENTER_MIN_PX + GRAPH_RIGHT_MIN_PX + GRAPH_DIVIDER_PX) {
      // Layout guardrail: never allow overlapping inline panes.
      console.warn("Graph layout guard: insufficient width for inline details, expected stacked mode");
    }
  }, [graphCanInlineDetails, graphAvailableWidth]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (!typing && event.key === "Enter") {
        event.preventDefault();
        const selectedIds = idsForRun("selected");
        if (selectedIds.length) void handleRun(selectedIds);
      }
      if (!typing && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        const rerunId = selectedCase?.id || selectedTestId;
        if (rerunId) void handleRun([rerunId]);
      }
      if (event.key === "Escape") {
        setShowUtilityMenu(false);
        setShowArtifactsPopoverFor(null);
        if (drawerOpen) setDrawerOpen(false);
        else {
          setSelectedCaseId("");
          setSelectedTestId("");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCase?.id, selectedTestId, selectedCaseId, selectedCaseIds, drawerOpen]);

  useEffect(() => {
    if (tab === "graph") return;
    if (!visibleTestIds.length) {
      setSelectedTestId("");
      return;
    }
    if (!selectedTestId || !visibleTestIds.includes(selectedTestId)) {
      setSelectedTestId(visibleTestIds[0]);
    }
  }, [tab, visibleTestIds, selectedTestId]);

  useEffect(() => {
    if (!visibleCases.length) {
      setSelectedCaseId("");
      return;
    }
    if (selectedCaseId && !visibleCases.some((c) => c.id === selectedCaseId)) {
      setSelectedCaseId("");
    }
  }, [visibleCases, selectedCaseId]);

  useEffect(() => {
    if (!selectedRunId) {
      missingSelectedRunRef.current = 0;
      return;
    }
    const present = runs.some((r) => String(r?.run_id || "") === String(selectedRunId));
    if (present) {
      missingSelectedRunRef.current = 0;
      return;
    }
    // Guard against transient polling jitter where one refresh misses runs.
    missingSelectedRunRef.current += 1;
    if (missingSelectedRunRef.current >= 3) {
      setSelectedRunId(null);
      missingSelectedRunRef.current = 0;
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (tab !== "graph") return;
    const el = layoutRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setGraphContainerWidth(rect.width);
  }, [tab, containerSize.width]);

  useEffect(() => {
    if (tab === "graph") {
      setDrawerOpen(false);
      setGraphDetailsOpen(Boolean(graphState.selectedNodeId));
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== "graph") return;
    if (!Array.isArray(aggregateFilterIds) || aggregateFilterIds.length === 0) return;
    if (String(graphScope?.level || "suite") === "suite") return;
    setGraphScope({ level: "suite", aggregateId: "", childId: "" });
  }, [tab, aggregateFilterIds, graphScope?.level]);

  useEffect(() => {
    if (!detailsAggregateNode?.aggregateSummary) return;
    if (followActiveChild && !followActivePaused && graphActiveChildId && manualGraphChildId !== graphActiveChildId) {
      setManualGraphChildId(graphActiveChildId);
    }
  }, [detailsAggregateNode, followActiveChild, followActivePaused, graphActiveChildId, manualGraphChildId]);

  useEffect(() => {
    if (tab !== "graph") return;
    if (graphScope?.level !== "child") return;
    if (!detailsAggregateNode?.aggregateSummary) return;
    if (!graphActiveChildId) return;
    if (!followActiveChild || followActivePaused) return;
    const childId = canonicalChildId(detailsAggregateNode.id, graphActiveChildId);
    setGraphScope((prev) => ({ ...prev, childId }));
  }, [tab, graphScope?.level, detailsAggregateNode, graphActiveChildId, followActiveChild, followActivePaused]);

  const resolveScopedGraph = React.useCallback(
    (baseNodes, baseEdges) => {
      const scopedNodesCandidate = Array.isArray(graphScopedModel?.nodes) ? graphScopedModel.nodes : [];
      const scopedEdgesCandidate = Array.isArray(graphScopedModel?.edges) ? graphScopedModel.edges : [];
      if (!scopedNodesCandidate.length) {
        return { nodes: baseNodes, edges: baseEdges };
      }
      const baseNodeIds = new Set((baseNodes || []).map((n) => String(n?.id || "")).filter(Boolean));
      const validScopedNodes = scopedNodesCandidate.every((n) => baseNodeIds.has(String(n?.id || "")));
      const validScopedEdges = scopedEdgesCandidate.every((e) => {
        const from = String(e?.from || "");
        const to = String(e?.to || "");
        return baseNodeIds.has(from) && baseNodeIds.has(to);
      });
      if (!validScopedNodes || !validScopedEdges) {
        return { nodes: baseNodes, edges: baseEdges };
      }
      return {
        nodes: scopedNodesCandidate,
        edges: scopedEdgesCandidate.length ? scopedEdgesCandidate : baseEdges,
      };
    },
    [graphScopedModel]
  );

  useEffect(() => {
    setGraphState((prev) => {
      const nextNodes = graphModel.nodes || [];
      const nextEdges = graphModel.edges || [];
      const nextEvents = graphModel.events || [];
      const nextTransitions = buildNodeTransitions(nextEvents);
      const scoped = resolveScopedGraph(nextNodes, nextEdges);
      const scopedNodes = scoped.nodes;
      const scopedEdges = scoped.edges;
      const nextPathSteps = buildPathSteps({
        nodes: scopedNodes,
        edges: scopedEdges,
        transitions: nextTransitions,
        branchLockRootId: String(prev.playback?.branchLockId || ""),
      });
      const nextScreenshots = graphModel.screenshots || [];
      const mode = prev.playback?.mode || "timeline";
      const activeEntries = mode === "path" ? nextPathSteps : nextEvents;
      const prevSelectedRaw =
        prev.selectedNodeId && nextNodes.some((n) => n.id === prev.selectedNodeId)
          ? prev.selectedNodeId
          : (nextNodes[0]?.id || "");
      const selectedNodeId =
        String(graphScope?.level || "suite") === "suite"
          ? normalizeSuiteSelectionNodeId(prevSelectedRaw, nextNodes)
          : prevSelectedRaw;
      const selectedEventId =
        prev.selectedEventId && nextEvents.some((e) => e.id === prev.selectedEventId)
          ? prev.selectedEventId
          : (nextEvents[0]?.id || "");
      const maxCursor = Math.max(0, activeEntries.length - 1);
      const cursor = Math.max(0, Math.min(prev.playback?.cursor || 0, maxCursor));
      const activeEntry = activeEntries[cursor] || null;
      const transitionCursor = mode === "path"
        ? Number(activeEntry?.transitionCursor ?? -1)
        : (activeEntry ? cursor : -1);
      const activeNodeRaw = String(activeEntry?.nodeId || "");
      const activeNodeId =
        String(graphScope?.level || "suite") === "suite"
          ? normalizeSuiteSelectionNodeId(activeNodeRaw, nextNodes)
          : activeNodeRaw;
      return {
        ...prev,
        nodes: nextNodes,
        edges: nextEdges,
        events: nextEvents,
        screenshots: nextScreenshots,
        selectedNodeId: mode === "path" ? selectedNodeId : (activeNodeId || selectedNodeId),
        selectedEventId,
        playback: {
          isPlaying: prev.playback?.isPlaying || false,
          cursor,
          speed: Number(prev.playback?.speed || 1),
          mode,
          transitions: nextTransitions,
          pathSteps: nextPathSteps,
          transitionCursor,
          branchLockId: String(prev.playback?.branchLockId || ""),
        },
      };
    });
  }, [graphModel, resolveScopedGraph, graphScope?.level, normalizeSuiteSelectionNodeId]);

  useEffect(() => {
    setGraphState((prev) => {
      const transitions = prev.playback?.transitions || [];
      const branchLockId = String(prev.playback?.branchLockId || "");
      const scoped = resolveScopedGraph(prev.nodes || [], prev.edges || []);
      const scopedNodes = scoped.nodes;
      const scopedEdges = scoped.edges;
      const nextPathSteps = buildPathSteps({
        nodes: scopedNodes,
        edges: scopedEdges,
        transitions,
        branchLockRootId: branchLockId,
      });
      const prevPathSteps = prev.playback?.pathSteps || [];
      const sigOf = (rows) => {
        if (!rows.length) return "0";
        const mid = rows[Math.floor(rows.length / 2)] || {};
        const head = rows.slice(0, Math.min(6, rows.length)).map((r) => `${r.focusNodeId}:${r.transitionId}`).join("|");
        return `${rows.length}:${rows[0]?.focusNodeId || ""}:${rows[0]?.transitionId || ""}:${mid?.focusNodeId || ""}:${mid?.transitionId || ""}:${rows[rows.length - 1]?.focusNodeId || ""}:${rows[rows.length - 1]?.transitionId || ""}:${head}`;
      };
      const prevSig = sigOf(prevPathSteps);
      const nextSig = sigOf(nextPathSteps);
      if (prevSig === nextSig) return prev;
      const mode = prev.playback?.mode || "timeline";
      const nextCursor =
        mode === "path"
          ? Math.min(Number(prev.playback?.cursor || 0), Math.max(0, nextPathSteps.length - 1))
          : Number(prev.playback?.cursor || 0);
      const nextStep = nextPathSteps[nextCursor] || null;
      return {
        ...prev,
        playback: {
          ...prev.playback,
          pathSteps: nextPathSteps,
          cursor: nextCursor,
          transitionCursor: mode === "path" ? Number(nextStep?.transitionCursor ?? -1) : Number(prev.playback?.transitionCursor ?? -1),
        },
      };
    });
  }, [graphScope, graphState.playback?.branchLockId, resolveScopedGraph]);

  useEffect(() => {
    if (!graphState.playback?.isPlaying) return;
    const speed = Number(graphState.playback?.speed || 1);
    const intervalMs = Math.max(120, Math.round(680 / Math.max(0.25, speed)));
    const id = window.setInterval(() => {
      setGraphState((prev) => {
        const mode = prev.playback?.mode || "timeline";
        const activeEntries = mode === "path" ? (prev.playback?.pathSteps || []) : (prev.events || []);
        const max = Math.max(0, activeEntries.length - 1);
        const nextCursor = stepNextCursor(prev.playback?.cursor || 0, max);
        const atEnd = nextCursor >= max;
        const active = activeEntries[nextCursor] || null;
        const selectedEventId = mode === "path"
          ? (active?.sourceEventId || prev.selectedEventId)
          : (active?.id || prev.selectedEventId);
        return {
          ...prev,
          playback: {
            isPlaying: atEnd ? false : Boolean(prev.playback?.isPlaying),
            cursor: nextCursor,
            speed: Number(prev.playback?.speed || 1),
            mode,
            transitions: prev.playback?.transitions || [],
            pathSteps: prev.playback?.pathSteps || [],
            transitionCursor: mode === "path" ? Number(active?.transitionCursor ?? prev.playback?.transitionCursor ?? -1) : nextCursor,
            branchLockId: String(prev.playback?.branchLockId || ""),
          },
          selectedEventId,
          selectedNodeId: mode === "path"
            ? prev.selectedNodeId
            : (
                (String(graphScope?.level || "suite") === "suite"
                  ? normalizeSuiteSelectionNodeId(String(active?.nodeId || ""), prev.nodes || [])
                  : String(active?.nodeId || ""))
                || prev.selectedNodeId
              ),
        };
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [graphState.playback?.isPlaying, graphState.playback?.speed, graphState.playback?.mode, graphScope?.level, normalizeSuiteSelectionNodeId]);

  useEffect(() => {
    if ((graphState.playback?.mode || "timeline") !== "path") return;
    const activeNodeId = String(pathPlaybackState.activeNodeId || "");
    if (!activeNodeId) return;
    const nextSelectedEventId = pathPlaybackState.activeTransition?.sourceEventId || graphState.selectedEventId;
    setGraphState((prev) => {
      const nextExplanation = String(pathPlaybackState.explanation || "");
      const prevExplanation = String(prev.playback?.pathExplanation || "");
      if (prev.selectedNodeId === activeNodeId && prev.selectedEventId === nextSelectedEventId && prevExplanation === nextExplanation) return prev;
      return {
        ...prev,
        selectedNodeId: activeNodeId,
        selectedEventId: nextSelectedEventId,
        playback: {
          ...prev.playback,
          transitionCursor: Number(pathPlaybackState.transitionCursorUsed ?? prev.playback?.transitionCursor ?? -1),
          pathExplanation: nextExplanation,
        },
      };
    });
  }, [graphState.playback?.mode, pathPlaybackState.activeNodeId, pathPlaybackState.activeTransition?.sourceEventId, pathPlaybackState.transitionCursorUsed, pathPlaybackState.explanation, graphState.selectedEventId]);

  async function handlePreview() {
    if (!bridge) return;
    setPreviewBusy(true);
    try {
      const runIds = idsForRun("selected");
      const raw = await bridge.preview_plan(runIds.length ? runIds : idsForRun("all"), []);
      const plan = Array.isArray(raw) ? raw : [];
      if (!plan.length) {
        setPreviewLine("No plan");
        return;
      }
      const depCount = plan.reduce((acc, row) => acc + (Array.isArray(row.deps) && row.deps.length ? 1 : 0), 0);
      const skipCount = plan.reduce((acc, row) => acc + (row.skip ? 1 : 0), 0);
      const compact = plan.slice(0, 4).map((row) => `${row.order}:${row.id}`).join(" -> ");
      const more = plan.length > 6 ? ` (+${plan.length - 6} more)` : "";
      const meta = depCount || skipCount ? ` | deps:${depCount} skip:${skipCount}` : "";
      setPreviewLine(`${compact}${more}${meta}`);
    } catch (error) {
      const message = error?.message ? String(error.message) : "Preview failed";
      setPreviewLine(`Preview failed: ${message}`);
    } finally {
      setPreviewBusy(false);
    }
  }

  function deriveRemainingIdsForResume(runRow) {
    if (!runRow || !Array.isArray(runRow.tests)) return [];
    const terminal = new Set(["passed", "failed", "skipped", "canceled"]);
    const selectedOrder = Array.isArray(runRow.selected_test_ids)
      ? runRow.selected_test_ids.map((id) => String(id || "")).filter(Boolean)
      : runRow.tests.map((row) => String(row?.id || "")).filter(Boolean);
    const byStatus = new Map(
      runRow.tests
        .filter((row) => row && typeof row === "object")
        .map((row) => [String(row.id || ""), String(row.status || "not_run").toLowerCase()])
    );
    return selectedOrder.filter((id) => {
      const status = byStatus.get(id) || "not_run";
      if (terminal.has(status)) return false;
      if (status === "running") return false;
      return true;
    });
  }

  async function handlePauseRun() {
    const row =
      activeRunRow ||
      runs.find((r) => ["running", "queued", "retrying"].includes(String(r?.status || "").toLowerCase())) ||
      null;
    if (!row) return;
    const remainingIds = deriveRemainingIdsForResume(row);
    setPausedRunState({
      runId: String(row.run_id || ""),
      remainingIds,
      pausedAt: Date.now(),
    });
    await handleStop("after_current");
  }

  async function handleRun(ids, options = {}) {
    if (!bridge || loadingRun) return;
    const wantResume = Boolean(options.resumePaused) && (!Array.isArray(ids) || ids.length === 0);
    const requestedIds =
      wantResume && hasPausedRun
        ? pausedRunState.remainingIds
        : (Array.isArray(ids) && ids.length ? ids : idsForRun("all"));
    if (runtimeDebug) {
      console.warn("[run-selected] requestedIds", {
        requestedIds: (requestedIds || []).map((id) => String(id || "")),
        selectedNodeId: String(graphState?.selectedNodeId || ""),
        graphScope,
        manualGraphChildId: String(manualGraphChildId || ""),
        graphDetailChildId: String(graphDetailChildId || ""),
      });
    }
    if (requestedIds.length) {
      setStatusById((prev) => {
        const next = { ...prev };
        const ts = Date.now() / 1000;
        requestedIds.forEach((id) => {
          const current = next[id] || {};
          next[id] = { ...current, status: "queued", lastRun: ts };
        });
        return next;
      });
      setLastRunUpdateTs(Date.now());
    }
    setLoadingRun(true);
    try {
      const out = await bridge.run_plan(requestedIds, []);
      const rid = String(out?.run_id || "");
      if (rid) {
        setPausedRunState(null);
        setActiveRunId(rid);
        setSelectedRunId(rid);
        const requestedSet = new Set((requestedIds || []).map((id) => String(id || "")));
        const requestedAggregates = (tests || [])
          .filter((row) => requestedSet.has(String(row?.id || "")) && Array.isArray(row?.children) && row.children.length > 0)
          .sort((a, b) => {
            const aid = String(a?.id || "");
            const bid = String(b?.id || "");
            if (aid === "python-tests-all" && bid !== "python-tests-all") return -1;
            if (bid === "python-tests-all" && aid !== "python-tests-all") return 1;
            const ac = Array.isArray(a?.children) ? a.children.length : 0;
            const bc = Array.isArray(b?.children) ? b.children.length : 0;
            if (ac !== bc) return bc - ac;
            return aid.localeCompare(bid);
          });
        const aggregateDirect = requestedAggregates[0] || null;
        const aggregateFallback =
          (tests || []).find((row) => String(row?.id || "") === "python-tests-all" && Array.isArray(row?.children) && row.children.length > 0) || null;
        const aggregateId = String(aggregateDirect?.id || aggregateFallback?.id || "");
        runAutoTrackRef.current = { runId: rid, aggregateId, engaged: false };
      }
      setRunScopeEnabled(false);
      setLiveMode(true);
      setStatusResetActive(false);
      setLastRunUpdateTs(Date.now());
      setWaitingFirstEvent(true);
      setFollowActivePaused(false);
      setGraphScope((prev) => ({ ...prev, childId: "" }));
      await refreshAll();
    } finally {
      setLoadingRun(false);
    }
  }

  useEffect(() => {
    if (artifactReplayMode) {
      runAutoTrackRef.current = { runId: "", aggregateId: "", engaged: false };
    }
  }, [artifactReplayMode]);

  useEffect(() => {
    if (tab !== "graph") return;
    if (!artifactReplayMode) return;
    if (!graphState.playback?.isPlaying) return;
    if (!followActiveChild || followActivePaused) return;
    const nodeId = String(playbackActiveNodeId || "");
    if (!nodeId) return;

    if (nodeId.includes("::")) {
      const aggregateId = String(nodeId.split("::")[0] || "");
      if (!aggregateId) return;
      const nextChildId = canonicalChildId(aggregateId, nodeId.split("::").slice(1).join("::"));
      if (graphScope?.level === "suite") {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nextChildId }));
        if (!isPytestGateAggregateId(aggregateId, graphNodesWithPlayback)) setGraphBubbleAggregateId(aggregateId);
        else setGraphBubbleAggregateId("");
        return;
      }
      if (
        graphScope?.level !== "child" ||
        String(graphScope?.aggregateId || "") !== aggregateId ||
        String(graphScope?.childId || "") !== nextChildId
      ) {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nextChildId }));
        setGraphScope({ level: "child", aggregateId, childId: nextChildId });
      }
      return;
    }

    const isAggregate = graphNodesWithPlayback.some((n) => String(n?.id || "") === nodeId && Boolean(n?.aggregateSummary));
    if (isAggregate) {
      if (graphScope?.level === "suite") {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nodeId }));
        if (!isPytestGateAggregateId(nodeId, graphNodesWithPlayback)) setGraphBubbleAggregateId(nodeId);
        else setGraphBubbleAggregateId("");
        return;
      }
      if (graphScope?.level !== "aggregate" || String(graphScope?.aggregateId || "") !== nodeId) {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nodeId }));
        setGraphScope({ level: "aggregate", aggregateId: nodeId, childId: "" });
      }
      return;
    }

    if (graphScope?.level !== "suite" || String(graphState.selectedNodeId || "") !== nodeId) {
      setGraphState((prev) => ({ ...prev, selectedNodeId: nodeId }));
      setGraphScope({ level: "suite", aggregateId: "", childId: "" });
    }
  }, [
    tab,
    artifactReplayMode,
    graphState.playback?.isPlaying,
    followActiveChild,
    followActivePaused,
    playbackActiveNodeId,
    graphScope,
    graphNodesWithPlayback,
    graphState.selectedNodeId,
  ]);

  useEffect(() => {
    if (tab !== "graph") return;
    if (suppressLiveGraphAutotrack) return;
    const tracking = runAutoTrackRef.current;
    const runId = String(tracking?.runId || "");
    const runRow = runId ? (runs.find((r) => String(r?.run_id || "") === runId) || null) : activeRunRow;
    const runStatus = String(runRow?.status || "").toLowerCase();
    const runIsActive = ["running", "queued", "retrying"].includes(runStatus);

    // Always pop out on tracked run completion, even if follow is paused by manual interaction.
    if (tracking.engaged && (!runRow || !runIsActive)) {
      const aggregateId = String(tracking.aggregateId || graphScope?.aggregateId || "");
      if (aggregateId) {
        setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
        setGraphScope({ level: "aggregate", aggregateId, childId: "" });
      } else {
        setGraphScope({ level: "suite", aggregateId: "", childId: "" });
      }
      runAutoTrackRef.current = { runId: "", aggregateId: "", engaged: false };
      return;
    }
    if (!followActiveChild) return;
    if (!runIsActive) return;

    const activeAggregateFromGraph = pickActiveAggregateFromGraph(graphNodesWithPlayback, statusById);
    const activeAggregateId = pickActiveRunNodeId(runRow, graphNodesWithPlayback, statusById);
    const preferredAggregateId = pickPreferredAggregateId(runRow, graphNodesWithPlayback);
    let aggregateId = String(activeAggregateFromGraph || activeAggregateId || preferredAggregateId || tracking.aggregateId || "");
    if (!aggregateId) return;

    // If user paused follow but run has moved to a different active node,
    // auto-resume so details do not stay pinned to stale context.
    if (followActivePaused) {
      const currentAggregate = String(graphScope?.aggregateId || "");
      if (!currentAggregate || currentAggregate !== aggregateId) {
        setFollowActivePaused(false);
      } else {
        return;
      }
    }
    if (tracking.aggregateId !== aggregateId) {
      runAutoTrackRef.current = {
        runId: String(runRow?.run_id || activeRunId || ""),
        aggregateId,
        engaged: Boolean(tracking.engaged),
      };
    }

    let aggregateNode = graphNodesWithPlayback.find((n) => String(n?.id || "") === aggregateId) || null;
    let activeChild = pickActiveChildFromAggregateNode(aggregateNode);
    const remappedAggregateId = pickAggregateForActiveChild(activeChild, graphNodesWithPlayback, aggregateId);
    if (remappedAggregateId && remappedAggregateId !== aggregateId) {
      aggregateId = remappedAggregateId;
      aggregateNode = graphNodesWithPlayback.find((n) => String(n?.id || "") === aggregateId) || null;
      const aggregateActiveChild = pickActiveChildFromAggregateNode(aggregateNode);
      const childExists = (aggregateNode?.aggregateChildren || []).some((c) => String(c?.id || "") === activeChild);
      if (!childExists) activeChild = aggregateActiveChild;
    }
    if (!tracking.engaged) {
      runAutoTrackRef.current = { runId: String(runRow?.run_id || activeRunId || ""), aggregateId, engaged: true };
    }

    // Enter aggregate and follow to child while active child signals exist.
    if (graphScope?.level === "suite") {
      setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
      if (!isPytestGateAggregateId(aggregateId, graphNodesWithPlayback)) setGraphBubbleAggregateId(aggregateId);
      else setGraphBubbleAggregateId("");
      return;
    }
    if ((graphScope?.level === "aggregate" || graphScope?.level === "child") && String(graphScope?.aggregateId || "") !== aggregateId) {
      setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
      setGraphScope({ level: activeChild ? "child" : "aggregate", aggregateId, childId: activeChild ? canonicalChildId(aggregateId, activeChild) : "" });
      return;
    }
    if (graphScope?.level === "aggregate" && activeChild) {
      setGraphScope({ level: "child", aggregateId, childId: canonicalChildId(aggregateId, activeChild) });
      return;
    }
    if (graphScope?.level === "child" && graphScope?.aggregateId === aggregateId && activeChild) {
      const nextChild = canonicalChildId(aggregateId, activeChild);
      if (String(graphScope?.childId || "") !== nextChild) {
        setGraphScope({ level: "child", aggregateId, childId: nextChild });
      }
    }
  }, [tab, followActiveChild, followActivePaused, runs, activeRunRow, activeRunId, graphNodesWithPlayback, graphScope, statusById, suppressLiveGraphAutotrack]);

  async function handleClearState() {
    // Reset visual state only; keep run history/artifacts so users can reload.
    setStatusById({});
    setChildScopeEvents([]);
    setChildProgressByParent({});
    setActiveRunId("");
    setSelectedRunId(null);
    setPausedRunState(null);
    setWaitingFirstEvent(false);
    setStatusResetActive(true);
    
    // Attempt to reset backend python loop via cancel explicitly if running
    if (anyRunActive && bridge?.cancel_run) {
      await bridge.cancel_run();
    }
  }

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

  async function handleClearCache() {
    if (!bridge || typeof bridge.clear_step_cache !== "function") return;
    try {
      const out = await bridge.clear_step_cache();
      const cleared = Number(out?.cleared || 0);
      setPreviewLine(`Cache cleared (${cleared} entries)`);
    } catch (error) {
      const message = error?.message ? String(error.message) : "cache clear failed";
      setPreviewLine(`Cache clear failed: ${message}`);
    }
    await refreshAll();
  }

  async function copyLogs() {
    if (!bridge) return;
    const text = await bridge.get_logs();
    await navigator.clipboard.writeText(text || "");
    setShowUtilityMenu(false);
  }

  async function copyDiagnostics() {
    if (!bridge) return;
    const text = await bridge.get_diagnostics_summary();
    await navigator.clipboard.writeText(text || "");
    setShowUtilityMenu(false);
  }

  function selectGraphNode(nodeId) {
    const node = graphNodesWithPlayback.find((row) => row.id === nodeId) || null;
    setGraphState((prev) => ({
      ...(function () {
        const lockId = nodeId || "";
        const nextPathSteps = buildPathSteps({
          nodes: (graphScopedModel?.nodes && graphScopedModel.nodes.length ? graphScopedModel.nodes : (prev.nodes || [])),
          edges: (graphScopedModel?.edges && graphScopedModel.edges.length ? graphScopedModel.edges : (prev.edges || [])),
          transitions: prev.playback?.transitions || [],
          branchLockRootId: lockId,
        });
        const nextPathCursor =
          (prev.playback?.mode || "timeline") === "path"
            ? Math.min(Number(prev.playback?.cursor || 0), Math.max(0, nextPathSteps.length - 1))
            : Number(prev.playback?.cursor || 0);
        return {
          ...prev,
          selectedNodeId: nodeId || "",
          playback: {
            ...prev.playback,
            branchLockId: lockId,
            pathSteps: nextPathSteps,
            cursor: nextPathCursor,
            transitionCursor:
              (prev.playback?.mode || "timeline") === "path"
                ? Number((nextPathSteps[nextPathCursor] || {}).transitionCursor ?? -1)
                : Number(prev.playback?.transitionCursor ?? -1),
          },
        };
      })(),
    }));
    // Manual graph interaction must pause auto-follow so UI never feels hijacked.
    setFollowActivePaused(true);
    setManualGraphChildId("");
    // Keep suite-mode bubble behavior consistent regardless of aggregate filters.
    if (String(graphScope?.level || "suite") === "suite" && node?.aggregateSummary && nodeId) {
      if (!isPytestGateAggregateId(String(nodeId), graphNodesWithPlayback)) setGraphBubbleAggregateId(String(nodeId));
      else setGraphBubbleAggregateId("");
    }
    if (graphScope?.level === "child" && node?.id === graphScope.aggregateId) {
      setGraphScope({ level: "aggregate", aggregateId: graphScope.aggregateId, childId: "" });
    }
    if (nodeId) setGraphDetailsOpen(true);
  }

  function updateGraphPlayback(patch) {
    setGraphState((prev) => {
      const nextMode = patch.mode == null ? (prev.playback?.mode || "timeline") : patch.mode;
      const activeEntries = nextMode === "path" ? (prev.playback?.pathSteps || []) : (prev.events || []);
      const max = Math.max(0, activeEntries.length - 1);
      const baseCursor = Number(prev.playback?.cursor || 0);
      const nextCursor = patch.cursor == null ? baseCursor : Math.max(0, Math.min(patch.cursor, max));
      const active = activeEntries[nextCursor] || null;
      const selectedEventId = nextMode === "path" ? (active?.sourceEventId || prev.selectedEventId) : (active?.id || prev.selectedEventId);
      const next = {
        ...prev,
        playback: {
          isPlaying: patch.isPlaying == null ? Boolean(prev.playback?.isPlaying) : Boolean(patch.isPlaying),
          cursor: nextCursor,
          speed: patch.speed == null ? Number(prev.playback?.speed || 1) : Number(patch.speed) || 1,
          mode: nextMode,
          transitions: prev.playback?.transitions || [],
          pathSteps: prev.playback?.pathSteps || [],
          transitionCursor: nextMode === "path" ? Number(active?.transitionCursor ?? prev.playback?.transitionCursor ?? -1) : nextCursor,
          branchLockId: String(prev.playback?.branchLockId || ""),
        },
      };
      if (patch.cursor != null || patch.mode != null) {
        const activeNodeId = String(active?.focusNodeId || active?.nodeId || "");
        const normalizedActiveNodeId = activeNodeId.includes("::")
          ? String(activeNodeId.split("::")[0] || "")
          : activeNodeId;
        next.selectedEventId = selectedEventId;
        next.selectedNodeId = normalizedActiveNodeId || prev.selectedNodeId;
      }
      return next;
    });
  }

  function clearFilters() {
    setTag("");
    setKind("");
    setOutcome("");
    setSelectedSuiteId("");
    setAggregateFilterIds([]);
  }

  function handleSelectRun(runId, options = {}) {
    const nextRunId = runId || null;
    setSelectedRunId(nextRunId);
    const nextScope = typeof options.scope === "boolean" ? options.scope : Boolean(nextRunId);
    setRunScopeEnabled(nextScope);
    if (nextRunId) {
      // Run switching must not retain stale scoped graph overlays from prior contexts.
      setGraphScopedModel({ nodes: [], edges: [], scope: "suite" });
      setGraphScope({ level: "suite", aggregateId: "", childId: "" });
    }
  }

  useEffect(() => {
    if (!selectedRunId) return;
    if (!runScopeEnabled) setRunScopeEnabled(true);
  }, [selectedRunId, runScopeEnabled]);

  function startDrag(type, event) {
    if (type === "h" && runHistoryCollapsed) return;
    event.preventDefault();
    const el = layoutRef.current;
    if (!el) return;
    if (event.pointerId != null && event.currentTarget?.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    }
    const rect = el.getBoundingClientRect();
    document.body.style.userSelect = "none";
    document.body.style.cursor = type === "h" ? "row-resize" : "col-resize";
    setDragState({
      type,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId ?? null,
      startLayout: layout,
      detailsInline,
      width: rect.width,
      height: rect.height,
    });
  }

  function startGraphDividerDrag(event) {
    if (!graphCanInlineDetails) return;
    event.preventDefault();
    const el = layoutRef.current;
    const width = el?.getBoundingClientRect().width || graphAvailableWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    setGraphDrag({
      startX: event.clientX,
      startWidth: graphRightWidthClamped,
      containerWidth: width,
    });
  }

  useEffect(() => {
    if (!dragState) return;
    const pctFromPx = (px, total) => (total <= 0 ? 0 : (px / total) * 100);
    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

    const onMove = (event) => {
      const width = Math.max(1, dragState.width - (dragState.detailsInline ? DIVIDER_PX * 2 : DIVIDER_PX));
      const height = Math.max(1, dragState.height);
      if (dragState.type === "v1") {
        const delta = ((event.clientX - dragState.startX) / width) * 100;
        if (dragState.detailsInline) {
          const sMin = pctFromPx(suitesMinPx, width);
          const cMin = pctFromPx(casesMinPx, width);
          const dMin = pctFromPx(detailsMinPx, width);
          const sMax = Math.min(33, 100 - cMin - dMin);
          let suites = clamp(dragState.startLayout.suites + delta, sMin, sMax);
          let cases = clamp(dragState.startLayout.cases - delta, cMin, 100 - suites - dMin);
          const details = 100 - suites - cases;
          setLayout((prev) => ({ ...prev, suites, cases, details, detailsCollapsed: false }));
        } else {
          const suitesMinPx = Math.max(140, Math.min(SUITES_MIN_PX, width - CASES_MIN_PX));
          const casesMinPx = Math.max(220, Math.min(CASES_MIN_PX, width - suitesMinPx));
          const sMin = pctFromPx(suitesMinPx, width);
          const cMin = pctFromPx(casesMinPx, width);
          let suites = clamp(dragState.startLayout.suites + delta, sMin, Math.min(33, 100 - cMin));
          const cases = 100 - suites;
          setLayout((prev) => ({ ...prev, suites, cases, details: 0, detailsCollapsed: true }));
        }
      } else if (dragState.type === "v2") {
        if (!dragState.detailsInline) return;
        const delta = ((event.clientX - dragState.startX) / width) * 100;
        const sMin = pctFromPx(suitesMinPx, width);
        const cMin = pctFromPx(casesMinPx, width);
        const dMin = pctFromPx(detailsMinPx, width);
        const pinnedSuites = Math.min(33, dragState.startLayout.suites);
        let cases = clamp(dragState.startLayout.cases + delta, cMin, 100 - pinnedSuites - dMin);
        const details = 100 - pinnedSuites - cases;
        setLayout((prev) => ({ ...prev, suites: clamp(prev.suites, sMin, 33), cases, details: Math.max(dMin, details), detailsCollapsed: false }));
      } else if (dragState.type === "h") {
        const deltaY = event.clientY - dragState.startY;
        const maxArtifacts = Math.max(120, Math.min(420, height * 0.55));
        const artifactsHeight = Math.max(100, Math.min(maxArtifacts, dragState.startLayout.artifactsHeight - deltaY));
        setLayout((prev) => ({ ...prev, artifactsHeight }));
      } else if (dragState.type === "ov") {
        const deltaX = dragState.startX - event.clientX;
        const nextWidth = Math.max(
          OVERLAY_DETAILS_MIN_PX,
          Math.min(dragState.startLayout.detailsOverlayWidth + deltaX, overlayDetailsMaxWidth)
        );
        setLayout((prev) => ({ ...prev, detailsOverlayWidth: nextWidth }));
      }
    };
    const onUp = () => {
      setLayout((prev) => {
        const points = [
          { suites: 25, cases: 50, details: 25, detailsCollapsed: false },
          { suites: 30, cases: 45, details: 25, detailsCollapsed: false },
          { suites: 35, cases: 65, details: 0, detailsCollapsed: true },
        ];
        let snapped = prev;
        for (const p of points) {
          const d0 = Math.abs(prev.suites - p.suites);
          const d1 = Math.abs(prev.cases - p.cases);
          const d2 = Math.abs((prev.detailsCollapsed ? 0 : prev.details) - p.details);
          if (Math.max(d0, d1, d2) <= 3) {
            snapped = { ...prev, ...p, suites: Math.min(33, p.suites) };
            break;
          }
        }
        if (snapped.suites > 33) snapped = { ...snapped, suites: 33 };
        return snapped;
      });
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragState(null);
    };
    const onPointerMove = (event) => {
      if (dragState.pointerId != null && event.pointerId != null && event.pointerId !== dragState.pointerId) return;
      onMove(event);
    };
    const onPointerUp = (event) => {
      if (dragState.pointerId != null && event.pointerId != null && event.pointerId !== dragState.pointerId) return;
      onUp();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [dragState, suitesMinPx, casesMinPx, detailsMinPx]);

  useEffect(() => {
    if (!graphDrag) return;
    const onMove = (event) => {
      const total = Math.max(1, graphDrag.containerWidth);
      const delta = graphDrag.startX - event.clientX;
      const maxWidth = Math.max(GRAPH_RIGHT_MIN_PX, Math.min(GRAPH_RIGHT_MAX_PX, total - GRAPH_CENTER_MIN_PX - GRAPH_DIVIDER_PX));
      const next = Math.max(GRAPH_RIGHT_MIN_PX, Math.min(maxWidth, graphDrag.startWidth + delta));
      setGraphRightWidth(next);
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setGraphDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [graphDrag]);

  if (!bridge) return <BridgeState bridgeError={bridgeError} />;

  const detailsSelectedCase =
    tab === "graph" && graphDetailsNode
      ? (() => {
          const hasAggregate = Boolean(graphDetailsNode.aggregateSummary && Array.isArray(graphDetailsNode.aggregateChildren));
          const activeChild = hasAggregate ? (graphDetailsNode.aggregateChildren || []).find((c) => c.id === graphDetailChildId) : null;
          if (activeChild) {
            return {
              id: activeChild.id,
              testId: graphDetailsNode.id,
              name: activeChild.name,
              nodeid: activeChild.id,
              file_path: activeChild.filePath,
              suite_id: graphDetailsNode.suiteId,
              tags: graphDetailsNode.tags || [],
            };
          }
          return {
            id: graphDetailsNode.id,
            testId: graphDetailsNode.id,
            name: graphDetailsNode.name,
            nodeid: graphDetailsNode.id,
            file_path: graphDetailsNode.filePath,
            suite_id: graphDetailsNode.suiteId,
            tags: graphDetailsNode.tags || [],
          };
        })()
      : selectedCase;
  const runHistoryCollapsedHeight = 34;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <HeaderBar startup={startup} onOpenIssues={() => setShowIssuesDrawer(true)} />

      <TopActionsBar
        bridge={bridge}
        loadingRun={loadingRun}
        tab={tab}
        setTab={setTab}
        previewLine={previewLine}
        previewBusy={previewBusy}
        runPrimaryLabel={hasPausedRun && !anyRunActive ? "Resume Run" : "Run"}
        onRunPrimary={() => void handleRun(undefined, { resumePaused: true })}
        onRunSelected={() => {
          const selectedIds = idsForRun("selected");
          void handleRun(selectedIds.length ? selectedIds : undefined);
        }}
        onPauseRun={() => void handlePauseRun()}
        onPreview={() => void handlePreview()}
        onRefresh={() => void refreshAll()}
        onStop={(mode) => void handleStop(mode)}
        onToggleUtilityMenu={() => setShowUtilityMenu((v) => !v)}
        showUtilityMenu={showUtilityMenu}
        onCopyLogs={() => void copyLogs()}
        onCopyDiagnostics={() => void copyDiagnostics()}
        liveMode={liveMode}
        onToggleLiveMode={() => setLiveMode((v) => !v)}
        anyRunActive={anyRunActive}
        waitingFirstEvent={waitingFirstEvent}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        onClearState={handleClearState}
        onClearCache={() => void handleClearCache()}
      />

      {tab === "logs" ? <LogsPanel logs={logs} /> : null}
      {tab === "tests" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <FilterBar
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
            activeFilterCount={activeFilterCount}
            onClearFilters={clearFilters}
          />
          <LastRunStrip latestRun={latestRun} statusById={statusById} onStopRun={() => void handleStop("terminate_workers")} />
          <div ref={layoutRef} className="min-h-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col">
              <div className="relative min-h-0 flex-1">
                <div
                  className="grid h-full min-h-0"
                  style={
                    detailsInline
                      ? {
                          gridTemplateColumns: `minmax(${suitesMinPx}px, ${layout.suites}fr) ${DIVIDER_PX}px minmax(${casesMinPx}px, ${layout.cases}fr) ${DIVIDER_PX}px minmax(${detailsMinPx}px, ${Math.max(1, layout.details)}fr)`,
                        }
                      : {
                          gridTemplateColumns: `minmax(${Math.min(suitesMinPx, 220)}px, ${layout.suites}fr) ${DIVIDER_PX}px minmax(${Math.min(casesMinPx, 260)}px, ${Math.max(1, layout.cases)}fr)`,
                        }
                  }
                >
                  <div className="min-h-0 min-w-0 pr-2">
                    <SuitesPane
                      filteredSuites={aggregateScopedSuites}
                      collapsedSuites={collapsedSuites}
                      setCollapsedSuites={setCollapsedSuites}
                      handleRun={handleRun}
                      statusById={statusById}
                      selectedTestId={selectedTestId}
                      selectedCaseIds={selectedCaseIds}
                      setSelectedCaseIds={setSelectedCaseIds}
                      setSelectedTestId={setSelectedTestId}
                      setSelectedSuiteId={setSelectedSuiteId}
                      setDrawerOpen={setDrawerOpen}
                    />
                  </div>
                  <div role="separator" aria-orientation="vertical" onPointerDown={(e) => startDrag("v1", e)} className="group relative cursor-col-resize touch-none" style={{ zIndex: Z_GRAPH_UI }}>
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
                  </div>
                  <div className="min-h-0 min-w-0 px-2">
                    <CasesPane
                      visibleCases={visibleCases}
                      selectedCase={selectedCase}
                      statusById={statusById}
                      setSelectedCaseId={setSelectedCaseId}
                      setDrawerOpen={setDrawerOpen}
                      onRunCase={(caseId) => void handleRun([caseId])}
                      showDetailsButton={!detailsInline}
                      onOpenDetails={() => setDrawerOpen(true)}
                      triageActive={triageActive}
                    />
                  </div>
                  {detailsInline ? (
                    <>
                      <div role="separator" aria-orientation="vertical" onPointerDown={(e) => startDrag("v2", e)} className="group relative cursor-col-resize touch-none" style={{ zIndex: Z_GRAPH_UI }}>
                        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
                      </div>
                      <div className="min-h-0 min-w-0 overflow-hidden pl-2">
                        <DetailsPane
                          drawerOpen={drawerOpen}
                          selectedCase={detailsSelectedCase}
                          setDrawerOpen={setDrawerOpen}
                          bridge={bridge}
                          tests={tests}
                          statusById={statusById}
                          runs={runs}
                          logs={logs}
                          selectedRunId={selectedRunId}
                          onSelectRun={(runId) => handleSelectRun(runId, { scope: false })}
                          runInspector={runInspector}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
                {!detailsInline && drawerOpen ? (
                  <div className="absolute inset-y-0 right-0 min-h-0 overflow-hidden border-l border-slate-700 bg-slate-950/95 pl-2 shadow-2xl" style={{ width: `${Math.max(OVERLAY_DETAILS_MIN_PX, Math.min(layout.detailsOverlayWidth, overlayDetailsMaxWidth))}px`, zIndex: Z_PANE }}>
                    <div role="separator" aria-orientation="vertical" onPointerDown={(e) => startDrag("ov", e)} className="group absolute bottom-0 left-0 top-0 w-[10px] -translate-x-1/2 cursor-col-resize touch-none" style={{ zIndex: Z_PANE + 1 }}>
                      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
                    </div>
                    <DetailsPane
                      drawerOpen={drawerOpen}
                      selectedCase={detailsSelectedCase}
                      setDrawerOpen={setDrawerOpen}
                      bridge={bridge}
                      tests={tests}
                      statusById={statusById}
                      runs={runs}
                      logs={logs}
                      selectedRunId={selectedRunId}
                      onSelectRun={(runId) => handleSelectRun(runId, { scope: false })}
                      runInspector={runInspector}
                    />
                  </div>
                ) : null}
              </div>
              {!runHistoryCollapsed ? (
                <>
                  <div role="separator" aria-orientation="horizontal" onPointerDown={(e) => startDrag("h", e)} className="group relative my-1 h-[10px] cursor-row-resize touch-none" style={{ zIndex: Z_GRAPH_UI }}>
                    <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-slate-700 group-hover:bg-blue-400" />
                  </div>
                  <div className="relative min-h-0 overflow-hidden" style={{ height: `${layout.artifactsHeight}px`, zIndex: Z_PANE }}>
                    <ArtifactsSection
                      runs={runs}
                      showArtifactsPopoverFor={showArtifactsPopoverFor}
                      setShowArtifactsPopoverFor={setShowArtifactsPopoverFor}
                      bridge={bridge}
                      selectedRunId={selectedRunId}
                      onSelectRun={(runId) => handleSelectRun(runId, { scope: Boolean(runId) })}
                    />
                    <button
                      type="button"
                      onClick={() => setRunHistoryCollapsed(true)}
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
                      onClick={() => setRunHistoryCollapsed(false)}
                      className="mr-3 inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-200"
                    >
                      <ChevronUp className="h-3 w-3" />
                      Open
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {tab === "graph" ? (
        <div className="relative min-h-0 flex-1 overflow-hidden p-3">
          <div ref={layoutRef} className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="relative min-h-0 flex-1">
              <div
                className="relative grid h-full min-h-0 overflow-hidden"
                style={{
                  gridTemplateColumns:
                    graphCanInlineDetails
                      ? `minmax(${GRAPH_CENTER_MIN_PX}px, 1fr) ${GRAPH_DIVIDER_PX}px minmax(${GRAPH_RIGHT_MIN_PX}px, ${graphRightWidthClamped}px)`
                      : `minmax(0, 1fr)`,
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
                    onStatusFilterChange: (filters) => setGraphState((prev) => ({ ...prev, statusFilters: filters })),
                  }}
                  activeRunId={activeRunId}
                  selectedRunId={selectedRunId || activeRunId}
                  childAttemptById={childAttemptById}
                  waitingFirstEvent={waitingFirstEvent}
                  artifactReplayMode={artifactReplayMode}
                  childScopeEvents={childScopeEvents}
                  childScopeProgress={childScopeProgress}
                onSelectNode={selectGraphNode}
                onSelectInlineChild={(childId, aggregateId) => {
                  const canonicalChild = canonicalChildId(aggregateId, childId);
                  setManualGraphChildId(canonicalChild);
                  setFollowActivePaused(true);
                  setGraphDetailsOpen(true);
                }}
                onEnterAggregate={(aggregateId) => {
                  if (!aggregateId) return;
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
                }}
                onOpenNodeDetails={() => setGraphDetailsOpen(true)}
                  follow={followActiveChild && !followActivePaused}
                  onToggleFollow={() => {
                    if (followActiveChild && followActivePaused) {
                      setFollowActivePaused(false);
                    } else {
                      setFollowActiveChild((v) => !v);
                      setFollowActivePaused(false);
                    }
                  }}
                  onPauseFollow={() => setFollowActivePaused(true)}
                  onScopedGraphChange={(graph) =>
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
                  }
                  onHighlightMode={(mode) => setGraphState((prev) => ({ ...prev, highlightMode: mode, manualOverride: true }))}
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
                  onBackScope={() =>
                    {
                      setFollowActivePaused(true);
                      setGraphScope((prev) =>
                        prev.level === "child"
                          ? { level: "aggregate", aggregateId: prev.aggregateId, childId: "" }
                          : { level: "suite", aggregateId: "", childId: "" }
                      );
                    }
                  }
                />
              </GraphErrorBoundary>
              {!graphDetailsOpen ? (
                <div className="absolute right-0 top-20 flex w-10 flex-col items-center gap-2 rounded-l-md border border-r-0 border-slate-700 bg-slate-950/95 p-1" style={{ zIndex: Z_GRAPH_UI }}>
                  <button
                    type="button"
                    disabled={!graphDetailsNode}
                    onClick={() => setGraphDetailsOpen(Boolean(graphDetailsNode))}
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
                    drawerOpen={Boolean(graphDetailsNode)}
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
                      onSelectChild: (childId) => {
                        if (!childId) return;
                        const canonicalChild = canonicalChildId(graphDetailsNode?.id || "", childId);
                        setFollowActivePaused(true);
                        setManualGraphChildId(canonicalChild);
                        setGraphScope({ level: "child", aggregateId: graphDetailsNode?.id || "", childId: canonicalChild });
                        setSelectedCaseId(canonicalChild);
                        const testId = String(canonicalChild).split("::")[0] || "";
                        if (testId) setSelectedTestId(testId);
                      },
                      onSelectEvent: (event, index) => {
                        setGraphState((prev) => ({
                          ...prev,
                          selectedEventId: event?.id || "",
                          selectedNodeId: event?.nodeId || prev.selectedNodeId,
                          playback: { ...prev.playback, mode: "timeline", cursor: index, isPlaying: false },
                        }));
                      },
                      onOpenRun: ({ runId }) => {
                        if (runId) handleSelectRun(runId, { scope: true });
                        setTab("tests");
                        setDrawerOpen(true);
                      },
                    }}
                  />
                </div>
              </>
                ) : null}

                {!graphCanInlineDetails && graphDetailsOpen ? (
              <div className="min-h-0 min-w-0 overflow-hidden rounded-md border border-slate-800/60 bg-slate-950/95" style={{ gridColumn: 1, gridRow: 2 }}>
                <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-2 py-1">
                  <div className="text-xs text-slate-400">Details (stacked, narrow viewport)</div>
                  <button type="button" className="rounded border border-slate-700 px-2 py-0.5 text-xs" onClick={() => setGraphDetailsOpen(false)}>
                    Collapse
                  </button>
                </div>
                <DetailsPane
                  drawerOpen={Boolean(graphDetailsNode)}
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
                    onSelectChild: (childId) => {
                      if (!childId) return;
                      const canonicalChild = canonicalChildId(graphDetailsNode?.id || "", childId);
                      setFollowActivePaused(true);
                      setManualGraphChildId(canonicalChild);
                      setGraphScope({ level: "child", aggregateId: graphDetailsNode?.id || "", childId: canonicalChild });
                      setSelectedCaseId(canonicalChild);
                      const testId = String(canonicalChild).split("::")[0] || "";
                      if (testId) setSelectedTestId(testId);
                    },
                    onSelectEvent: (event, index) => {
                      setGraphState((prev) => ({
                        ...prev,
                        selectedEventId: event?.id || "",
                        selectedNodeId: event?.nodeId || prev.selectedNodeId,
                        playback: { ...prev.playback, mode: "timeline", cursor: index, isPlaying: false },
                      }));
                    },
                    onOpenRun: ({ runId }) => {
                      if (runId) handleSelectRun(runId, { scope: true });
                      setTab("tests");
                      setDrawerOpen(true);
                    },
                  }}
                />
              </div>
                ) : null}
              </div>
            </div>
            {!runHistoryCollapsed ? (
              <>
                <div role="separator" aria-orientation="horizontal" onPointerDown={(e) => startDrag("h", e)} className="group relative my-1 h-[10px] cursor-row-resize touch-none" style={{ zIndex: Z_GRAPH_UI }}>
                  <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-slate-700 group-hover:bg-blue-400" />
                </div>
                <div className="relative min-h-0 overflow-hidden" style={{ height: `${layout.artifactsHeight}px`, zIndex: Z_PANE }}>
                  <ArtifactsSection
                    runs={runs}
                    showArtifactsPopoverFor={showArtifactsPopoverFor}
                    setShowArtifactsPopoverFor={setShowArtifactsPopoverFor}
                    bridge={bridge}
                    selectedRunId={selectedRunId}
                    onSelectRun={(runId) => handleSelectRun(runId, { scope: Boolean(runId) })}
                  />
                  <button
                    type="button"
                    onClick={() => setRunHistoryCollapsed(true)}
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
                    onClick={() => setRunHistoryCollapsed(false)}
                    className="mr-3 inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-200"
                  >
                    <ChevronUp className="h-3 w-3" />
                    Open
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {showIssuesDrawer ? <IssuesDrawer startup={startup} onClose={() => setShowIssuesDrawer(false)} /> : null}
    </div>
  );
}

function normalizeSuiteSelectionNodeId(nodeId, nodesList) {
  const raw = String(nodeId || "");
  if (!raw) return "";
  if (!raw.includes("::")) return raw;
  const root = String(raw.split("::")[0] || "");
  if (!root) return raw;
  const ids = new Set((Array.isArray(nodesList) ? nodesList : []).map((n) => String(n?.id || "")).filter(Boolean));
  return ids.has(root) ? root : raw;
}
