import { useCallback, useEffect } from "react";

type UseRunSelectionActionsParams = {
  setTag: (value: string) => void;
  setKind: (value: string) => void;
  setOutcome: (value: string) => void;
  setSelectedSuiteId: (value: string) => void;
  setAggregateFilterIds: (value: string[]) => void;
  setSelectedRunId: (value: string | null) => void;
  runScopeEnabled: boolean;
  setRunScopeEnabled: (value: boolean) => void;
  setGraphScopedModel: (value: { nodes: unknown[]; edges: unknown[]; scope: string }) => void;
  setGraphScope: (value: { level: "suite" | "aggregate" | "child"; aggregateId: string; childId: string }) => void;
  selectedRunId: string | null;
};

export function useRunSelectionActions(params: UseRunSelectionActionsParams) {
  const {
    setTag,
    setKind,
    setOutcome,
    setSelectedSuiteId,
    setAggregateFilterIds,
    setSelectedRunId,
    runScopeEnabled,
    setRunScopeEnabled,
    setGraphScopedModel,
    setGraphScope,
    selectedRunId,
  } = params;

  const clearFilters = useCallback(() => {
    setTag("");
    setKind("");
    setOutcome("");
    setSelectedSuiteId("");
    setAggregateFilterIds([]);
  }, [setTag, setKind, setOutcome, setSelectedSuiteId, setAggregateFilterIds]);

  const handleSelectRun = useCallback((runId: string | null, options: { scope?: boolean } = {}) => {
    const nextRunId = runId || null;
    setSelectedRunId(nextRunId);
    const nextScope = typeof options.scope === "boolean" ? options.scope : Boolean(nextRunId);
    setRunScopeEnabled(nextScope);
    if (nextRunId) {
      // Run switching must not retain stale scoped graph overlays from prior contexts.
      setGraphScopedModel({ nodes: [], edges: [], scope: "suite" });
      setGraphScope({ level: "suite", aggregateId: "", childId: "" });
    }
  }, [setSelectedRunId, setRunScopeEnabled, setGraphScopedModel, setGraphScope]);

  useEffect(() => {
    if (!selectedRunId) return;
    if (!runScopeEnabled) setRunScopeEnabled(true);
  }, [selectedRunId, runScopeEnabled, setRunScopeEnabled]);

  return { clearFilters, handleSelectRun };
}
