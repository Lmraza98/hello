import { useMemo } from "react";
import { canonicalChildId } from "./graphUtils";
import type { ChildDagGraphModel, GraphEdgeLike, GraphNodeLike, GraphScope } from "./graphTypes";

type AggregateGraph = {
  aggregateId: string;
  nodes: GraphNodeLike[];
  edges: GraphEdgeLike[];
  activeChildId?: string;
} | null;

type Params = {
  nodes: GraphNodeLike[];
  graphScope: GraphScope;
  inlineAggregateGraph: AggregateGraph;
  childDagModel: ChildDagGraphModel | null;
  aggregateChildrenGraph: AggregateGraph;
  scopedSourceNodes: GraphNodeLike[];
  scopedSourceEdges: GraphEdgeLike[];
  selectedNodeId: string;
  liveRunningNodeId: string;
  aggregateRunningNodeId: string;
  suiteAggregateRunningNodeId: string;
  playbackNodeId: string;
  playbackActive: boolean;
};

export function useGraphViewModel({
  nodes,
  graphScope,
  inlineAggregateGraph,
  childDagModel,
  aggregateChildrenGraph,
  scopedSourceNodes,
  scopedSourceEdges,
  selectedNodeId,
  liveRunningNodeId,
  aggregateRunningNodeId,
  suiteAggregateRunningNodeId,
  playbackNodeId,
  playbackActive,
}: Params) {
  const scopedNodes = useMemo(() => {
    return scopedSourceNodes || [];
  }, [scopedSourceNodes]);

  const scopedNodeById = useMemo(() => {
    const map = new Map<string, GraphNodeLike>();
    [...(nodes || []), ...(scopedNodes || [])].forEach((n) => map.set(String(n?.id || ""), n));
    return map;
  }, [nodes, scopedNodes]);

  const childMetaById = useMemo(() => {
    const map = new Map<string, GraphNodeLike>();
    (nodes || []).forEach((node) => {
      const parentId = String(node?.id || "");
      const children = Array.isArray(node?.aggregateChildren) ? node.aggregateChildren : [];
      children.forEach((child) => {
        const canonicalId = canonicalChildId(parentId, String(child?.id || child?.rawChildKey || ""));
        if (!canonicalId) return;
        map.set(canonicalId, {
          id: canonicalId,
          name: String(child?.name || child?.id || canonicalId),
          filePath: String(child?.filePath || node?.filePath || ""),
          status: String(child?.status || "not_run") as GraphNodeLike["status"],
          durationMs: child?.durationMs,
          suiteId: String(node?.suiteId || ""),
          tags: [],
        });
      });
    });
    return map;
  }, [nodes]);

  const scopedRunningNodeId = useMemo(() => {
    const list = scopedNodes || [];
    for (let idx = list.length - 1; idx >= 0; idx -= 1) {
      const row = list[idx];
      if (String(row?.status || "").toLowerCase() === "running") {
        return String(row?.id || "");
      }
    }
    return "";
  }, [scopedNodes]);

  const currentNodeId = useMemo(() => {
    // Playback cursor should only drive focus while playback is actively running.
    // Otherwise, prefer live run status so Follow tracks the actual running node.
    if (playbackActive && playbackNodeId) return playbackNodeId;
    
    // 2. Otherwise fall back to scope/selection active tracking
    if (graphScope?.level === "aggregate" && aggregateChildrenGraph?.activeChildId) {
      return String(aggregateChildrenGraph.activeChildId);
    }
    if (scopedRunningNodeId) return scopedRunningNodeId;
    if (aggregateRunningNodeId) return aggregateRunningNodeId;
    if (suiteAggregateRunningNodeId) return suiteAggregateRunningNodeId;
    if (liveRunningNodeId) return liveRunningNodeId;
    return String(selectedNodeId || "");
  }, [graphScope, aggregateChildrenGraph, scopedRunningNodeId, liveRunningNodeId, aggregateRunningNodeId, suiteAggregateRunningNodeId, playbackNodeId, playbackActive, selectedNodeId]);

  const currentNodeMeta = useMemo(
    () => scopedNodeById.get(currentNodeId) || childMetaById.get(currentNodeId) || null,
    [scopedNodeById, childMetaById, currentNodeId]
  );

  const filteredNodes = useMemo(() => scopedNodes, [scopedNodes]);
  const filteredIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return (scopedSourceEdges || []).filter((e) => filteredIds.has(e.from) && filteredIds.has(e.to));
  }, [scopedSourceEdges, filteredIds]);

  return {
    scopedNodes,
    scopedNodeById,
    childMetaById,
    scopedRunningNodeId,
    currentNodeId,
    currentNodeMeta,
    filteredNodes,
    filteredIds,
    filteredEdges,
  };
}
