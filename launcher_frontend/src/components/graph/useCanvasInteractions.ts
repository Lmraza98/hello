import React, { useRef } from "react";
import { clampZoom } from "./graphViewUtils";

export function useCanvasInteractions({
  scrollRef,
  zoom,
  setZoom,
  layout,
  filteredNodesLength,
  currentNodeId,
  followNodeId,
  follow,
  onPauseFollow,
  graphScopeSigParts,
  cursor,
  requestViewportRefresh,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  layout: { width: number; height: number; byId: Record<string, any> };
  filteredNodesLength: number;
  currentNodeId: string;
  followNodeId: string;
  follow: boolean;
  onPauseFollow?: () => void;
  graphScopeSigParts: { level?: string; aggregateId?: string; childId?: string };
  cursor: number;
  requestViewportRefresh: () => void;
}) {
  const autoScrollUntilRef = useRef(0);
  const lastScrollRef = useRef({ left: 0, top: 0 });
  const panCleanupRef = useRef<(() => void) | null>(null);
  const didFitSigRef = useRef("");

  const zoomBy = React.useCallback(
    (delta: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const nextZoom = clampZoom(zoom + delta);
      if (nextZoom === zoom) return;
      const centerX = container.clientWidth / 2 + container.scrollLeft;
      const centerY = container.clientHeight / 2 + container.scrollTop;
      const worldX = centerX / Math.max(zoom, 0.0001);
      const worldY = centerY / Math.max(zoom, 0.0001);
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({
          left: Math.max(0, worldX * nextZoom - el.clientWidth / 2),
          top: Math.max(0, worldY * nextZoom - el.clientHeight / 2),
          behavior: "auto",
        });
      });
    },
    [scrollRef, zoom, setZoom]
  );

  const onCanvasWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey) return;
      const container = scrollRef.current;
      if (!container) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = clampZoom(zoom * factor);
      if (nextZoom === zoom) return;
      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const worldX = (container.scrollLeft + pointerX) / Math.max(zoom, 0.0001);
      const worldY = (container.scrollTop + pointerY) / Math.max(zoom, 0.0001);
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({
          left: Math.max(0, worldX * nextZoom - pointerX),
          top: Math.max(0, worldY * nextZoom - pointerY),
          behavior: "auto",
        });
      });
    },
    [scrollRef, zoom, setZoom]
  );

  const fitView = React.useCallback(
    (centerNodeId?: string) => {
      const container = scrollRef.current;
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      const sparse = filteredNodesLength <= 8;
      const pad = sparse ? 138 : 74;
      const fit = Math.min((w - pad) / Math.max(layout.width, 1), (h - pad) / Math.max(layout.height, 1));
      const nextZoom = 1;
      void fit;
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        const nodeId = centerNodeId || currentNodeId;
        const pos = nodeId ? layout.byId[nodeId] : null;
        autoScrollUntilRef.current = Date.now() + 2000;
        if (pos) {
          container.scrollTo({
            left: Math.max(0, (pos.x + pos.width / 2) * nextZoom - w / 2),
            top: Math.max(0, (pos.y + pos.height / 2) * nextZoom - h / 2),
            behavior: "smooth",
          });
        } else {
          container.scrollTo({
            left: Math.max(0, (layout.width * nextZoom - w) / 2),
            top: Math.max(0, (layout.height * nextZoom - h) / 2),
            behavior: "smooth",
          });
        }
      });
    },
    [scrollRef, filteredNodesLength, layout.width, layout.height, currentNodeId, layout.byId, setZoom]
  );

  React.useEffect(() => {
    const sig = `${String(graphScopeSigParts.level || "suite")}|${String(graphScopeSigParts.aggregateId || "")}|${String(graphScopeSigParts.childId || "")}`;
    if (didFitSigRef.current === sig) return;
    didFitSigRef.current = sig;
    fitView(currentNodeId);
  }, [graphScopeSigParts.level, graphScopeSigParts.aggregateId, graphScopeSigParts.childId, fitView, currentNodeId]);

  React.useEffect(() => {
    if (!follow || !followNodeId) return;
    const container = scrollRef.current;
    if (!container) return;
    const pos = layout.byId[followNodeId];
    if (!pos) return;
    const w = container.clientWidth;
    const h = container.clientHeight;

    autoScrollUntilRef.current = Date.now() + 2000;
    container.scrollTo({
      left: Math.max(0, (pos.x + pos.width / 2) * zoom - w / 2),
      top: Math.max(0, (pos.y + pos.height / 2) * zoom - h / 2),
      behavior: "smooth",
    });
  }, [cursor, follow, followNodeId, layout, zoom, scrollRef]);

  const onCanvasScroll = React.useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    requestViewportRefresh();
    const next = { left: container.scrollLeft, top: container.scrollTop };
    const prev = lastScrollRef.current;
    lastScrollRef.current = next;
    const horizontalDelta = Math.abs(next.left - prev.left);
    if (!follow) return;
    if (Date.now() <= autoScrollUntilRef.current) return;
    if (horizontalDelta > 2) {
      onPauseFollow?.();
    }
  }, [scrollRef, requestViewportRefresh, follow, onPauseFollow]);

  const onCanvasPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (follow) onPauseFollow?.();
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-graph-node-id]")) return;
      const container = scrollRef.current;
      if (!container) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = container.scrollLeft;
      const startTop = container.scrollTop;
      container.style.cursor = "grabbing";
      container.style.userSelect = "none";
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        container.scrollTo({
          left: Math.max(0, startLeft - dx),
          top: Math.max(0, startTop - dy),
          behavior: "auto",
        });
      };
      const onUp = () => {
        container.style.cursor = "";
        container.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        panCleanupRef.current = null;
      };
      panCleanupRef.current = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [follow, onPauseFollow, scrollRef]
  );

  React.useEffect(() => {
    return () => {
      panCleanupRef.current?.();
      panCleanupRef.current = null;
    };
  }, []);

  return {
    zoomBy,
    onCanvasWheel,
    onCanvasPointerDown,
    onCanvasScroll,
    fitView,
  };
}
