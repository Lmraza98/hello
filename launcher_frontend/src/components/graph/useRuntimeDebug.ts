import React from "react";

export function useRuntimeDebugFlag() {
  return React.useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const fromQuery = new URLSearchParams(window.location.search).get("debug") === "1";
      const fromGlobal = Boolean((window as any).__LP_DEBUG__);
      const fromStorage = window.localStorage?.getItem("LP_DEBUG") === "1";
      return fromQuery || fromGlobal || fromStorage;
    } catch {
      return false;
    }
  }, []);
}

export function useRuntimeDebug({
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
}: {
  runtimeDebug: boolean;
  graphScope: any;
  nodes: any[];
  edges: any[];
  playbackEntries: any[];
  aggregateChildrenGraph: any;
  inlineAggregateGraph: any;
  childDagModel: any;
  childScopeEvents: any[];
  events: any[];
  nodeById: Map<string, any>;
  childAttemptById: Record<string, string | number>;
  selectedRunId?: string;
  activeRunId?: string;
}) {
  const heartbeatSigRef = React.useRef("");
  const aggregateStatsSigRef = React.useRef("");

  React.useEffect(() => {
    const scope = graphScope?.level || "suite";
    const aggregateId = String(graphScope?.aggregateId || "");
    const childId = String(graphScope?.childId || "");
    const nodeCount = Array.isArray(nodes) ? nodes.length : 0;
    const edgeCount = Array.isArray(edges) ? edges.length : 0;
    const eventCount = Array.isArray(playbackEntries) ? playbackEntries.length : 0;
    const sample = (Array.isArray(nodes) ? nodes : []).slice(0, 4).map((n: any) => String(n?.name || n?.id || ""));
    const sig = `${runtimeDebug}|${scope}|${aggregateId}|${childId}|${nodeCount}|${edgeCount}|${eventCount}|${sample.join("|")}`;
    if (heartbeatSigRef.current === sig) return;
    heartbeatSigRef.current = sig;
    console.warn("[graph] heartbeat", {
      debug: runtimeDebug,
      scope,
      aggregateId,
      childId,
      nodes: nodeCount,
      edges: edgeCount,
      events: eventCount,
      sampleNodes: sample,
    });
  }, [runtimeDebug, graphScope?.level, graphScope?.aggregateId, graphScope?.childId, nodes, edges, playbackEntries]);

  React.useEffect(() => {
    if (!runtimeDebug) return;
    const model = graphScope?.level === "aggregate" ? aggregateChildrenGraph : inlineAggregateGraph;
    if (!model?.aggregateId) return;
    const childCount = Array.isArray(model.nodes) ? model.nodes.length : 0;
    const edgeCountWithinChildren = Array.isArray(model.edges)
      ? model.edges.filter((e: any) => !String(e?.from || "").startsWith(String(model.aggregateId)) || e?.semantic === true).length
      : 0;
    const connectorCount = Array.isArray(model.edges)
      ? model.edges.filter((e: any) => String(e?.from || "") === String(model.aggregateId)).length
      : 0;
    const sig = `${model.aggregateId}|${childCount}|${edgeCountWithinChildren}|${connectorCount}`;
    if (aggregateStatsSigRef.current === sig) return;
    aggregateStatsSigRef.current = sig;
    console.warn("[graph] aggregate edge stats", {
      aggregateId: model.aggregateId,
      childCount,
      edgeCountWithinChildren,
      connectorCount,
    });
  }, [runtimeDebug, graphScope?.level, aggregateChildrenGraph, inlineAggregateGraph]);

  React.useEffect(() => {
    if (!runtimeDebug || graphScope?.level !== "child" || !childDagModel) return;
    const totalSourceEvents = Array.isArray(childScopeEvents) && childScopeEvents.length > 0 ? childScopeEvents.length : (Array.isArray(events) ? events.length : 0);
    const source = Array.isArray(childScopeEvents) && childScopeEvents.length > 0 ? "childScopeEvents" : "globalEvents";
    if (childDagModel.eventsMatchedCount > 0) {
      console.log("[graph] child event match", {
        childId: childDagModel.childId,
        rawChildId: childDagModel.rawChildId,
        matched: childDagModel.eventsMatchedCount,
        totalSourceEvents,
        source,
      });
      return;
    }
    const status = String(nodeById.get(childDagModel.childId)?.status || "").toLowerCase();
    if (status !== "running") return;
    const attemptId = childAttemptById?.[childDagModel.childId] ?? "latest";
    const currentRunId = String(selectedRunId || activeRunId || "");
    const sampleNodeIds = (Array.isArray(events) ? events : []).map((ev: any) => String(ev?.nodeId || "")).filter(Boolean).slice(0, 20);
    console.warn("[graph] child running but DAG lookup missing", {
      key: `${currentRunId}::${String(attemptId)}::${childDagModel.childId}`,
      childId: childDagModel.childId,
      rawChildId: childDagModel.rawChildId,
      runId: currentRunId,
      attemptId,
      sampleEventNodeIds: sampleNodeIds,
    });
  }, [runtimeDebug, graphScope?.level, childDagModel, childScopeEvents, events, nodeById, childAttemptById, selectedRunId, activeRunId]);
}
