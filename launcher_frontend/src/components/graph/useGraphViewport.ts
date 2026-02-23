import React, { useMemo, useRef, useState } from "react";

export function useGraphViewport({
  scrollRef,
  layoutById,
  zoom,
  filteredNodes,
  filteredEdges,
  hoveredNodeId,
  openInspectorNodeId,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  layoutById: Record<string, any>;
  zoom: number;
  filteredNodes: any[];
  filteredEdges: any[];
  hoveredNodeId: string;
  openInspectorNodeId: string;
}) {
  const viewportRafRef = useRef<number | null>(null);
  const [overlayTick, setOverlayTick] = useState(0);
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const scheduleViewportUpdate = React.useCallback(() => {
    if (viewportRafRef.current == null) {
      viewportRafRef.current = window.requestAnimationFrame(() => {
        viewportRafRef.current = null;
        const el = scrollRef.current;
        if (!el) return;
        setViewport((prev) =>
          prev.left === el.scrollLeft &&
          prev.top === el.scrollTop &&
          prev.width === el.clientWidth &&
          prev.height === el.clientHeight
            ? prev
            : { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight }
        );
      });
    }
  }, [scrollRef]);

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const refresh = () => {
      setViewport({
        left: container.scrollLeft,
        top: container.scrollTop,
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    refresh();
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      if (viewportRafRef.current != null) {
        window.cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
      }
    };
  }, [scrollRef]);

  React.useEffect(() => {
    if (!hoveredNodeId && !openInspectorNodeId) return;
    const container = scrollRef.current;
    if (!container) return;
    let raf = 0;
    const bump = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        setOverlayTick((tick) => tick + 1);
      });
    };
    container.addEventListener("scroll", bump, { passive: true });
    window.addEventListener("resize", bump);
    return () => {
      container.removeEventListener("scroll", bump);
      window.removeEventListener("resize", bump);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [scrollRef, hoveredNodeId, openInspectorNodeId]);

  const visibleNodeIds = useMemo(() => {
    if (!viewport.width || !viewport.height || !zoom) {
      return new Set((filteredNodes || []).map((n: any) => String(n?.id || "")));
    }
    // Behavior lock: keep this exact culling margin formula.
    const margin = 220 / Math.max(zoom, 0.2);
    const left = viewport.left / zoom - margin;
    const top = viewport.top / zoom - margin;
    const right = (viewport.left + viewport.width) / zoom + margin;
    const bottom = (viewport.top + viewport.height) / zoom + margin;
    const out = new Set<string>();
    (filteredNodes || []).forEach((n: any) => {
      const pos = layoutById[String(n?.id || "")];
      if (!pos) return;
      const nx1 = pos.x;
      const ny1 = pos.y;
      const nx2 = pos.x + pos.width;
      const ny2 = pos.y + pos.height;
      const visible = !(nx2 < left || nx1 > right || ny2 < top || ny1 > bottom);
      if (visible) out.add(String(n?.id || ""));
    });
    return out;
  }, [filteredNodes, layoutById, viewport, zoom]);

  const renderedNodes = useMemo(
    () => (filteredNodes || []).filter((n: any) => visibleNodeIds.has(String(n?.id || ""))),
    [filteredNodes, visibleNodeIds]
  );
  const renderedEdges = useMemo(
    () => (filteredEdges || []).filter((e: any) => visibleNodeIds.has(String(e?.from || "")) && visibleNodeIds.has(String(e?.to || ""))),
    [filteredEdges, visibleNodeIds]
  );

  return {
    overlayTick,
    viewport,
    setViewport,
    scheduleViewportUpdate,
    visibleNodeIds,
    renderedNodes,
    renderedEdges,
  };
}
