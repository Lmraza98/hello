import { useEffect, useMemo, useRef } from "react";
import { buildGraphModel } from "../../../lib/graph/buildGraphModel";
import type { RunRow, StatusRow, TestRow } from "../../types/contracts";

type SuiteGroup = { suiteId: string; suiteName: string; cases: TestRow[] };

type UseGraphModelParams = {
  aggregateScopedSuites: SuiteGroup[];
  selectedSuiteId: string;
  selectedTestId: string;
  visibleCases: TestRow[];
  statusById: Record<string, StatusRow>;
  runs: RunRow[];
  selectedRunId: string | null;
  runScopeEnabled: boolean;
  tab: string;
  runtimeDebug: boolean;
};

export function useGraphModel({
  aggregateScopedSuites,
  selectedSuiteId,
  selectedTestId,
  visibleCases,
  statusById,
  runs,
  selectedRunId,
  runScopeEnabled,
  tab,
  runtimeDebug,
}: UseGraphModelParams) {
  const graphModelSigRef = useRef("");
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

  return { graphModel };
}
