import { useCallback, useEffect } from "react";

export function useRunSelectionActions(params) {
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

  const handleSelectRun = useCallback((runId, options = {}) => {
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
