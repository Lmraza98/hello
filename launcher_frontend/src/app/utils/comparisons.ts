/**
 * Compare child progress row arrays by fields used in UI reconciliation.
 */
type ProgressRowLike = {
  childId?: string;
  status?: string;
  attemptId?: string | number | null;
  startedAt?: string | number | null;
  finishedAt?: string | number | null;
  message?: string;
};

export function sameProgressRows(a: ProgressRowLike[] | undefined, b: ProgressRowLike[] | undefined) {
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
