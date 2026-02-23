import React, { useMemo, useRef, useState } from "react";
import { layoutDagre } from "../../lib/graph/layoutDagre";
import { Z_GRAPH_CANVAS, Z_GRAPH_UI } from "../../lib/zIndex";
import ChildDagView from "./ChildDagView";
import GraphTopToolbar from "./GraphTopToolbar";
import GraphPlaybackBar from "./GraphPlaybackBar";
import type { GraphEdgeLike, GraphNodeLike, GraphScope, GraphStateLike } from "./graphTypes";
import { useGraphViewModel } from "./useGraphViewModel";
import { useGraphModels } from "./useGraphModels";
import { GraphTooltips } from "./GraphTooltips";
import { GraphCanvas } from "./GraphCanvas";
import { canonicalChildId } from "./graphUtils";
import { usePlaybackEntries } from "./usePlaybackEntries";
import { useGraphDerivations } from "./useGraphDerivations";
import { useGraphViewport } from "./useGraphViewport";
import { useCanvasInteractions } from "./useCanvasInteractions";
import { useRuntimeDebug, useRuntimeDebugFlag } from "./useRuntimeDebug";

type TestDependencyGraphProps = {
  graphState: GraphStateLike;
  onSelectNode: (id: string) => void;
  onSelectInlineChild?: (childId: string, aggregateId: string) => void;
  onHighlightMode: (mode: "upstream" | "downstream" | "both" | "none") => void;
  onPlayback: (patch: Partial<{ isPlaying: boolean; cursor: number; speed: number; mode: "timeline" | "path" }>) => void;
  onOpenNodeDetails?: () => void;
  breadcrumb?: string;
  onSetBottomTab?: (tab: "timeline" | "artifacts") => void;
  onScopedGraphChange?: (graph: { nodes: GraphNodeLike[]; edges: GraphEdgeLike[]; scope: string }) => void;
  bottomTab?: "timeline" | "artifacts";
  activeRunId?: string;
  selectedRunId?: string;
  childAttemptById?: Record<string, string | number>;
  childScopeEvents?: any[];
  childScopeProgress?: any[];
  waitingFirstEvent?: boolean;
  artifactReplayMode?: boolean;
  graphScope?: GraphScope;
  onEnterAggregate?: (aggregateId: string) => void;
  follow?: boolean;
  onToggleFollow?: () => void;
  onPauseFollow?: () => void;
  aggregateFilterIds?: string[];
  onAggregateFilterChange?: (value: string[]) => void;
  aggregateFilterOptions?: Array<{ id: string; name: string; total?: number }>;
  bubbleAggregateId?: string;
};

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  React.useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

const EMPTY_OBJ = {};
const EMPTY_ARR: any[] = [];
const DEFAULT_GRAPH_SCOPE: GraphScope = { level: "suite", aggregateId: "", childId: "" };

export default function TestDependencyGraph({
  graphState,
  onSelectNode,
  onSelectInlineChild,
  onHighlightMode,
  onPlayback,
  onOpenNodeDetails,
  breadcrumb = "Graph",
  onSetBottomTab,
  onScopedGraphChange,
  bottomTab = "timeline",
  activeRunId = "",
  selectedRunId = "",
  childAttemptById = EMPTY_OBJ as Record<string, string | number>,
  childScopeEvents = EMPTY_ARR,
  childScopeProgress = EMPTY_ARR,
  waitingFirstEvent = false,
  artifactReplayMode = false,
  graphScope = DEFAULT_GRAPH_SCOPE,
  onEnterAggregate,
  follow = false,
  onToggleFollow,
  onPauseFollow,
  aggregateFilterIds = EMPTY_ARR,
  onAggregateFilterChange,
  aggregateFilterOptions = EMPTY_ARR,
  bubbleAggregateId = "",
}: TestDependencyGraphProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"story" | "full">("full");
  const [pathHighlightMode, setPathHighlightMode] = useState<"off" | "path">("off");
  const [statusDim, setStatusDim] = useState<Record<string, boolean>>({});
  const [blockedFocusNode, setBlockedFocusNode] = useState("");
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [openInspectorNodeId, setOpenInspectorNodeId] = useState("");
  const [inspectorPinned, setInspectorPinned] = useState(false);

  const runtimeDebug = useRuntimeDebugFlag();

  const nodes = graphState.nodes || EMPTY_ARR;
  const edges = graphState.edges || EMPTY_ARR;
  const selectedNodeId = graphState.selectedNodeId || "";
  const highlightMode = graphState.highlightMode || "both";
  const events = graphState.events || EMPTY_ARR;
  const aggregateFilterEnabled = Array.isArray(aggregateFilterOptions) && aggregateFilterOptions.length > 0;
  const aggregateFilterApplies = String(graphScope?.level || "suite") === "suite";
  const selectedNodeIdForModels = useMemo(() => {
    const rawSelected = String(selectedNodeId || "");
    if (String(graphScope?.level || "") !== "suite") return rawSelected;
    const aggregateIds = new Set(
      (nodes || [])
        .filter((n: any) => Boolean(n?.aggregateSummary))
        .map((n: any) => String(n?.id || ""))
        .filter(Boolean)
    );
    const selectedRoot = rawSelected.includes("::") ? String(rawSelected.split("::")[0] || "") : rawSelected;
    const selectedAggregate = aggregateIds.has(selectedRoot) ? selectedRoot : "";
    if (aggregateFilterEnabled && aggregateFilterApplies && Array.isArray(aggregateFilterIds) && aggregateFilterIds.length > 0) {
      const filterSet = new Set(aggregateFilterIds.map((id) => String(id || "")).filter(Boolean));
      if (selectedAggregate && filterSet.has(selectedAggregate)) return selectedAggregate;
      const fallback = aggregateFilterIds.find((id) => aggregateIds.has(String(id || "")));
      return String(fallback || selectedAggregate || rawSelected || "");
    }
    return String(selectedAggregate || rawSelected || "");
  }, [selectedNodeId, graphScope?.level, nodes, aggregateFilterEnabled, aggregateFilterApplies, aggregateFilterIds]);

  const {
    playbackMode,
    pathSteps,
    playbackEntries,
    cursor,
    isPlaying,
    speed,
    currentEvent,
    pathExplanation,
    playbackNodeId,
    transition,
    eventBadgeByNode,
  } = usePlaybackEntries({
    graphState,
    events,
    childScopeEvents,
  });

  const {
    nodeById,
    activeAggregateIdForView,
    aggregateChildrenGraph,
    inlineAggregateGraph,
    childDagModel,
    baseScopeNodes,
    baseScopeEdges,
  } = useGraphModels({
    nodes,
    edges,
    graphScope,
    selectedNodeId: selectedNodeIdForModels,
    childAttemptById,
    selectedRunId,
    activeRunId,
    childScopeEvents,
    childScopeProgress,
    waitingFirstEvent,
    events,
  });

  const liveRunningNodeId = useMemo(
    () => String(nodes.find((n: any) => String(n?.status || "").toLowerCase() === "running")?.id || ""),
    [nodes]
  );

  const aggregateRunningNodeId = useMemo(() => {
    const aggregateId = activeAggregateIdForView;
    if (!aggregateId) return "";
    const aggregateNode = nodes.find((n: any) => String(n?.id || "") === aggregateId) || null;
    if (!aggregateNode?.aggregateSummary?.activeChildId) return "";
    return canonicalChildId(aggregateId, String(aggregateNode.aggregateSummary.activeChildId));
  }, [activeAggregateIdForView, nodes]);

  const suiteAggregateRunningNodeId = useMemo(() => {
    for (const node of nodes || []) {
      const aggregateId = String(node?.id || "");
      const activeChild = String(node?.aggregateSummary?.activeChildId || "");
      if (!aggregateId || !activeChild) continue;
      return canonicalChildId(aggregateId, activeChild);
    }
    return "";
  }, [nodes]);

  const {
    scopedNodes,
    scopedNodeById,
    childMetaById,
    scopedRunningNodeId,
    currentNodeId,
    filteredNodes: scopedFilteredNodes,
    filteredEdges: scopedFilteredEdges,
  } = useGraphViewModel({
    nodes,
    graphScope,
    inlineAggregateGraph,
    childDagModel,
    aggregateChildrenGraph,
    scopedSourceNodes: baseScopeNodes,
    scopedSourceEdges: baseScopeEdges,
    selectedNodeId: selectedNodeIdForModels,
    liveRunningNodeId,
    aggregateRunningNodeId,
    suiteAggregateRunningNodeId,
    playbackNodeId,
    playbackActive: isPlaying,
  });

  const derivations = useGraphDerivations({
    nodes,
    edges,
    selectedNodeId,
    graphScope,
    aggregateFilterEnabled,
    aggregateFilterApplies,
    aggregateFilterIds,
    baseScopeNodes,
    baseScopeEdges,
    scopedNodes,
    scopedFilteredNodes,
    scopedFilteredEdges,
    childMetaById,
    events,
    childScopeEvents,
    currentEvent,
    currentNodeId,
    highlightMode,
    query,
    viewMode,
    pathHighlightMode,
    isPlaying,
    blockedFocusNode,
    onSelectNode,
    onScopedGraphChange,
  });

  const filteredNodes = derivations.filteredNodes;
  const filteredEdges = derivations.filteredEdges;

  const aggregateLayoutTuning = useMemo(() => {
    const aggregateLike = Boolean(inlineAggregateGraph) || graphScope?.level === "aggregate";
    if (!aggregateLike) return { rankGap: 70, rowGap: 11, nodeWidth: 232 };
    const nodeCount = Array.isArray(filteredNodes) ? filteredNodes.length : 0;
    const edgeCount = Array.isArray(filteredEdges) ? filteredEdges.length : 0;
    const density = nodeCount > 0 ? edgeCount / nodeCount : 0;
    let rankGap = 84;
    let rowGap = 24;
    let nodeWidth = 236;
    if (density >= 1.4) {
      rankGap = 94;
      rowGap = 32;
    } else if (density <= 0.8) {
      rankGap = 76;
      rowGap = 18;
    }
    if (nodeCount >= 140) {
      rankGap -= 8;
      rowGap -= 4;
      nodeWidth = 238;
    } else if (nodeCount <= 36) {
      rankGap += 6;
      rowGap += 4;
    }
    return {
      rankGap: Math.max(66, Math.min(108, rankGap)),
      rowGap: Math.max(10, Math.min(38, rowGap)),
      nodeWidth: Math.max(220, Math.min(240, nodeWidth)),
    };
  }, [graphScope, inlineAggregateGraph, filteredNodes, filteredEdges]);

  const labelById = useMemo(() => {
    const out: Record<string, string> = {};
    (filteredNodes || []).forEach((n: any) => {
      out[String(n?.id || "")] = String(n?.name || n?.id || "");
    });
    return out;
  }, [filteredNodes]);

  const layout = useMemo(
    () => {
      const replayTopOffset = artifactReplayMode ? 100 : 0;
      return layoutDagre(
        filteredNodes.map((n: any) => ({ id: n.id })),
        filteredEdges,
        {
          nodeWidth: inlineAggregateGraph ? aggregateLayoutTuning.nodeWidth : graphScope?.level === "suite" ? 236 : graphScope?.level === "aggregate" ? aggregateLayoutTuning.nodeWidth : 232,
          nodeHeight: graphScope?.level === "suite" ? (filteredNodes.some((n: any) => n.aggregateSummary) ? 64 : 56) : 56,
          rankGap: inlineAggregateGraph ? aggregateLayoutTuning.rankGap : graphScope?.level === "suite" ? 70 : graphScope?.level === "aggregate" ? aggregateLayoutTuning.rankGap : 70,
          rowGap: inlineAggregateGraph ? aggregateLayoutTuning.rowGap : graphScope?.level === "suite" ? 14 : graphScope?.level === "aggregate" ? aggregateLayoutTuning.rowGap : 12,
          padding: graphScope?.level === "suite" ? 110 : 24,
          // Suite view is intentionally biased up/left to avoid dead space around the first lane.
          paddingX: graphScope?.level === "suite" ? 50 : 24,
          paddingY: (graphScope?.level === "suite" ? 10 : 24) + replayTopOffset,
          labelById,
          maxRowsPerLayer: graphScope?.level === "aggregate" || inlineAggregateGraph ? 16 : Number.POSITIVE_INFINITY,
        }
      );
    },
    [filteredNodes, filteredEdges, graphScope, inlineAggregateGraph, aggregateLayoutTuning, labelById, artifactReplayMode]
  );

  const {
    effectiveSelectedNodeId: selectedNodeIdForRender,
    effectiveViewMode,
    effectivePathHighlightMode,
    executionPath,
    matchedIds,
    hasSearchQuery,
    statusCounts,
    unmetDepsByNode,
    cycleInfo,
    activeNeighborhood,
    prereqProof,
    blockedChain,
  } = derivations;

  const entryNodeId = useMemo(() => {
    const incoming = new Map<string, number>();
    filteredNodes.forEach((n: any) => incoming.set(String(n?.id || ""), 0));
    filteredEdges.forEach((e: any) => {
      const to = String(e?.to || "");
      if (!incoming.has(to)) return;
      incoming.set(to, (incoming.get(to) || 0) + 1);
    });
    const roots = filteredNodes
      .filter((n: any) => (incoming.get(String(n?.id || "")) || 0) === 0)
      .sort((a: any, b: any) => {
        const ax = layout.byId[a.id]?.x ?? Number.POSITIVE_INFINITY;
        const bx = layout.byId[b.id]?.x ?? Number.POSITIVE_INFINITY;
        if (ax !== bx) return ax - bx;
        return String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""));
      });
    const preferred = roots.find((n: any) => /gate|start|ready/i.test(String(n?.name || ""))) || roots[0] || null;
    return String(preferred?.id || "");
  }, [filteredNodes, filteredEdges, layout.byId]);
  const entryNodePos = entryNodeId ? layout.byId[entryNodeId] : null;

  useRuntimeDebug({
    runtimeDebug,
    graphScope,
    nodes,
    edges,
    playbackEntries,
    aggregateChildrenGraph,
    inlineAggregateGraph,
    childDagModel,
    childScopeEvents,
    events,
    nodeById,
    childAttemptById,
    selectedRunId,
    activeRunId,
  });

  const {
    overlayTick,
    scheduleViewportUpdate,
    renderedNodes,
    renderedEdges,
  } = useGraphViewport({
    scrollRef,
    layoutById: layout.byId,
    zoom,
    filteredNodes,
    filteredEdges,
    hoveredNodeId,
    openInspectorNodeId,
  });

  const { zoomBy, onCanvasWheel, onCanvasPointerDown, onCanvasScroll, fitView } = useCanvasInteractions({
    scrollRef,
    zoom,
    setZoom,
    layout,
    filteredNodesLength: filteredNodes.length,
    currentNodeId,
    followNodeId: isPlaying
      ? String(playbackNodeId || "")
      : String(scopedRunningNodeId || aggregateRunningNodeId || suiteAggregateRunningNodeId || liveRunningNodeId || ""),
    follow,
    onPauseFollow,
    graphScopeSigParts: graphScope,
    cursor,
    requestViewportRefresh: scheduleViewportUpdate,
  });

  const hoveredNode = hoveredNodeId ? filteredNodes.find((n: any) => n.id === hoveredNodeId) || null : null;
  const hoveredNodePos = hoveredNodeId ? layout.byId[hoveredNodeId] : null;
  const inspectorNode = openInspectorNodeId ? filteredNodes.find((n: any) => n.id === openInspectorNodeId) || null : null;
  const inspectorNodePos = openInspectorNodeId ? layout.byId[openInspectorNodeId] : null;

  function toggleStatusDim(status: string) {
    setStatusDim((prev) => ({ ...prev, [status]: !prev[status] }));
  }

  const cursorRef = useLatestRef(cursor);
  const entriesLenRef = useLatestRef(playbackEntries.length);
  const isPlayingRef = useLatestRef(isPlaying);
  const onPlaybackRef = useLatestRef(onPlayback);
  const fitViewRef = useLatestRef(fitView);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const el = document.getElementById("graph-search-input") as HTMLInputElement | null;
        el?.focus();
        el?.select();
        return;
      }
      if (typing) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        fitViewRef.current();
      } else if (event.key.toLowerCase() === "j" || event.key === "ArrowLeft") {
        event.preventDefault();
        const currentCursor = cursorRef.current;
        onPlaybackRef.current({ cursor: Math.max(0, currentCursor - 1), isPlaying: false });
      } else if (event.key.toLowerCase() === "k" || event.key === "ArrowRight") {
        event.preventDefault();
        const currentCursor = cursorRef.current;
        const entriesLen = entriesLenRef.current;
        onPlaybackRef.current({ cursor: Math.min(Math.max(entriesLen - 1, 0), currentCursor + 1), isPlaying: false });
      } else if (event.key.toLowerCase() === "l" || event.key === " ") {
        event.preventDefault();
        onPlaybackRef.current({ isPlaying: !isPlayingRef.current });
      } else if (event.key === "Escape") {
        setHoveredNodeId("");
        setOpenInspectorNodeId("");
        setInspectorPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!openInspectorNodeId) return;
    if (inspectorPinned) return;
    if (!selectedNodeId) return;
    if (selectedNodeId !== openInspectorNodeId) {
      setOpenInspectorNodeId("");
    }
  }, [selectedNodeId, openInspectorNodeId, inspectorPinned]);

  React.useEffect(() => {
    if (!openInspectorNodeId || inspectorPinned) return;
    setOpenInspectorNodeId("");
  }, [activeRunId]);

  React.useEffect(() => {
    if (!openInspectorNodeId || inspectorPinned) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (inspectorRef.current && inspectorRef.current.contains(target)) return;
      if (target.closest("[data-graph-node-id]")) return;
      setOpenInspectorNodeId("");
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openInspectorNodeId, inspectorPinned]);

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div style={{ zIndex: Z_GRAPH_UI }}>
        <GraphTopToolbar
          breadcrumb={breadcrumb}
          nodeCount={filteredNodes.length}
          edgeCount={filteredEdges.length}
          viewMode={effectiveViewMode}
          onViewModeChange={setViewMode}
          follow={follow}
          onToggleFollow={() => onToggleFollow?.()}
          pathHighlightMode={effectivePathHighlightMode}
          onPathHighlightModeChange={setPathHighlightMode}
          highlightMode={highlightMode}
          onHighlightMode={onHighlightMode}
          query={query}
          onQueryChange={setQuery}
          statusDim={statusDim}
          statusCounts={statusCounts}
          onToggleStatusDim={toggleStatusDim}
          aggregateOptions={aggregateFilterEnabled ? aggregateFilterOptions : []}
          aggregateFilterIds={aggregateFilterIds}
          onAggregateFilterChange={onAggregateFilterChange}
          zoom={zoom}
          onZoomIn={() => zoomBy(0.1)}
          onZoomOut={() => zoomBy(-0.1)}
          onZoomReset={() => setZoom(1)}
        />
      </div>

      <div ref={scrollRef} onScroll={onCanvasScroll} onPointerDown={onCanvasPointerDown} onWheel={onCanvasWheel} className="min-h-0 flex-1 overflow-auto rounded border border-slate-800/70 bg-slate-950/40 p-2 pt-3" style={{ zIndex: Z_GRAPH_CANVAS }}>
        {graphScope?.level === "child" && !inlineAggregateGraph ? (
          <ChildDagView
            source={childDagModel?.source || "placeholder"}
            runId={childDagModel?.runId}
            attemptId={childDagModel?.attemptId}
          />
        ) : null}
        <GraphCanvas
          layout={layout}
          zoom={zoom}
          allNodes={filteredNodes}
          allEdges={filteredEdges}
          aggregateFilterIds={aggregateFilterIds}
          renderedEdges={renderedEdges}
          executionPath={executionPath}
          transition={transition}
          blockedChain={blockedChain}
          cycleInfo={cycleInfo}
          activeNeighborhood={activeNeighborhood}
          effectiveViewMode={effectiveViewMode}
          hasSearchQuery={hasSearchQuery}
          matchedIds={matchedIds}
          effectivePathHighlightMode={effectivePathHighlightMode}
          entryNodeId={entryNodeId}
          entryNodePos={entryNodePos}
          renderedNodes={renderedNodes}
          selectedNodeId={selectedNodeIdForRender}
          currentNodeId={currentNodeId}
          statusDim={statusDim}
          unmetDepsByNode={unmetDepsByNode}
          scopedNodeById={scopedNodeById}
          childMetaById={childMetaById}
          eventBadgeByNode={eventBadgeByNode}
          prereqProof={prereqProof}
          bubbleAggregateId={bubbleAggregateId}
          setHoveredNodeId={setHoveredNodeId}
          graphScope={graphScope}
          onSelectNode={onSelectNode}
          onSelectInlineChild={onSelectInlineChild}
          onEnterAggregate={onEnterAggregate}
          setOpenInspectorNodeId={setOpenInspectorNodeId}
          setInspectorPinned={setInspectorPinned}
          setBlockedFocusNode={setBlockedFocusNode}
          onOpenNodeDetails={onOpenNodeDetails}
        />
      </div>

      {artifactReplayMode ? (
        <div style={{ zIndex: Z_GRAPH_UI }}>
          <GraphPlaybackBar
            cursor={cursor}
            entriesLength={playbackEntries.length}
            currentNodeLabel={currentNodeId ? String(scopedNodeById.get(currentNodeId)?.name || childMetaById.get(currentNodeId)?.name || nodeById.get(currentNodeId)?.name || currentNodeId) : ""}
            speed={speed}
            isPlaying={isPlaying}
            playbackMode={playbackMode}
            pathStepsLength={pathSteps.length}
            pathExplanation={pathExplanation}
            bottomTab={bottomTab}
            onPlayback={onPlayback}
            onSetBottomTab={onSetBottomTab}
          />
        </div>
      ) : null}
      <GraphTooltips
        hoveredNode={hoveredNode}
        hoveredNodePos={hoveredNodePos}
        zoom={zoom}
        overlayTick={overlayTick}
        scrollRef={scrollRef}
        inspectorNode={inspectorNode}
        inspectorNodePos={inspectorNodePos}
        inspectorRef={inspectorRef}
        inspectorPinned={inspectorPinned}
        setInspectorPinned={setInspectorPinned}
        setOpenInspectorNodeId={setOpenInspectorNodeId}
      />
    </section>
  );
}
