export function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function elapsedMs(start: number): number {
  return Math.max(0, Math.round(nowMs() - start));
}
