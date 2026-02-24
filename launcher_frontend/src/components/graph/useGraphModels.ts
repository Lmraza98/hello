import { useMemo, useCallback } from "react";
import { canonicalChildId, buildChildDagGraphModel } from "./graphUtils";
import type { GraphNodeLike, GraphEdgeLike, GraphScope, GraphStateLike } from "./graphTypes";
import type { RunEvent } from "../../lib/graph/types";
import type { ChildProgressRow } from "../../app/types/contracts";

type AggregateChildExtended = NonNullable<GraphNodeLike["aggregateChildren"]>[number] & {
  child_group?: string;
  child_lane?: number;
  child_order?: number;
  dependsOn?: string[];
};

function isPytestGateAggregateNode(node: GraphNodeLike | undefined | null) {
  const id = String(node?.id || "").toLowerCase();
  const name = String(node?.name || "").toLowerCase();
  return id === "backend-gate-pytest-ready" || /pytest runtime ready/.test(id) || /pytest runtime ready/.test(name);
}

export function useGraphModels({
  nodes,
  edges,
  graphScope,
  selectedNodeId,
  aggregateFilterIds,
  childAttemptById,
  selectedRunId,
  activeRunId,
  childScopeEvents,
  childScopeProgress,
  waitingFirstEvent,
  events,
}: {
  nodes: GraphNodeLike[];
  edges: GraphEdgeLike[];
  graphScope: GraphScope;
  selectedNodeId: string;
  aggregateFilterIds?: string[];
  childAttemptById?: Record<string, string | number>;
  selectedRunId?: string;
  activeRunId?: string;
  childScopeEvents?: RunEvent[];
  childScopeProgress?: ChildProgressRow[];
  waitingFirstEvent?: boolean;
  events?: RunEvent[];
}) {
  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNodeLike>();
    (nodes || []).forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  const activeAggregateIdForView = useMemo(() => {
    if (graphScope?.level === "aggregate") {
      return String(graphScope?.aggregateId || selectedNodeId || "").trim();
    }
    if (graphScope?.level === "child") {
      return String(graphScope?.aggregateId || "").trim();
    }
    return "";
  }, [graphScope, selectedNodeId]);

  const buildAggregateChildrenModel = useCallback(
    (aggregateId: string) => {
      const aid = String(aggregateId || "").trim();
      if (!aid) return null;
      const aggregateNode = nodeById.get(aid);
      const allChildren: AggregateChildExtended[] = Array.isArray(aggregateNode?.aggregateChildren) ? (aggregateNode.aggregateChildren as AggregateChildExtended[]) : [];
      if (!allChildren.length) return null;
      const workflowChildren = allChildren.filter((child) => {
        const childGroup = String(child?.childGroup || child?.child_group || "").toLowerCase();
        const rawId = String(child?.id || child?.rawChildKey || "").toLowerCase();
        return childGroup.includes("workflow") || rawId.includes("::workflow.");
      });
      // Prefer workflow lane when available so aggregate graph reflects actionable E2E flow.
      const children = workflowChildren.length > 0 ? workflowChildren : allChildren;
      const canonicalByRaw = new Map<string, string>();
      const toCanonical = (raw: string) => canonicalChildId(aid, String(raw || ""));
      const nodesOut = children
        .map((child) => {
          const rawId = String(child?.id || child?.rawChildKey || "");
          const canonicalId = toCanonical(rawId);
          if (rawId) canonicalByRaw.set(rawId, canonicalId);
          canonicalByRaw.set(canonicalId, canonicalId);
          const childGroup = String(child?.childGroup || child?.child_group || "").trim() || "Component Tests";
          const childLane =
            typeof child?.childLane === "number"
              ? Number(child.childLane)
              : (typeof child?.child_lane === "number" ? Number(child.child_lane) : (childGroup.toLowerCase().includes("workflow") ? 0 : 1));
          const childOrder =
            typeof child?.childOrder === "number"
              ? Number(child.childOrder)
              : (typeof child?.child_order === "number" ? Number(child.child_order) : 999999);
          return {
            id: canonicalId,
            rawChildKey: rawId,
            name: String(child?.name || child?.id || "child"),
            filePath: String(child?.filePath || aggregateNode?.filePath || ""),
            status: String(child?.status || "not_run"),
            durationMs: child?.durationMs,
            suiteId: String(aggregateNode?.suiteId || "aggregate"),
            tags: ["child"],
            childGroup,
            childLane,
            childOrder,
          };
        })
        .filter((n) => String(n?.id || "").length > 0);
      nodesOut.sort((a, b) => {
        const laneDelta = Number(a?.childLane || 1) - Number(b?.childLane || 1);
        if (laneDelta !== 0) return laneDelta;
        const orderDelta = Number(a?.childOrder || 999999) - Number(b?.childOrder || 999999);
        if (orderDelta !== 0) return orderDelta;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      });
      const ids = new Set(nodesOut.map((n) => n.id));
      const explicitEdges: GraphEdgeLike[] = [];
      children.forEach((child) => {
        const rawTo = String(child?.id || child?.rawChildKey || "");
        const to = canonicalByRaw.get(rawTo) || toCanonical(rawTo);
        const deps = Array.isArray(child?.depends_on) ? child.depends_on : Array.isArray(child?.dependsOn) ? child.dependsOn : [];
        deps.forEach((dep) => {
          const rawFrom = String(dep || "");
          const from = canonicalByRaw.get(rawFrom) || toCanonical(rawFrom);
          if (!from || !to || from === to || !ids.has(from)) return;
          explicitEdges.push({ from, to, semantic: true });
        });
      });
      const uniq = new Map<string, GraphEdgeLike>();
      explicitEdges.forEach((edge) => {
        if (!edge.from || !edge.to || edge.from === edge.to) return;
        uniq.set(`${edge.from}->${edge.to}`, edge);
      });
      const childEdges = Array.from(uniq.values());
      const indegree = new Map<string, number>();
      nodesOut.forEach((n) => indegree.set(n.id, 0));
      childEdges.forEach((e) => indegree.set(e.to, (indegree.get(e.to) || 0) + 1));
      const roots = nodesOut.filter((n) => (indegree.get(n.id) || 0) === 0).map((n) => n.id);
      const connectorEdges: GraphEdgeLike[] = roots.map((rootId) => ({ from: aid, to: rootId, semantic: false, synthetic: true }));
      const activeChildId = (() => {
        const summaryChild = String(aggregateNode?.aggregateSummary?.activeChildId || "").trim();
        if (summaryChild) return canonicalChildId(aid, summaryChild);
        const pickByStatus = (status: string) => {
          for (let idx = allChildren.length - 1; idx >= 0; idx -= 1) {
            const row = allChildren[idx];
            if (String(row?.status || "").toLowerCase() !== status) continue;
            const childId = String(row?.id || row?.rawChildKey || "");
            if (childId) return canonicalChildId(aid, childId);
          }
          return "";
        };
        return pickByStatus("running") || pickByStatus("retrying") || pickByStatus("queued") || "";
      })();
      return { aggregateId: aid, nodes: nodesOut, childEdges, connectorEdges, activeChildId };
    },
    [nodeById]
  );

  const aggregateChildrenGraph = useMemo(() => {
    if (graphScope?.level !== "aggregate") return null;
    const aggregateId = activeAggregateIdForView;
    if (!aggregateId) return null;
    const built = buildAggregateChildrenModel(aggregateId);
    if (!built) return null;
    return {
      aggregateId: built.aggregateId,
      nodes: built.nodes,
      edges: [...built.childEdges],
      activeChildId: built.activeChildId,
    };
  }, [graphScope, activeAggregateIdForView, buildAggregateChildrenModel]);

  const inlineAggregateGraph = useMemo(() => {
    const aggregateId = (() => {
      if (graphScope?.level !== "suite") return String(graphScope?.aggregateId || "");
      const raw = String(selectedNodeId || "");
      if (!raw) return "";
      if (!raw.includes("::")) return raw;
      const root = String(raw.split("::")[0] || "");
      return root;
    })();
    if (!aggregateId) return null;
    if (String(graphScope?.level || "suite") === "suite") {
      const selectedFilters = Array.isArray(aggregateFilterIds) ? aggregateFilterIds.map((id) => String(id || "")) : [];
      if (!selectedFilters.length) return null;
      if (!selectedFilters.includes(String(aggregateId))) return null;
    }
    const aggregateNode = nodeById.get(aggregateId);
    if (isPytestGateAggregateNode(aggregateNode)) return null;
    if (!aggregateNode?.aggregateSummary) return null;
    const built = buildAggregateChildrenModel(aggregateId);
    if (!built) return null;
    // Keep inline aggregate view focused on one aggregate tree:
    // parent aggregate node + child DAG, without suite-wide node fan-out.
    const aggregateRootNode = {
      ...aggregateNode,
      status: String(aggregateNode?.status || "not_run"),
    };
    const combinedNodes = [aggregateRootNode, ...built.nodes];
    const combinedEdges = [
      ...built.connectorEdges,
      ...built.childEdges,
    ];
    return { aggregateId, nodes: combinedNodes, edges: combinedEdges, activeChildId: built.activeChildId };
  }, [graphScope, selectedNodeId, aggregateFilterIds, nodeById, buildAggregateChildrenModel]);

  const childDagSourceNodes = useMemo(() => {
    if (inlineAggregateGraph?.nodes?.length) return inlineAggregateGraph.nodes;
    if (aggregateChildrenGraph?.nodes?.length) return aggregateChildrenGraph.nodes;
    return nodes;
  }, [inlineAggregateGraph, aggregateChildrenGraph, nodes]);

  const childDagSourceEdges = useMemo(() => {
    if (inlineAggregateGraph?.edges?.length) return inlineAggregateGraph.edges;
    if (aggregateChildrenGraph?.edges?.length) return aggregateChildrenGraph.edges;
    return edges;
  }, [inlineAggregateGraph, aggregateChildrenGraph, edges]);

  const childDagModel = useMemo(
    () =>
      buildChildDagGraphModel({
        graphScope,
        childAttemptById: childAttemptById || {},
        selectedRunId: selectedRunId || "",
        activeRunId: activeRunId || "",
        bundledNodes: childDagSourceNodes,
        bundledEdges: childDagSourceEdges,
        childScopeEvents: childScopeEvents || [],
        childScopeProgress: childScopeProgress || [],
        nodeById,
        waitingFirstEvent: waitingFirstEvent || false,
        events: events || [],
      }),
    [
      graphScope,
      childAttemptById,
      selectedRunId,
      activeRunId,
      childDagSourceNodes,
      childDagSourceEdges,
      childScopeEvents,
      childScopeProgress,
      nodeById,
      waitingFirstEvent,
      events,
    ]
  );

  const baseScopeNodes = useMemo(() => {
    if (inlineAggregateGraph?.nodes?.length) return inlineAggregateGraph.nodes;
    if (graphScope?.level === "aggregate" && aggregateChildrenGraph?.nodes?.length) return aggregateChildrenGraph.nodes;
    if (graphScope?.level === "child" && childDagModel?.nodes?.length) return childDagModel.nodes;
    return nodes;
  }, [inlineAggregateGraph, graphScope?.level, aggregateChildrenGraph, childDagModel, nodes]);

  const baseScopeEdges = useMemo(() => {
    if (inlineAggregateGraph?.edges?.length) return inlineAggregateGraph.edges;
    if (graphScope?.level === "aggregate" && aggregateChildrenGraph?.edges?.length) return aggregateChildrenGraph.edges;
    if (graphScope?.level === "child" && childDagModel?.edges?.length) return childDagModel.edges;
    return edges;
  }, [inlineAggregateGraph, graphScope?.level, aggregateChildrenGraph, childDagModel, edges]);

  return {
    nodeById,
    activeAggregateIdForView,
    aggregateChildrenGraph,
    inlineAggregateGraph,
    childDagModel,
    baseScopeNodes,
    baseScopeEdges,
  };
}
