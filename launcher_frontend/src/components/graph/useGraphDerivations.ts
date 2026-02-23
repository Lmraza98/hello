import React, { useMemo } from "react";
import { buildAdjacency, buildExecutionPath, buildRuntimeNodeMap, collectBlockedChain, computeStatusCounts } from "./graphUtils";
import { collectReachable } from "./graphViewUtils";
import type { GraphEdgeLike, GraphNodeLike, GraphScope } from "./graphTypes";

export function useGraphDerivations({
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
}: {
  nodes: GraphNodeLike[];
  edges: GraphEdgeLike[];
  selectedNodeId: string;
  graphScope: GraphScope;
  aggregateFilterEnabled: boolean;
  aggregateFilterApplies: boolean;
  aggregateFilterIds: string[];
  baseScopeNodes: GraphNodeLike[];
  baseScopeEdges: GraphEdgeLike[];
  scopedNodes: GraphNodeLike[];
  scopedFilteredNodes: GraphNodeLike[];
  scopedFilteredEdges: GraphEdgeLike[];
  childMetaById: Map<string, GraphNodeLike>;
  events: any[];
  childScopeEvents: any[];
  currentEvent: any;
  currentNodeId: string;
  highlightMode: "upstream" | "downstream" | "both" | "none";
  query: string;
  viewMode: "story" | "full";
  pathHighlightMode: "off" | "path";
  isPlaying: boolean;
  blockedFocusNode: string;
  onSelectNode: (id: string) => void;
  onScopedGraphChange?: (graph: { nodes: GraphNodeLike[]; edges: GraphEdgeLike[]; scope: string }) => void;
}) {
  const scopedGraphSigRef = React.useRef("");

  const effectiveSelectedNodeId = useMemo(() => {
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

  const semanticAdjacencyBaseEdges = useMemo(
    () => (baseScopeEdges || []).filter((e: any) => e?.semantic !== false),
    [baseScopeEdges]
  );
  const adjacency = useMemo(() => buildAdjacency(semanticAdjacencyBaseEdges), [semanticAdjacencyBaseEdges]);
  const runtimeByNode = useMemo(() => buildRuntimeNodeMap([...(events || []), ...(childScopeEvents || [])]), [events, childScopeEvents]);
  const effectiveViewMode = isPlaying ? "story" : graphScope?.level === "child" ? "full" : viewMode;
  const effectivePathHighlightMode = isPlaying ? "path" : pathHighlightMode;

  const executionPath = useMemo(
    () =>
      buildExecutionPath({
        events: [...(events || []), ...(childScopeEvents || [])],
        childScopeEvents: [],
        graphLevel: graphScope?.level,
        selectedNodeId: String(selectedNodeId || ""),
      }),
    [events, childScopeEvents, graphScope?.level, selectedNodeId]
  );

  const searchableNodes = useMemo(() => baseScopeNodes, [baseScopeNodes]);

  const matchedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return new Set<string>();
    const set = new Set<string>();
    searchableNodes.forEach((n: any) => {
      const hay = `${n.name || ""} ${n.filePath || ""} ${n.id || ""}`.toLowerCase();
      if (hay.includes(q)) set.add(n.id);
    });
    return set;
  }, [query, searchableNodes]);
  const hasSearchQuery = query.trim().length > 0;

  const statusCounts = useMemo(() => computeStatusCounts(baseScopeNodes), [baseScopeNodes]);

  const filteredByAggregate = useMemo(() => {
    if (!aggregateFilterEnabled || !aggregateFilterApplies || !aggregateFilterIds.length) {
      return { nodes: scopedFilteredNodes, edges: scopedFilteredEdges };
    }
    const selected = new Set(aggregateFilterIds || []);
    const keep = new Set<string>();
    (scopedFilteredNodes || []).forEach((n: any) => {
      const id = String(n?.id || "");
      if (!id) return;
      for (const aid of selected) {
        if (id === aid || id.startsWith(`${aid}::`)) {
          keep.add(id);
          break;
        }
      }
      if (Array.isArray(n?.tags) && n.tags.includes("entry")) keep.add(id);
    });
    return {
      nodes: (scopedFilteredNodes || []).filter((n: any) => keep.has(String(n?.id || ""))),
      edges: (scopedFilteredEdges || []).filter((e: any) => keep.has(String(e?.from || "")) && keep.has(String(e?.to || ""))),
    };
  }, [aggregateFilterEnabled, aggregateFilterApplies, aggregateFilterIds, scopedFilteredNodes, scopedFilteredEdges]);
  const filteredNodes = filteredByAggregate.nodes;
  const filteredEdges = filteredByAggregate.edges;

  React.useEffect(() => {
    if (!aggregateFilterApplies || !aggregateFilterIds.length) return;
    const selectedRoot = String(effectiveSelectedNodeId || "").split("::")[0] || "";
    if (selectedRoot && aggregateFilterIds.includes(selectedRoot)) return;
    const fallback = aggregateFilterIds.find((id) =>
      (scopedFilteredNodes || []).some((n: any) => String(n?.id || "") === String(id || ""))
    );
    if (fallback && String(fallback) !== String(selectedNodeId || "")) {
      onSelectNode(String(fallback));
    }
  }, [aggregateFilterApplies, aggregateFilterIds, effectiveSelectedNodeId, selectedNodeId, scopedFilteredNodes, onSelectNode]);

  const statusById = useMemo(() => {
    const out = new Map<string, string>();
    const ingest = (list: any[]) => {
      (list || []).forEach((n: any) => {
        const id = String(n?.id || "");
        if (!id) return;
        out.set(id, String(n?.status || "not_run"));
      });
    };
    ingest(nodes);
    ingest(scopedNodes);
    childMetaById.forEach((meta, id) => {
      out.set(String(id), String(meta?.status || "not_run"));
    });
    return out;
  }, [nodes, scopedNodes, childMetaById]);

  const unmetDepsByNode = useMemo(() => {
    const out: Record<string, string[]> = {};
    const base = scopedNodes.length ? scopedNodes : nodes;
    base.forEach((n: any) => {
      const nodeId = String(n?.id || "");
      const deps = adjacency.prev.get(nodeId) || [];
      out[nodeId] = deps.filter((d) => (statusById.get(String(d)) || "not_run") !== "passed");
    });
    return out;
  }, [scopedNodes, nodes, adjacency, statusById]);

  React.useEffect(() => {
    const semanticScopedEdges = (filteredEdges || []).filter((e: any) => e.semantic !== false);
    const nextScopedNodes = (filteredNodes || []).filter((n: any) => !(Array.isArray(n?.tags) && n.tags.includes("entry")));
    const nodeSig = nextScopedNodes.map((n: any) => String(n?.id || "")).join("|");
    const edgeSig = semanticScopedEdges.map((e: any) => `${String(e?.from || "")}->${String(e?.to || "")}`).join("|");
    const sig = `${String(graphScope?.level || "suite")}::${nextScopedNodes.length}::${semanticScopedEdges.length}::${nodeSig}::${edgeSig}`;
    if (scopedGraphSigRef.current === sig) return;
    scopedGraphSigRef.current = sig;
    onScopedGraphChange?.({
      nodes: nextScopedNodes,
      edges: semanticScopedEdges,
      scope: String(graphScope?.level || "suite"),
    });
  }, [onScopedGraphChange, filteredNodes, filteredEdges, graphScope?.level]);

  const cycleInfo = useMemo(() => {
    const nodeIds = new Set((filteredNodes || []).map((n: any) => String(n?.id || "")));
    const adj = new Map<string, string[]>();
    (filteredEdges || []).forEach((e: any) => {
      const from = String(e?.from || "");
      const to = String(e?.to || "");
      if (!nodeIds.has(from) || !nodeIds.has(to)) return;
      const row = adj.get(from) || [];
      row.push(to);
      adj.set(from, row);
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycleEdges = new Set<string>();
    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visiting.add(id);
      (adj.get(id) || []).forEach((nxt) => {
        if (visiting.has(nxt)) {
          cycleEdges.add(`${id}->${nxt}`);
          return;
        }
        if (!visited.has(nxt)) dfs(nxt);
      });
      visiting.delete(id);
      visited.add(id);
    };
    nodeIds.forEach((id) => {
      if (!visited.has(id)) dfs(id);
    });
    return { hasCycle: cycleEdges.size > 0, cycleEdges };
  }, [filteredNodes, filteredEdges]);

  const activeNeighborhood = useMemo(() => {
    const anchor = String(selectedNodeId || currentNodeId || "");
    if (!anchor) return new Set<string>();
    if (highlightMode === "none") return new Set<string>([anchor]);
    const out = new Set<string>([anchor]);
    if (highlightMode === "upstream" || highlightMode === "both") {
      collectReachable(anchor, adjacency.prev).forEach((id) => out.add(id));
    }
    if (highlightMode === "downstream" || highlightMode === "both") {
      collectReachable(anchor, adjacency.next).forEach((id) => out.add(id));
    }
    return out;
  }, [highlightMode, selectedNodeId, currentNodeId, adjacency]);

  const currentDeps = useMemo(() => Array.from(adjacency.prev.get(currentNodeId) || []), [adjacency, currentNodeId]);
  const prereqProof = useMemo(() => {
    const total = currentDeps.length;
    if (!total) return { total: 0, proven: 0, missing: 0 };
    const startedAt = runtimeByNode.get(currentNodeId)?.startedAt || Number(currentEvent?.ts || Date.now());
    let proven = 0;
    let missing = 0;
    currentDeps.forEach((depId) => {
      const dep = runtimeByNode.get(depId);
      const doneBefore = !!dep?.finishedAt && dep.finishedAt <= startedAt;
      if (doneBefore) proven += 1;
      else {
        const terminal = String(dep?.terminalStatus || "");
        if (!terminal) missing += 1;
      }
    });
    return { total, proven, missing };
  }, [currentDeps, runtimeByNode, currentNodeId, currentEvent?.ts]);

  const blockedChain = useMemo(() => collectBlockedChain(blockedFocusNode, unmetDepsByNode), [blockedFocusNode, unmetDepsByNode]);

  return {
    effectiveSelectedNodeId,
    semanticAdjacencyBaseEdges,
    adjacency,
    runtimeByNode,
    effectiveViewMode,
    effectivePathHighlightMode,
    executionPath,
    matchedIds,
    hasSearchQuery,
    statusCounts,
    filteredByAggregate,
    filteredNodes,
    filteredEdges,
    statusById,
    unmetDepsByNode,
    cycleInfo,
    activeNeighborhood,
    prereqProof,
    blockedChain,
  };
}
