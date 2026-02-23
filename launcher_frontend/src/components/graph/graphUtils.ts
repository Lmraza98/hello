import { deriveChildDagModel, matchesChildNodeId } from "../../lib/graph/deriveChildDagModel";
import type { GraphEdgeLike, GraphScope } from "./graphTypes";

export function canonicalChildId(parentId: string, rawChildId: string) {
  const raw = String(rawChildId || "").trim();
  const parent = String(parentId || "").trim();
  if (!raw) return `${parent}::child`;
  if (raw.startsWith(`${parent}::`)) return raw;
  return `${parent}::${raw}`;
}

export function buildAdjacency(edges: GraphEdgeLike[]) {
  const next = new Map<string, string[]>();
  const prev = new Map<string, string[]>();
  edges.forEach((e) => {
    const n = next.get(e.from) || [];
    n.push(e.to);
    next.set(e.from, n);
    const p = prev.get(e.to) || [];
    p.push(e.from);
    prev.set(e.to, p);
  });
  return { next, prev };
}

export function buildRuntimeNodeMap(events: any[]) {
  const out = new Map<string, { startedAt?: number; finishedAt?: number; terminalStatus?: string }>();
  (Array.isArray(events) ? events : []).forEach((ev: any) => {
    const nodeId = String(ev?.nodeId || "");
    if (!nodeId) return;
    const ts = Number(ev?.ts || 0);
    const type = String(ev?.type || "").toLowerCase();
    const row = out.get(nodeId) || {};
    if (type === "started") {
      if (!row.startedAt || ts < row.startedAt) row.startedAt = ts;
    } else if (type === "finished" || type === "error") {
      if (!row.finishedAt || ts > row.finishedAt) row.finishedAt = ts;
      if (type === "error") row.terminalStatus = "failed";
      else {
        const msg = String(ev?.message || "").toLowerCase();
        row.terminalStatus = msg.includes("fail") || msg.includes("error") ? "failed" : "passed";
      }
    }
    out.set(nodeId, row);
  });
  return out;
}

export function pathForEdge(from: any, to: any) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const span = Math.max(24, x2 - x1);
  const dx = Math.max(36, Math.min(116, span * 0.42));
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function nodeSequence(events: any[]) {
  const seen = new Set<string>();
  const ids: string[] = [];
  events.forEach((ev) => {
    const id = String(ev?.focusNodeId || ev?.nodeId || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

export function collectBlockedChain(rootNodeId: string, unmetDepsByNode: Record<string, string[]>) {
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  if (!rootNodeId) return { nodeIds, edgeKeys };
  const stack: string[] = [rootNodeId];
  while (stack.length) {
    const nodeId = stack.pop() as string;
    if (nodeIds.has(nodeId)) continue;
    nodeIds.add(nodeId);
    const unmet = unmetDepsByNode[nodeId] || [];
    unmet.forEach((depId) => {
      edgeKeys.add(`${depId}->${nodeId}`);
      if (!nodeIds.has(depId)) stack.push(depId);
    });
  }
  return { nodeIds, edgeKeys };
}

export function buildExecutionPath({
  events,
  childScopeEvents,
  graphLevel,
  selectedNodeId,
}: {
  events: any[];
  childScopeEvents: any[];
  graphLevel?: string;
  selectedNodeId: string;
}) {
  const sourceEvents = graphLevel === "child" && Array.isArray(childScopeEvents) && childScopeEvents.length > 0 ? childScopeEvents : events;
  const ordered = (Array.isArray(sourceEvents) ? sourceEvents : [])
    .slice()
    .sort((a: any, b: any) => {
      const ta = Number(a?.ts || 0);
      const tb = Number(b?.ts || 0);
      if (ta !== tb) return ta - tb;
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });
  const compressed: string[] = [];
  let prev = "";
  ordered.forEach((ev: any) => {
    const nodeId = String(ev?.nodeId || "");
    if (!nodeId || nodeId === prev) return;
    compressed.push(nodeId);
    prev = nodeId;
  });
  const fullNodes = new Set<string>(compressed);
  const fullEdges = new Set<string>();
  for (let i = 1; i < compressed.length; i += 1) {
    fullEdges.add(`${compressed[i - 1]}->${compressed[i]}`);
  }
  const selected = String(selectedNodeId || "");
  const selectedIdx = selected ? compressed.indexOf(selected) : -1;
  const selectedFound = selectedIdx >= 0;
  const selectedNodes = new Set<string>();
  const selectedEdges = new Set<string>();
  if (selectedFound) {
    for (let i = 0; i <= selectedIdx; i += 1) selectedNodes.add(compressed[i]);
    for (let i = 1; i <= selectedIdx; i += 1) selectedEdges.add(`${compressed[i - 1]}->${compressed[i]}`);
  } else {
    fullNodes.forEach((id) => selectedNodes.add(id));
    fullEdges.forEach((id) => selectedEdges.add(id));
  }
  return { sequence: compressed, selectedNodes, selectedEdges, selectedFound };
}

export function buildBaseContextSet({
  contextAnchorNodeId,
  contextMode,
  adjacency,
}: {
  contextAnchorNodeId: string;
  contextMode: "minimal" | "normal" | "full";
  adjacency: { next: Map<string, string[]>; prev: Map<string, string[]> };
}) {
  if (!contextAnchorNodeId || contextMode === "full") return null;
  const keep = new Set<string>([contextAnchorNodeId]);
  const deps = adjacency.prev.get(contextAnchorNodeId) || [];
  const next = adjacency.next.get(contextAnchorNodeId) || [];
  deps.forEach((id) => keep.add(id));
  next.forEach((id) => keep.add(id));
  if (contextMode === "normal") {
    deps.forEach((dep) => (adjacency.next.get(dep) || []).forEach((sib) => keep.add(sib)));
    next.forEach((n) => (adjacency.prev.get(n) || []).forEach((sib) => keep.add(sib)));
  }
  return keep;
}

export function computeStatusCounts(nodes: any[]) {
  const counts: Record<string, number> = { running: 0, passed: 0, failed: 0, blocked: 0, not_run: 0 };
  (Array.isArray(nodes) ? nodes : []).forEach((n: any) => {
    const status = n?.status || "not_run";
    if (counts[status] == null) counts.not_run += 1;
    else counts[status] += 1;
  });
  return counts;
}

export function buildChildDagGraphModel({
  graphScope,
  childAttemptById,
  selectedRunId,
  activeRunId,
  bundledNodes,
  bundledEdges,
  childScopeEvents,
  childScopeProgress,
  nodeById,
  waitingFirstEvent,
  events,
}: {
  graphScope: GraphScope;
  childAttemptById: Record<string, string | number>;
  selectedRunId: string;
  activeRunId: string;
  bundledNodes: any[];
  bundledEdges: any[];
  childScopeEvents: any[];
  childScopeProgress: any[];
  nodeById: Map<string, any>;
  waitingFirstEvent: boolean;
  events: any[];
}) {
  if (graphScope?.level !== "child") return null;
  const aggregateId = String(graphScope?.aggregateId || "");
  const childId = canonicalChildId(aggregateId, String(graphScope?.childId || ""));
  if (!childId) return null;
  const attemptId = childAttemptById?.[childId] ?? "latest";
  const currentRunId = String(selectedRunId || activeRunId || "");
  const rawChildId = childId.startsWith(`${aggregateId}::`) ? childId.slice(`${aggregateId}::`.length) : childId;
  const realNodes = (bundledNodes || []).filter(
    (n: any) =>
      n.id === childId || String(n.id).startsWith(`${childId}::`) || n.id === rawChildId || String(n.id).startsWith(`${rawChildId}::`)
  );
  const allEvents = Array.isArray(childScopeEvents) && childScopeEvents.length > 0 ? childScopeEvents : events;
  const childEvents = (Array.isArray(allEvents) ? allEvents : []).filter((ev: any) => {
    const nodeId = String(ev?.nodeId || "");
    return matchesChildNodeId(nodeId, childId) || matchesChildNodeId(nodeId, rawChildId);
  });
  const derived = deriveChildDagModel({
    events: childEvents || [],
    childId,
    childName: nodeById.get(childId)?.name || childId,
    suiteId: String(nodeById.get(childId)?.suiteId || "child"),
  });
  if (realNodes.length > 0) {
    return {
      childId,
      rawChildId,
      runId: currentRunId,
      attemptId,
      source: "real" as const,
      nodes: realNodes,
      edges: (bundledEdges || []).filter((e: any) => realNodes.some((n: any) => n.id === e.from) && realNodes.some((n: any) => n.id === e.to)),
      eventsMatchedCount: childEvents.length,
    };
  }
  if (derived?.nodes?.length) {
    return {
      childId,
      rawChildId,
      runId: currentRunId,
      attemptId,
      source: "derived" as const,
      nodes: derived.nodes,
      edges: derived.edges,
      eventsMatchedCount: childEvents.length,
    };
  }
  const progressRow = (Array.isArray(childScopeProgress) ? childScopeProgress : []).find((row: any) => String(row?.childId || "") === childId) || null;
  const statusVal = String(progressRow?.status || nodeById.get(childId)?.status || "not_run").toLowerCase();
  const startedStatus = statusVal === "not_run" ? "not_run" : "passed";
  const runningStatus = statusVal === "failed" ? "failed" : statusVal === "passed" ? "passed" : "running";
  const finishedStatus = statusVal === "passed" ? "passed" : statusVal === "failed" ? "failed" : "not_run";
  const placeholderNodes = [
    {
      id: `placeholder:${childId}:wait`,
      name: "Started",
      filePath: childId,
      suiteId: String(nodeById.get(childId)?.suiteId || "child"),
      tags: ["placeholder", "status"],
      status: startedStatus,
    },
    {
      id: `placeholder:${childId}:running`,
      name: waitingFirstEvent ? "Running (waiting events)" : "Running",
      filePath: rawChildId,
      suiteId: String(nodeById.get(childId)?.suiteId || "child"),
      tags: ["placeholder", "status"],
      status: runningStatus,
    },
    {
      id: `placeholder:${childId}:finished`,
      name: "Finished",
      filePath: rawChildId,
      suiteId: String(nodeById.get(childId)?.suiteId || "child"),
      tags: ["placeholder", "status"],
      status: finishedStatus,
    },
  ];
  const placeholderEdges = [
    { from: placeholderNodes[0].id, to: placeholderNodes[1].id },
    { from: placeholderNodes[1].id, to: placeholderNodes[2].id },
  ];
  return {
    childId,
    rawChildId,
    runId: currentRunId,
    attemptId,
    source: "placeholder" as const,
    nodes: placeholderNodes,
    edges: placeholderEdges,
    eventsMatchedCount: childEvents.length,
  };
}
