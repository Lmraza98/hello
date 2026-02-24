import { useEffect, useMemo, useRef } from "react";
import { filterSuites, groupSuites, visibleCases as selectVisibleCases } from "../../../lib/launcherSelectors";
import { canonicalChildId } from "../utils/ids";

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
}) {
  const suites = useMemo(() => groupSuites(tests), [tests]);
  const filteredSuites = useMemo(
    () => filterSuites({ suites, statusById, selectedSuiteId, tag, kind, outcome }),
    [suites, statusById, selectedSuiteId, tag, kind, outcome]
  );
  const runScopedSuites = useMemo(() => {
    if (!runScopeEnabled) return filteredSuites;
    if (!selectedRunId) return filteredSuites;
    const run = runs.find((r) => r.run_id === selectedRunId);
    if (!run) return filteredSuites;
    const caseIdSet = new Set(
      (filteredSuites || [])
        .flatMap((suite) => (Array.isArray(suite?.cases) ? suite.cases : []))
        .map((row) => String(row?.id || ""))
        .filter(Boolean)
    );
    const childToParent = new Map();
    (filteredSuites || []).forEach((suite) => {
      (Array.isArray(suite?.cases) ? suite.cases : []).forEach((row) => {
        const parentId = String(row?.id || "");
        if (!parentId) return;
        const children = Array.isArray(row?.children) ? row.children : [];
        children.forEach((child) => {
          const raw = String(child?.nodeid || child?.id || child?.name || "");
          if (!raw) return;
          childToParent.set(raw, parentId);
          childToParent.set(canonicalChildId(parentId, raw), parentId);
        });
      });
    });
    const resolved = new Set();
    const addResolved = (rawId) => {
      const id = String(rawId || "");
      if (!id) return;
      if (caseIdSet.has(id)) resolved.add(id);
      if (childToParent.has(id)) resolved.add(String(childToParent.get(id) || ""));
      if (id.includes("::")) {
        const root = String(id.split("::")[0] || "");
        if (caseIdSet.has(root)) resolved.add(root);
      }
    };
    if (Array.isArray(run.selected_test_ids)) run.selected_test_ids.forEach(addResolved);
    if (Array.isArray(run.selected_step_ids)) run.selected_step_ids.forEach(addResolved);
    if (Array.isArray(run.tests)) {
      run.tests.forEach((t) => {
        addResolved(t?.id);
        const children = Array.isArray(t?.children) ? t.children : [];
        children.forEach((child) => {
          const raw = String(child?.nodeid || child?.id || child?.name || "");
          if (!raw) return;
          addResolved(raw);
          addResolved(canonicalChildId(String(t?.id || ""), raw));
        });
      });
    }
    if (!resolved.size) return filteredSuites;
    const next = filteredSuites
      .map((suite) => ({ ...suite, cases: suite.cases.filter((row) => resolved.has(String(row?.id || ""))) }))
      .filter((suite) => suite.cases.length > 0);
    return next.length ? next : filteredSuites;
  }, [filteredSuites, runs, selectedRunId, runScopeEnabled]);

  const aggregateFilterOptions = useMemo(() => {
    const fromSuites = runScopedSuites
      .flatMap((suite) => suite.cases || [])
      .filter((row) => Array.isArray(row?.children) && row.children.length > 0)
      .map((row) => ({
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

  const aggregateScopedSuites = useMemo(() => {
    if (!aggregateFilterIds.length) return runScopedSuites;
    const selected = new Set(aggregateFilterIds);
    return runScopedSuites
      .map((suite) => ({
        ...suite,
        cases: (suite.cases || []).filter((row) => {
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
    return visibleCases.find((row) => row.id === selectedCaseId) || null;
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
    const present = runs.some((r) => String(r?.run_id || "") === String(selectedRunId));
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
