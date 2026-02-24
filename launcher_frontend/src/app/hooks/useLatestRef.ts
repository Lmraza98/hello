import { useEffect, useRef } from "react";

/**
 * Keep a mutable ref synchronized with the latest value without triggering renders.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
