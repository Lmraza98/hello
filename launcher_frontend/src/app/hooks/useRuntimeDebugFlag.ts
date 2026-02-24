import { useMemo } from "react";

export function useRuntimeDebugFlag() {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const fromGlobal = Boolean(window.__LP_DEBUG__);
      const fromStorage = window.localStorage?.getItem("LP_DEBUG") === "1";
      return fromGlobal || fromStorage;
    } catch {
      return false;
    }
  }, []);
}

