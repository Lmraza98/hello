/**
 * Compute remaining ids that are safe to resume for a paused run.
 */
export function deriveRemainingIdsForResume(runRow) {
  if (!runRow || !Array.isArray(runRow.tests)) return [];
  const terminal = new Set(["passed", "failed", "skipped", "canceled"]);
  const selectedOrder = Array.isArray(runRow.selected_test_ids)
    ? runRow.selected_test_ids.map((id) => String(id || "")).filter(Boolean)
    : runRow.tests.map((row) => String(row?.id || "")).filter(Boolean);
  const byStatus = new Map<string, string>(
    runRow.tests
      .filter((row) => row && typeof row === "object")
      .map((row) => [String(row.id || ""), String(row.status || "not_run").toLowerCase()])
  );
  return selectedOrder.filter((id) => {
    const status = byStatus.get(id) || "not_run";
    if (terminal.has(status)) return false;
    if (status === "running") return false;
    return true;
  });
}
