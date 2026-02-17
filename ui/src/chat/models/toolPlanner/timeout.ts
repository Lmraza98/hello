/**
 * Planner timeout helper.
 *
 * Extracted verbatim from `ui/src/chat/models/toolPlanner.ts` (Phase 1A).
 */

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // ignore timeout handler errors
      }
      reject(new Error(`planner_timeout:${label}:${timeoutMs}`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

