import { canonicalChildId } from "./ids";
import type { RunRow, StatusRow } from "../types/contracts";

type AggregateChildLike = { id?: string; rawChildKey?: string; status?: string };
type GraphNodeLike = {
  id?: string;
  status?: string;
  aggregateSummary?: { activeChildId?: string };
  aggregateChildren?: AggregateChildLike[];
};

export function pickPreferredAggregateId(runRow: RunRow | null, graphNodes: GraphNodeLike[]) {
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

export function pickActiveRunNodeId(runRow: RunRow | null, graphNodes: GraphNodeLike[], statusMap: Record<string, StatusRow>) {
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

export function pickActiveAggregateFromGraph(graphNodes: GraphNodeLike[], statusMap: Record<string, StatusRow>) {
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

export function pickAggregateForActiveChild(activeChildId: string, graphNodes: GraphNodeLike[], fallbackAggregateId = "") {
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

export function pickActiveChildFromAggregateNode(aggregateNode: GraphNodeLike | null) {
  const aggregateId = String(aggregateNode?.id || "");
  if (!aggregateId) return "";
  const summaryChild = String(aggregateNode?.aggregateSummary?.activeChildId || "").trim();
  if (summaryChild) return canonicalChildId(aggregateId, summaryChild);
  const children = Array.isArray(aggregateNode?.aggregateChildren) ? aggregateNode.aggregateChildren : [];
  const pickByStatus = (status: string) => {
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
