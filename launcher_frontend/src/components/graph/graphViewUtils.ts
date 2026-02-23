import { TOPBAR_HEIGHT } from "../../lib/zIndex";

export function collectReachable(start: string, nextMap: Map<string, string[]>) {
  const seen = new Set<string>();
  const stack: string[] = [start];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    (nextMap.get(cur) || []).forEach((nxt) => {
      if (!seen.has(nxt)) stack.push(nxt);
    });
  }
  return seen;
}

export function clampZoom(value: number, min = 0.5, max = 2.5): number {
  return Math.max(min, Math.min(max, value));
}

export function computePopupPosition(
  scrollEl: HTMLDivElement | null,
  pos: { x: number; y: number; width: number; height: number } | null,
  zoom: number,
  width = 260,
  height = 110
) {
  const container = scrollEl;
  if (!container || !pos) return null;
  const rect = container.getBoundingClientRect();
  let left = rect.left + pos.x * zoom - container.scrollLeft + pos.width * zoom + 10;
  let top = rect.top + pos.y * zoom - container.scrollTop + 4;
  if (left + width > window.innerWidth - 8) left = Math.max(8, left - width - pos.width * zoom - 20);
  if (top + height > window.innerHeight - 8) top = Math.max(TOPBAR_HEIGHT + 8, window.innerHeight - height - 8);
  if (top < TOPBAR_HEIGHT + 8) top = TOPBAR_HEIGHT + 8;
  return { left, top };
}
