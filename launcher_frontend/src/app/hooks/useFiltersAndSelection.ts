import { useEffect, useMemo, useRef } from "react";
import { filterSuites, groupSuites, visibleCases as selectVisibleCases } from "../../lib/launcherSelectors";
import { resolveRunScopedSuites } from "../utils/runScopedSuites";
import type { RunRow, StatusRow, TestRow } from "../types/contracts";

type SuiteGroup = {
  suiteId: string;
  suiteName?: string;
  cases: TestRow[];
};

type UseFiltersAndSelectionParams = {
  tests: TestRow[];
  statusById: Record<string, StatusRow>;
  runs: RunRow[];
  selectedRunId: string | null;
  runScopeEnabled: boolean;
  selectedSuiteId: string;
  setSelectedSuiteId: (value: string) => void;
  selectedTestId: string;
  setSelectedTestId: (value: string) => void;
  selectedCaseId: string;
  setSelectedCaseId: (value: string) => void;
  aggregateFilterIds: string[];
  setAggregateFilterIds: (value: string[]) => void;
  tag: string;
  kind: string;
  outcome: string;
  search: string;
  tab: string;
  setSelectedRunId: (value: string | null) => void;
};

/**
 * Derives tests tab filtering and keeps selection state valid during data churn.
 * Invariants:
 * - Selected suite/test/case are always valid against visible datasets.
 * - Run-scoped filtering preserves aggregate/child normalization behavior.
 */
export function useFiltersAndSelection({
  tests,
  statusById,
  runs,
  selectedRunId,
  runScopeEnabled,
  selectedSuiteId,
  setSelectedSuiteId,
  selectedTestId,
  setSelectedTestId,
  selectedCaseId,
  setSelectedCaseId,
  aggregateFilterIds,
  setAggregateFilterIds,
  tag,
  kind,
  outcome,
  search,
  tab,
  setSelectedRunId,
}: UseFiltersAndSelectionParams) {
  const suites = useMemo(() => groupSuites(tests), [tests]);
  const filteredSuites = useMemo(
    () => filterSuites({ suites, statusById, selectedSuiteId, tag, kind, outcome }),
    [suites, statusById, selectedSuiteId, tag, kind, outcome]
  );
  const runScopedSuites = useMemo(() => {
    return resolveRunScopedSuites(filteredSuites, runs, selectedRunId, runScopeEnabled);
  }, [filteredSuites, runs, selectedRunId, runScopeEnabled]);

  const aggregateFilterOptions = useMemo(() => {
    const fromSuites = runScopedSuites
      .flatMap((suite) => suite.cases || [])
      .filter((row) => Array.isArray(row?.children) && row.children.length > 0)
      .map((row: TestRow) => ({
        id: String(row?.id || ""),
        name: String(row?.name || row?.id || ""),
        total: Array.isArray(row?.children) ? row.children.length : undefined,
      }))
      .filter((row) => row.id);
    const uniq = new Map();
    fromSuites.forEach((row) => {
      if (!uniq.has(row.id)) uniq.set(row.id, row);
    });
    return Array.from(uniq.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [runScopedSuites]);

  useEffect(() => {
    if (!aggregateFilterIds.length) return;
    const allowed = new Set(aggregateFilterOptions.map((row) => row.id));
    const next = aggregateFilterIds.filter((id) => allowed.has(id));
    if (next.length !== aggregateFilterIds.length) setAggregateFilterIds(next);
  }, [aggregateFilterIds, aggregateFilterOptions, setAggregateFilterIds]);

  const aggregateScopedSuites = useMemo<SuiteGroup[]>(() => {
    if (!aggregateFilterIds.length) return runScopedSuites;
    const selected = new Set(aggregateFilterIds);
    return runScopedSuites
      .map((suite: SuiteGroup) => ({
        ...suite,
        cases: (suite.cases || []).filter((row: TestRow) => {
          const id = String(row?.id || "");
          for (const aid of selected) {
            if (id === aid || id.startsWith(`${aid}::`)) return true;
          }
          return false;
        }),
      }))
      .filter((suite) => Array.isArray(suite.cases) && suite.cases.length > 0);
  }, [runScopedSuites, aggregateFilterIds]);

  const visibleTestIds = useMemo(() => aggregateScopedSuites.flatMap((suite) => suite.cases.map((row) => row.id)), [aggregateScopedSuites]);
  const visibleCases = useMemo(() => selectVisibleCases(aggregateScopedSuites, selectedTestId, search), [aggregateScopedSuites, selectedTestId, search]);
  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null;
    return visibleCases.find((row: TestRow) => row.id === selectedCaseId) || null;
  }, [visibleCases, selectedCaseId]);

  useEffect(() => {
    if (tab === "graph") return;
    if (!visibleTestIds.length) {
      setSelectedTestId("");
      return;
    }
    if (!selectedTestId || !visibleTestIds.includes(selectedTestId)) {
      setSelectedTestId(visibleTestIds[0]);
    }
  }, [tab, visibleTestIds, selectedTestId, setSelectedTestId]);

  useEffect(() => {
    if (!visibleCases.length) {
      setSelectedCaseId("");
      return;
    }
    if (selectedCaseId && !visibleCases.some((c) => c.id === selectedCaseId)) {
      setSelectedCaseId("");
    }
  }, [visibleCases, selectedCaseId, setSelectedCaseId]);

  const missingSelectedRunRef = useRef(0);
  useEffect(() => {
    if (!selectedRunId) {
      missingSelectedRunRef.current = 0;
      return;
    }
    const present = runs.some((r: RunRow) => String(r?.run_id || "") === String(selectedRunId));
    if (present) {
      missingSelectedRunRef.current = 0;
      return;
    }
    missingSelectedRunRef.current += 1;
    if (missingSelectedRunRef.current >= 3) {
      setSelectedRunId(null);
      missingSelectedRunRef.current = 0;
    }
  }, [runs, selectedRunId, setSelectedRunId]);

  const latestRun = runs[0] || null;
  const activeFilterCount = Number(Boolean(tag)) + Number(Boolean(kind)) + Number(Boolean(outcome)) + Number(Boolean(selectedSuiteId)) + Number(aggregateFilterIds.length);
  const triageActive = Boolean(outcome) || Boolean(latestRun && latestRun.status && latestRun.status !== "passed");

  return {
    suites,
    aggregateFilterOptions,
    aggregateScopedSuites,
    visibleCases,
    selectedCase,
    latestRun,
    activeFilterCount,
    triageActive,
  };
}
