import { useEffect, useRef, useState } from "react";

/**
 * Owns graph domain state containers and timer lifecycle.
 * Invariants:
 * - Bubble timeout is always cleared on unmount and when scope exits suite.
 * - Graph selection/follow/scoped-model state stays centralized in one domain hook.
 */
export function useGraphController() {
  const [followActiveChild, setFollowActiveChild] = useState(false);
  const [followActivePaused, setFollowActivePaused] = useState(false);
  const [manualGraphChildId, setManualGraphChildId] = useState("");
  const [graphDetailsOpen, setGraphDetailsOpen] = useState(false);
  const [graphBottomTab, setGraphBottomTab] = useState("timeline");
  const [graphScope, setGraphScope] = useState({ level: "suite", aggregateId: "", childId: "" });
  const [graphSelectedRunTargetId, setGraphSelectedRunTargetId] = useState("");
  const [graphBubbleAggregateId, setGraphBubbleAggregateId] = useState("");
  const [graphScopedModel, setGraphScopedModel] = useState({ nodes: [], edges: [], scope: "suite" });
  const [childScopeEvents, setChildScopeEvents] = useState([]);
  const [childProgressByParent, setChildProgressByParent] = useState({});
  const [graphState, setGraphState] = useState({
    nodes: [],
    edges: [],
    events: [],
    screenshots: [],
    selectedNodeId: "",
    selectedEventId: "",
    highlightMode: "both",
    playback: {
      isPlaying: false,
      cursor: 0,
      speed: 1,
      mode: "timeline",
      transitions: [],
      pathSteps: [],
      transitionCursor: -1,
      branchLockId: "",
    },
    manualOverride: false,
    statusFilters: [],
  });

  const runAutoTrackRef = useRef({ runId: "", aggregateId: "", engaged: false });
  const graphBubbleTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (graphBubbleTimerRef.current != null) {
        window.clearTimeout(graphBubbleTimerRef.current);
        graphBubbleTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (String(graphScope?.level || "suite") === "suite") return;
    if (graphBubbleTimerRef.current != null) {
      window.clearTimeout(graphBubbleTimerRef.current);
      graphBubbleTimerRef.current = null;
    }
    if (graphBubbleAggregateId) setGraphBubbleAggregateId("");
  }, [graphScope?.level, graphBubbleAggregateId]);

  return {
    followActiveChild,
    setFollowActiveChild,
    followActivePaused,
    setFollowActivePaused,
    manualGraphChildId,
    setManualGraphChildId,
    graphDetailsOpen,
    setGraphDetailsOpen,
    graphBottomTab,
    setGraphBottomTab,
    graphScope,
    setGraphScope,
    graphSelectedRunTargetId,
    setGraphSelectedRunTargetId,
    graphBubbleAggregateId,
    setGraphBubbleAggregateId,
    graphScopedModel,
    setGraphScopedModel,
    childScopeEvents,
    setChildScopeEvents,
    childProgressByParent,
    setChildProgressByParent,
    graphState,
    setGraphState,
    runAutoTrackRef,
  };
}
