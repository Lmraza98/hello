import { canonicalChildId } from "./ids";
import type { RunRow, TestRow } from "../types/contracts";

type SuiteGroup = { cases: TestRow[] };

/**
 * Resolve run-scoped suite rows while preserving child->parent normalization.
 */
export function resolveRunScopedSuites(
  filteredSuites: SuiteGroup[],
  runs: RunRow[],
  selectedRunId: string | null,
  runScopeEnabled: boolean
) {
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

  const childToParent = new Map<string, string>();
  (filteredSuites || []).forEach((suite: SuiteGroup) => {
    (Array.isArray(suite?.cases) ? suite.cases : []).forEach((row: TestRow) => {
      const parentId = String(row?.id || "");
      if (!parentId) return;
      const children = Array.isArray(row?.children) ? row.children : [];
      children.forEach((child: { nodeid?: string; id?: string; name?: string }) => {
        const raw = String(child?.nodeid || child?.id || child?.name || "");
        if (!raw) return;
        childToParent.set(raw, parentId);
        childToParent.set(canonicalChildId(parentId, raw), parentId);
      });
    });
  });

  const resolved = new Set<string>();
  const addResolved = (rawId: string) => {
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
    run.tests.forEach((t: { id?: string; children?: Array<{ nodeid?: string; id?: string; name?: string }> }) => {
      addResolved(t?.id);
      const children = Array.isArray(t?.children) ? t.children : [];
      children.forEach((child: { nodeid?: string; id?: string; name?: string }) => {
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
}
