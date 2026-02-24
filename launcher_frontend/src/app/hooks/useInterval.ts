import { useEffect } from "react";
import { useLatestRef } from "./useLatestRef";

/**
 * Stable interval hook that always executes the latest callback.
 */
export function useInterval(callback: (() => void | Promise<void>) | null | undefined, delayMs: number | null) {
  const callbackRef = useLatestRef(callback);

  useEffect(() => {
    if (delayMs == null) return undefined;
    const id = window.setInterval(() => {
      void callbackRef.current?.();
    }, delayMs);
    return () => window.clearInterval(id);
  }, [delayMs, callbackRef]);
}
