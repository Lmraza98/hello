/**
 * Validate and resolve scoped graph overlays against the current base graph.
 */
export function resolveScopedGraph<
  N extends { id: string } & Record<string, unknown>,
  E extends { from: string; to: string } & Record<string, unknown>,
>(
  baseNodes: N[],
  baseEdges: E[],
  graphScopedModel:
    | {
        nodes?: N[];
        edges?: E[];
      }
    | null
    | undefined
) {
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
}
