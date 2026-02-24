import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Controls split-pane sizing and drag interactions for tests and graph tabs.
 * Invariants:
 * - Graph right width persists to localStorage key `launcher.graph.rightWidth`.
 * - Inline/stacked layout toggles strictly by available width thresholds.
 * - All global pointer listeners are cleaned up on drag end/unmount.
 */
export function useSplitPaneLayout({
  tab,
  runHistoryCollapsed,
  graphDetailsOpen,
  SUITES_MIN_PX,
  CASES_MIN_PX,
  DETAILS_MIN_PX,
  DIVIDER_PX,
  OVERLAY_DETAILS_MIN_PX,
  GRAPH_DIVIDER_PX,
  GRAPH_RIGHT_MIN_PX,
  GRAPH_RIGHT_MAX_PX,
  GRAPH_CENTER_MIN_PX,
}) {
  const testsLayoutRef = useRef(null);
  const graphLayoutRef = useRef(null);
  const [layout, setLayout] = useState({
    suites: 25,
    cases: 47,
    details: 28,
    detailsOverlayWidth: 520,
    artifactsHeight: 150,
    detailsCollapsed: false,
  });
  const [dragState, setDragState] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [graphContainerWidth, setGraphContainerWidth] = useState(0);
  const [graphRightWidth, setGraphRightWidth] = useState(() => {
    try {
      const raw = Number(localStorage.getItem("launcher.graph.rightWidth") || "420");
      if (Number.isFinite(raw)) return raw;
    } catch {}
    return 420;
  });
  const [graphDrag, setGraphDrag] = useState(null);

  const activeLayoutRef = tab === "graph" ? graphLayoutRef : testsLayoutRef;

  const readContainerSize = () => {
    const el = activeLayoutRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }
    if (typeof window !== "undefined") {
      return { width: Math.max(0, window.innerWidth - 32), height: Math.max(0, window.innerHeight - 220) };
    }
    return { width: 0, height: 0 };
  };

  useEffect(() => {
    const el = activeLayoutRef.current;
    setContainerSize(readContainerSize());

    const onWindowResize = () => setContainerSize(readContainerSize());
    window.addEventListener("resize", onWindowResize);

    if (!el || typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "graph") return;
    const el = graphLayoutRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setGraphContainerWidth(rect.width);
  }, [tab, containerSize.width]);

  const effectiveWidth = containerSize.width > 0
    ? containerSize.width
    : (typeof window !== "undefined" ? Math.max(0, window.innerWidth - 32) : 0);

  const suitesMinPx = useMemo(() => {
    if (effectiveWidth >= 1500) return SUITES_MIN_PX;
    if (effectiveWidth >= 1320) return 230;
    return 210;
  }, [effectiveWidth, SUITES_MIN_PX]);
  const casesMinPx = useMemo(() => {
    if (effectiveWidth >= 1500) return CASES_MIN_PX;
    if (effectiveWidth >= 1320) return 370;
    return 340;
  }, [effectiveWidth, CASES_MIN_PX]);
  const detailsMinPx = useMemo(() => {
    if (effectiveWidth >= 1500) return DETAILS_MIN_PX;
    if (effectiveWidth >= 1320) return 330;
    return 300;
  }, [effectiveWidth, DETAILS_MIN_PX]);
  const canFitThreePanes = useMemo(() => {
    const usable = Math.max(0, effectiveWidth - DIVIDER_PX * 2);
    return usable >= suitesMinPx + casesMinPx + detailsMinPx;
  }, [effectiveWidth, suitesMinPx, casesMinPx, detailsMinPx, DIVIDER_PX]);
  const detailsInline = canFitThreePanes;
  const overlayDetailsMaxWidth = useMemo(() => {
    const base = containerSize.width > 0 ? containerSize.width : (typeof window !== "undefined" ? window.innerWidth : 900);
    return Math.max(OVERLAY_DETAILS_MIN_PX, base - 120);
  }, [containerSize.width, OVERLAY_DETAILS_MIN_PX]);
  const graphAvailableWidth = useMemo(() => {
    const base = graphContainerWidth > 0 ? graphContainerWidth : containerSize.width;
    return Math.max(0, base);
  }, [graphContainerWidth, containerSize.width]);
  const graphCanInlineDetails = useMemo(() => {
    if (!graphDetailsOpen) return false;
    return graphAvailableWidth >= GRAPH_CENTER_MIN_PX + GRAPH_RIGHT_MIN_PX + GRAPH_DIVIDER_PX;
  }, [graphAvailableWidth, graphDetailsOpen, GRAPH_CENTER_MIN_PX, GRAPH_RIGHT_MIN_PX, GRAPH_DIVIDER_PX]);
  const graphRightWidthClamped = useMemo(() => {
    const maxByViewport = Math.max(GRAPH_RIGHT_MIN_PX, Math.min(GRAPH_RIGHT_MAX_PX, graphAvailableWidth - GRAPH_CENTER_MIN_PX - GRAPH_DIVIDER_PX));
    return Math.max(GRAPH_RIGHT_MIN_PX, Math.min(graphRightWidth, maxByViewport));
  }, [graphAvailableWidth, graphRightWidth, GRAPH_RIGHT_MIN_PX, GRAPH_RIGHT_MAX_PX, GRAPH_CENTER_MIN_PX, GRAPH_DIVIDER_PX]);

  useEffect(() => {
    setLayout((prev) => {
      if (!canFitThreePanes) {
        const usable = Math.max(1, effectiveWidth - DIVIDER_PX);
        const suitesPx = Math.max(180, Math.min((prev.suites / 100) * usable, Math.min(usable * 0.33, usable - 260)));
        const casesPx = Math.max(260, usable - suitesPx);
        const suites = (suitesPx / usable) * 100;
        const cases = (casesPx / usable) * 100;
        return { ...prev, suites, cases, detailsCollapsed: true, details: 0 };
      }
      const usable = Math.max(1, effectiveWidth - DIVIDER_PX * 2);
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const suitesPxMax = Math.min(usable * 0.33, usable - casesMinPx - detailsMinPx);
      let suitesPx = clamp((prev.suites / 100) * usable, suitesMinPx, suitesPxMax);
      const remAfterSuites = usable - suitesPx;
      let casesPx = clamp((prev.cases / 100) * usable, casesMinPx, remAfterSuites - detailsMinPx);
      let detailsPx = remAfterSuites - casesPx;
      if (detailsPx < detailsMinPx) {
        detailsPx = detailsMinPx;
        casesPx = remAfterSuites - detailsPx;
      }
      return {
        ...prev,
        suites: (suitesPx / usable) * 100,
        cases: (casesPx / usable) * 100,
        details: (detailsPx / usable) * 100,
        detailsCollapsed: false,
      };
    });
  }, [canFitThreePanes, effectiveWidth, DIVIDER_PX, suitesMinPx, casesMinPx, detailsMinPx]);

  useEffect(() => {
    if (layout.suites > 33) {
      setLayout((prev) => {
        const suites = 33;
        const remaining = 100 - suites;
        const cases = Math.min(prev.cases, remaining);
        const details = Math.max(0, remaining - cases);
        return { ...prev, suites, cases, details };
      });
    }
  }, [layout.suites]);

  useEffect(() => {
    setLayout((prev) => {
      const width = Math.max(OVERLAY_DETAILS_MIN_PX, Math.min(prev.detailsOverlayWidth || 520, overlayDetailsMaxWidth));
      if (width === prev.detailsOverlayWidth) return prev;
      return { ...prev, detailsOverlayWidth: width };
    });
  }, [overlayDetailsMaxWidth, OVERLAY_DETAILS_MIN_PX]);

  useEffect(() => {
    try {
      localStorage.setItem("launcher.graph.rightWidth", String(Math.round(graphRightWidthClamped)));
    } catch {}
  }, [graphRightWidthClamped]);

  useEffect(() => {
    if (graphRightWidth !== graphRightWidthClamped) setGraphRightWidth(graphRightWidthClamped);
  }, [graphRightWidth, graphRightWidthClamped]);

  function startDrag(type, event) {
    if (type === "h" && runHistoryCollapsed) return;
    event.preventDefault();
    const el = activeLayoutRef.current;
    if (!el) return;
    if (event.pointerId != null && event.currentTarget?.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    }
    const rect = el.getBoundingClientRect();
    document.body.style.userSelect = "none";
    document.body.style.cursor = type === "h" ? "row-resize" : "col-resize";
    setDragState({
      type,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId ?? null,
      startLayout: layout,
      detailsInline,
      width: rect.width,
      height: rect.height,
    });
  }

  function startGraphDividerDrag(event) {
    if (!graphCanInlineDetails) return;
    event.preventDefault();
    const el = graphLayoutRef.current;
    const width = el?.getBoundingClientRect().width || graphAvailableWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    setGraphDrag({
      startX: event.clientX,
      startWidth: graphRightWidthClamped,
      containerWidth: width,
    });
  }

  useEffect(() => {
    if (!dragState) return;
    const pctFromPx = (px, total) => (total <= 0 ? 0 : (px / total) * 100);
    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
    const onMove = (event) => {
      const width = Math.max(1, dragState.width - (dragState.detailsInline ? DIVIDER_PX * 2 : DIVIDER_PX));
      const height = Math.max(1, dragState.height);
      if (dragState.type === "v1") {
        const delta = ((event.clientX - dragState.startX) / width) * 100;
        if (dragState.detailsInline) {
          const sMin = pctFromPx(suitesMinPx, width);
          const cMin = pctFromPx(casesMinPx, width);
          const dMin = pctFromPx(detailsMinPx, width);
          const sMax = Math.min(33, 100 - cMin - dMin);
          const suites = clamp(dragState.startLayout.suites + delta, sMin, sMax);
          const cases = clamp(dragState.startLayout.cases - delta, cMin, 100 - suites - dMin);
          const details = 100 - suites - cases;
          setLayout((prev) => ({ ...prev, suites, cases, details, detailsCollapsed: false }));
        } else {
          const localSuitesMinPx = Math.max(140, Math.min(SUITES_MIN_PX, width - CASES_MIN_PX));
          const localCasesMinPx = Math.max(220, Math.min(CASES_MIN_PX, width - localSuitesMinPx));
          const sMin = pctFromPx(localSuitesMinPx, width);
          const cMin = pctFromPx(localCasesMinPx, width);
          const suites = clamp(dragState.startLayout.suites + delta, sMin, Math.min(33, 100 - cMin));
          const cases = 100 - suites;
          setLayout((prev) => ({ ...prev, suites, cases, details: 0, detailsCollapsed: true }));
        }
      } else if (dragState.type === "v2") {
        if (!dragState.detailsInline) return;
        const delta = ((event.clientX - dragState.startX) / width) * 100;
        const sMin = pctFromPx(suitesMinPx, width);
        const cMin = pctFromPx(casesMinPx, width);
        const dMin = pctFromPx(detailsMinPx, width);
        const pinnedSuites = Math.min(33, dragState.startLayout.suites);
        const cases = clamp(dragState.startLayout.cases + delta, cMin, 100 - pinnedSuites - dMin);
        const details = 100 - pinnedSuites - cases;
        setLayout((prev) => ({ ...prev, suites: clamp(prev.suites, sMin, 33), cases, details: Math.max(dMin, details), detailsCollapsed: false }));
      } else if (dragState.type === "h") {
        const deltaY = event.clientY - dragState.startY;
        const maxArtifacts = Math.max(120, Math.min(420, height * 0.55));
        const artifactsHeight = Math.max(100, Math.min(maxArtifacts, dragState.startLayout.artifactsHeight - deltaY));
        setLayout((prev) => ({ ...prev, artifactsHeight }));
      } else if (dragState.type === "ov") {
        const deltaX = dragState.startX - event.clientX;
        const nextWidth = Math.max(
          OVERLAY_DETAILS_MIN_PX,
          Math.min(dragState.startLayout.detailsOverlayWidth + deltaX, overlayDetailsMaxWidth)
        );
        setLayout((prev) => ({ ...prev, detailsOverlayWidth: nextWidth }));
      }
    };
    const onUp = () => {
      setLayout((prev) => {
        const points = [
          { suites: 25, cases: 50, details: 25, detailsCollapsed: false },
          { suites: 30, cases: 45, details: 25, detailsCollapsed: false },
          { suites: 35, cases: 65, details: 0, detailsCollapsed: true },
        ];
        let snapped = prev;
        for (const p of points) {
          const d0 = Math.abs(prev.suites - p.suites);
          const d1 = Math.abs(prev.cases - p.cases);
          const d2 = Math.abs((prev.detailsCollapsed ? 0 : prev.details) - p.details);
          if (Math.max(d0, d1, d2) <= 3) {
            snapped = { ...prev, ...p, suites: Math.min(33, p.suites) };
            break;
          }
        }
        if (snapped.suites > 33) snapped = { ...snapped, suites: 33 };
        return snapped;
      });
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragState(null);
    };
    const onPointerMove = (event) => {
      if (dragState.pointerId != null && event.pointerId != null && event.pointerId !== dragState.pointerId) return;
      onMove(event);
    };
    const onPointerUp = (event) => {
      if (dragState.pointerId != null && event.pointerId != null && event.pointerId !== dragState.pointerId) return;
      onUp();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [
    dragState,
    DIVIDER_PX,
    suitesMinPx,
    casesMinPx,
    detailsMinPx,
    SUITES_MIN_PX,
    CASES_MIN_PX,
    OVERLAY_DETAILS_MIN_PX,
    overlayDetailsMaxWidth,
  ]);

  useEffect(() => {
    if (!graphDrag) return;
    const onMove = (event) => {
      const total = Math.max(1, graphDrag.containerWidth);
      const delta = graphDrag.startX - event.clientX;
      const maxWidth = Math.max(GRAPH_RIGHT_MIN_PX, Math.min(GRAPH_RIGHT_MAX_PX, total - GRAPH_CENTER_MIN_PX - GRAPH_DIVIDER_PX));
      const next = Math.max(GRAPH_RIGHT_MIN_PX, Math.min(maxWidth, graphDrag.startWidth + delta));
      setGraphRightWidth(next);
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setGraphDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [graphDrag, GRAPH_RIGHT_MIN_PX, GRAPH_RIGHT_MAX_PX, GRAPH_CENTER_MIN_PX, GRAPH_DIVIDER_PX]);

  return {
    testsLayoutRef,
    graphLayoutRef,
    layout,
    setLayout,
    containerSize,
    detailsInline,
    suitesMinPx,
    casesMinPx,
    detailsMinPx,
    overlayDetailsMaxWidth,
    graphCanInlineDetails,
    graphRightWidthClamped,
    graphAvailableWidth,
    startDrag,
    startGraphDividerDrag,
  };
}
