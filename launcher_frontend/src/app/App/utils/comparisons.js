/**
 * Compare child progress row arrays by fields used in UI reconciliation.
 */
export function sameProgressRows(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const x = left[i] || {};
    const y = right[i] || {};
    if (
      String(x.childId || "") !== String(y.childId || "") ||
      String(x.status || "") !== String(y.status || "") ||
      String(x.attemptId ?? "") !== String(y.attemptId ?? "") ||
      String(x.startedAt ?? "") !== String(y.startedAt ?? "") ||
      String(x.finishedAt ?? "") !== String(y.finishedAt ?? "") ||
      String(x.message || "") !== String(y.message || "")
    ) {
      return false;
    }
  }
  return true;
}
