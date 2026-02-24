type NodeLike = { id?: string; name?: string };

export function canonicalChildId(parentId: string, rawChildId: string) {
  const parent = String(parentId || "").trim();
  const raw = String(rawChildId || "").trim();
  if (!raw) return `${parent}::child`;
  if (raw.startsWith(`${parent}::`)) return raw;
  return `${parent}::${raw}`;
}

export function normalizeChildSelectionId(parentId: string, childId: string) {
  const parent = String(parentId || "").trim();
  const raw = String(childId || "").trim();
  if (!raw) return "";
  if (parent && raw.startsWith(`${parent}::`)) return raw;
  return canonicalChildId(parent, raw);
}

export function normalizeSuiteSelectionNodeId(nodeId: string, nodesList: NodeLike[]) {
  const raw = String(nodeId || "");
  if (!raw) return "";
  if (!raw.includes("::")) return raw;
  const root = String(raw.split("::")[0] || "");
  if (!root) return raw;
  const ids = new Set((Array.isArray(nodesList) ? nodesList : []).map((n) => String(n?.id || "")).filter(Boolean));
  return ids.has(root) ? root : raw;
}

export function isPytestGateAggregateId(aggregateId: string, nodes: NodeLike[] = []) {
  const id = String(aggregateId || "").toLowerCase();
  if (!id) return false;
  if (id === "backend-gate-pytest-ready") return true;
  if (id.includes("pytest") && id.includes("ready")) return true;
  const node = (nodes || []).find((n) => String(n?.id || "").toLowerCase() === id) || null;
  const name = String(node?.name || "").toLowerCase();
  return name.includes("pytest runtime ready");
}

export function createIdsForRun({
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
}: {
  tests: Array<{ id?: string; children?: Array<{ id?: string; rawChildKey?: string }> }>;
  graphNodesWithPlayback: Array<{
    id?: string;
    aggregateSummary?: unknown;
    aggregateChildren?: Array<{ id?: string; rawChildKey?: string }>;
  }>;
  graphSelectedRunTargetId: string;
  graphScope: { level?: string; aggregateId?: string; childId?: string };
  manualGraphChildId: string;
  graphDetailChildId: string;
  graphState: { selectedNodeId?: string };
  selectedCaseId: string;
  selectedCaseIds: Set<string>;
  selectedTestId: string;
  aggregateScopedSuites: Array<{ cases: Array<{ id?: string }> }>;
}) {
  return function idsForRun(scope: "all" | "selected" = "all") {
    const validTopIds = new Set((tests || []).map((row) => String(row?.id || "")).filter(Boolean));
    const findAggregateForChildToken = (token: string) => {
      const childToken = String(token || "").trim();
      if (!childToken) return "";
      const host = (graphNodesWithPlayback || []).find((node) => {
        if (!node?.aggregateSummary || !Array.isArray(node?.aggregateChildren)) return false;
        return node.aggregateChildren.some((child) => {
          const cid = String(child?.id || "");
          const raw = String(child?.rawChildKey || "");
          return cid === childToken || raw === childToken || cid.endsWith(`::${childToken}`) || raw.endsWith(`::${childToken}`);
        });
      });
      const hostId = String(host?.id || "");
      return validTopIds.has(hostId) ? hostId : "";
    };
    const normalizeRequestedIds = (ids: string[]) => {
      const out: string[] = [];
      const push = (val: string) => {
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
        if (aggregateHostId) push(aggregateHostId);
      });
      if (!out.length) {
        if (selectedTestId && validTopIds.has(String(selectedTestId))) push(selectedTestId);
        else if (graphScope?.aggregateId && validTopIds.has(String(graphScope.aggregateId))) push(graphScope.aggregateId);
      }
      return out;
    };

    if (scope === "selected") {
      const explicitGraphTarget = String(graphSelectedRunTargetId || "").trim();
      if (explicitGraphTarget && !explicitGraphTarget.startsWith("placeholder:")) {
        const explicitIds = normalizeRequestedIds([explicitGraphTarget]);
        if (explicitIds.length) return explicitIds;
      }
      const scopedChildId = String(graphScope?.level === "child" ? graphScope?.childId || "" : "").trim();
      if (scopedChildId && !scopedChildId.startsWith("placeholder:")) return normalizeRequestedIds([scopedChildId]);
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
          const isPytestNodeId = rawNodeId.startsWith("tests/") || rawNodeId.startsWith("tests\\") || rawNodeId.includes("::test_");
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
    return normalizeRequestedIds(aggregateScopedSuites.flatMap((suite) => suite.cases.map((row) => row.id)));
  };
}
