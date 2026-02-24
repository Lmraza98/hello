import React, { useMemo, useRef, useState } from "react";
import type { GraphStateLike } from "./graphTypes";
import type { RunEvent } from "../../lib/graph/types";
import type { GraphPathStep, GraphTransition } from "./graphTypes";

export type PlaybackEntry = {
  id: string;
  nodeId: string;
  focusNodeId?: string;
  type: string;
  kind?: string;
  ts: number;
  sourceEventId?: string;
  label?: string;
  explanation?: string;
};

export function usePlaybackEntries({
  graphState,
  events,
  childScopeEvents,
}: {
  graphState: GraphStateLike;
  events: RunEvent[];
  childScopeEvents: RunEvent[];
}) {
  const [transition, setTransition] = useState<{ from: string; to: string; until: number } | null>(null);
  const [eventBadgeByNode, setEventBadgeByNode] = useState<Record<string, string>>({});
  const prevCursorRef = useRef(0);

  const playbackMode = graphState.playback?.mode || "timeline";
  const pathTransitions: GraphTransition[] = graphState.playback?.transitions || [];
  const pathSteps: GraphPathStep[] = graphState.playback?.pathSteps || [];

  const pathEventStream = useMemo(
    (): PlaybackEntry[] =>
      (pathSteps || []).map((step, idx: number) => {
        const tr = pathTransitions[Number(step?.transitionCursor ?? -1)] || null;
        return {
          id: String(step?.transitionId || tr?.id || `path-${idx}`),
          focusNodeId: String(step?.focusNodeId || tr?.nodeId || ""),
          nodeId: String(step?.focusNodeId || tr?.nodeId || ""),
          type: String(tr?.kind || "note"),
          ts: Number(step?.ts ?? tr?.ts ?? idx),
          sourceEventId: String(step?.sourceEventId || tr?.sourceEventId || ""),
          label: String(step?.label || ""),
          explanation: String(step?.explanation || ""),
        };
      }),
    [pathSteps, pathTransitions]
  );

  const timelineEventStream = useMemo(
    (): PlaybackEntry[] => {
      const allEvents = [...(events || []), ...(childScopeEvents || [])].sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0));
      return allEvents.map((ev) => ({
        id: String(ev?.id || ""),
        nodeId: String(ev?.nodeId || ""),
        type: String(ev?.type || "note"),
        ts: Number(ev?.ts || 0),
      }));
    },
    [events, childScopeEvents]
  );

  const playbackEntries = playbackMode === "path" ? pathEventStream : timelineEventStream;
  const cursor = graphState.playback?.cursor || 0;
  const isPlaying = Boolean(graphState.playback?.isPlaying);
  const speed = Number(graphState.playback?.speed || 1);
  const currentEvent = playbackEntries[cursor] || null;
  const pathExplanation = String(currentEvent?.explanation || graphState.playback?.pathExplanation || "");
  const playbackNodeId = String(currentEvent?.focusNodeId || currentEvent?.nodeId || "");

  React.useEffect(() => {
    if (cursor === prevCursorRef.current) return;
    const prevEv = playbackEntries[prevCursorRef.current] || null;
    const nextEv = playbackEntries[cursor] || null;
    const from = String(prevEv?.focusNodeId || prevEv?.nodeId || "");
    const to = String(nextEv?.focusNodeId || nextEv?.nodeId || "");
    prevCursorRef.current = cursor;
    if (from && to && from !== to) {
      // Behavior lock: transition window/clear timing must remain 800/850ms.
      const until = Date.now() + 800;
      setTransition({ from, to, until });
      window.setTimeout(() => {
        setTransition((cur) => (cur && cur.until === until ? null : cur));
      }, 850);
    }
    if (to) {
      const msg = String(nextEv?.type || nextEv?.kind || "").toUpperCase();
      setEventBadgeByNode((prev) => ({ ...prev, [to]: msg }));
      // Behavior lock: badge clear timing must remain 650ms when unchanged.
      window.setTimeout(() => {
        setEventBadgeByNode((prev) => {
          if (prev[to] !== msg) return prev;
          const copy = { ...prev };
          delete copy[to];
          return copy;
        });
      }, 650);
    }
  }, [cursor, playbackEntries]);

  return {
    playbackMode,
    pathTransitions,
    pathSteps,
    playbackEntries,
    cursor,
    isPlaying,
    speed,
    currentEvent,
    pathExplanation,
    playbackNodeId,
    transition,
    setTransition,
    eventBadgeByNode,
    setEventBadgeByNode,
    prevCursorRef,
  };
}
