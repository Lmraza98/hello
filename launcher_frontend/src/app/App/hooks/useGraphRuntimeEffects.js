import { useCallback, useEffect, useRef } from "react";
import { buildNodeTransitions } from "../../../lib/graph/playback/transitions";
import { buildPathSteps, stepNextCursor } from "../../../lib/graph/playback/GraphPlaybackEngine";
import { sameProgressRows } from "../utils/comparisons";
import {
  canonicalChildId,
  isPytestGateAggregateId,
  normalizeSuiteSelectionNodeId,
} from "../utils/ids";
import {
  pickActiveAggregateFromGraph,
  pickActiveChildFromAggregateNode,
  pickActiveRunNodeId,
  pickAggregateForActiveChild,
  pickPreferredAggregateId,
} from "../utils/runPickers";

export function useGraphRuntimeEffects(params) {
  const {
    runtimeDebug,
    bridge,
    tab,
    graphModel,
    graphState,
    setGraphState,
    graphScope,
    setGraphScope,
    graphScopedModel,
    selectedRunId,
    activeRunId,
    runs,
    statusById,
    setStatusById,
    followActiveChild,
    followActivePaused,
    setFollowActivePaused,
    manualGraphChildId,
    setManualGraphChildId,
    aggregateFilterIds,
    aggregateFilterOptions,
    setGraphBubbleAggregateId,
    setChildScopeEvents,
    setChildProgressByParent,
    runAutoTrackRef,
    setGraphDetailsOpen,
    graphNodesWithPlayback,
    artifactReplayMode,
    suppressLiveGraphAutotrack,
    playbackActiveNodeId,
    activeAggregateNode,
    detailsAggregateNode,
    graphActiveChildId,
    graphDetailChildId,
    childAttemptById,
    activeChildProgressRows,
    pathPlaybackState,
    activeRunRow,
  } = params;

  const rightPaneSigRef = useRef("");
  useEffect(() => {
    if (!runtimeDebug) return;
    const parentId = String(detailsAggregateNode?.id || "");
    const childId = String(graphDetailChildId || "");
    const runningRow = (activeChildProgressRows || []).find((row) => String(row?.status || "").toLowerCase() === "running");
    const runningChild = String(runningRow?.childId || "");
    const sig = `${parentId}|${childId}|${runningChild}|${followActiveChild}|${followActivePaused}`;
    if (rightPaneSigRef.current === sig) return;
    rightPaneSigRef.current = sig;
    console.warn("[graph] right-pane binding", {
      parentId,
      childId,
      runningChild,
      followActiveChild,
      followActivePaused,
      scope: graphScope,
    });
  }, [runtimeDebug, detailsAggregateNode, graphDetailChildId, activeChildProgressRows, followActiveChild, followActivePaused, graphScope]);

  useEffect(() => {
    if (!bridge || typeof bridge.get_child_events !== "function") {
      setChildScopeEvents([]);
      return;
    }
    if (tab !== "graph" || graphScope?.level !== "child") {
      setChildScopeEvents([]);
      return;
    }
    const runId = String(selectedRunId || activeRunId || "");
    const childId = String(graphScope?.childId || "");
    if (!runId || !childId) {
      setChildScopeEvents([]);
      return;
    }
    const attempt = childAttemptById?.[childId] ?? "latest";
    let alive = true;
    const load = async () => {
      try {
        const rows = await bridge.get_child_events(runId, childId, attempt);
        if (!alive) return;
        setChildScopeEvents(Array.isArray(rows) ? rows : []);
      } catch {
        if (!alive) return;
        setChildScopeEvents([]);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 800);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [bridge, tab, graphScope, selectedRunId, activeRunId, childAttemptById]);

  useEffect(() => {
    if (!bridge || typeof bridge.get_child_progress !== "function") {
      setChildProgressByParent({});
      return;
    }
    if (tab !== "graph") {
      return;
    }
    const runId = String(selectedRunId || activeRunId || "");
    const runRow = runs.find((r) => String(r?.run_id || "") === runId) || null;
    const runStatus = String(runRow?.status || "").toLowerCase();
    const runIsActive = ["running", "queued", "retrying"].includes(runStatus);
    let parentId = "";
    if (graphScope?.level === "child") {
      parentId = String(graphScope?.aggregateId || "");
    } else if (activeAggregateNode?.aggregateChildren?.length) {
      parentId = String(activeAggregateNode?.id || "");
    }
    if (!runId || !parentId) {
      setChildProgressByParent((prev) => {
        if (!Object.keys(prev || {}).length) return prev;
        const next = { ...prev };
        delete next[parentId];
        return next;
      });
      return;
    }
    if (!runIsActive) {
      // keep last progress rows for diagnostics, but stop polling in terminal states
      return;
    }
    const attempt = statusById[parentId]?.attempt ?? "latest";
    let alive = true;
    const load = async () => {
      try {
        const rows = await bridge.get_child_progress(runId, parentId, attempt);
        if (!alive) return;
        const normalized = Array.isArray(rows) ? rows : [];
        setChildProgressByParent((prev) => {
          const prevRows = prev[parentId] || [];
          if (sameProgressRows(prevRows, normalized)) return prev;
          return { ...prev, [parentId]: normalized };
        });
        setStatusById((prev) => {
          let changed = false;
          const next = { ...prev };
          normalized.forEach((row) => {
            const id = String(row?.childId || "");
            if (!id) return;
            const cur = next[id] || {};
            const nextRow = {
              ...cur,
              status: String(row?.status || cur.status || "not_run"),
              attempt: row?.attemptId ?? cur.attempt,
              started_at: row?.startedAt ?? cur.started_at,
              finished_at: row?.finishedAt ?? cur.finished_at,
              message: row?.message ?? cur.message,
              updated_at: Date.now() / 1000,
            };
            if (
              String(cur.status || "") !== String(nextRow.status || "") ||
              String(cur.attempt ?? "") !== String(nextRow.attempt ?? "") ||
              String(cur.started_at ?? "") !== String(nextRow.started_at ?? "") ||
              String(cur.finished_at ?? "") !== String(nextRow.finished_at ?? "") ||
              String(cur.message || "") !== String(nextRow.message || "")
            ) {
              changed = true;
            }
            next[id] = nextRow;
          });
          return changed ? next : prev;
        });
      } catch {
        if (!alive) return;
        setChildProgressByParent((prev) => {
          const prevRows = prev[parentId] || [];
          if (!prevRows.length) return prev;
          return { ...prev, [parentId]: [] };
        });
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 800);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [bridge, tab, graphScope, selectedRunId, activeRunId, activeAggregateNode, runs]);
  useEffect(() => {
    if (tab !== "graph") return;
    const selected = Array.isArray(aggregateFilterIds)
      ? aggregateFilterIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (selected.length === 0 || selected.length > 1) {
      if (String(graphScope?.level || "suite") !== "suite") {
        setGraphScope({ level: "suite", aggregateId: "", childId: "" });
      }
      return;
    }
    const requested = String(selected[0] || "");
    const optionById = (aggregateFilterOptions || []).find((opt) => String(opt?.id || "") === requested) || null;
    const optionByName =
      optionById ||
      (aggregateFilterOptions || []).find((opt) => String(opt?.name || "").toLowerCase() === requested.toLowerCase()) ||
      null;
    const targetAggregateId = String(optionByName?.id || requested);
    const hasAggregateNode = (graphNodesWithPlayback || []).some(
      (node) => String(node?.id || "") === targetAggregateId && Boolean(node?.aggregateSummary)
    );
    if (!hasAggregateNode) return;
    if (String(graphScope?.level || "suite") !== "aggregate" || String(graphScope?.aggregateId || "") !== targetAggregateId) {
      setGraphScope({ level: "aggregate", aggregateId: targetAggregateId, childId: "" });
    }
    if (String(graphState?.selectedNodeId || "") !== targetAggregateId) {
      setGraphState((prev) => ({ ...prev, selectedNodeId: targetAggregateId }));
    }
  }, [
    tab,
    aggregateFilterIds,
    aggregateFilterOptions,
    graphNodesWithPlayback,
    graphScope?.level,
    graphScope?.aggregateId,
    graphState?.selectedNodeId,
  ]);

  useEffect(() => {
    if (!detailsAggregateNode?.aggregateSummary) return;
    if (followActiveChild && !followActivePaused && graphActiveChildId && manualGraphChildId !== graphActiveChildId) {
      setManualGraphChildId(graphActiveChildId);
    }
  }, [detailsAggregateNode, followActiveChild, followActivePaused, graphActiveChildId, manualGraphChildId]);

  useEffect(() => {
    if (tab !== "graph") return;
    if (graphScope?.level !== "child") return;
    if (!detailsAggregateNode?.aggregateSummary) return;
    if (!graphActiveChildId) return;
    if (!followActiveChild || followActivePaused) return;
    const childId = canonicalChildId(detailsAggregateNode.id, graphActiveChildId);
    setGraphScope((prev) => ({ ...prev, childId }));
  }, [tab, graphScope?.level, detailsAggregateNode, graphActiveChildId, followActiveChild, followActivePaused]);

  const resolveScopedGraph = useCallback(
    (baseNodes, baseEdges) => {
      const scopedNodesCandidate = Array.isArray(graphScopedModel?.nodes) ? graphScopedModel.nodes : [];
      const scopedEdgesCandidate = Array.isArray(graphScopedModel?.edges) ? graphScopedModel.edges : [];
      if (!scopedNodesCandidate.length) {
        return { nodes: baseNodes, edges: baseEdges };
      }
      const baseNodeIds = new Set((baseNodes || []).map((n) => String(n?.id || "")).filter(Boolean));
      const validScopedNodes = scopedNodesCandidate.every((n) => baseNodeIds.has(String(n?.id || "")));
      const validScopedEdges = scopedEdgesCandidate.every((e) => {
        const from = String(e?.from || "");
        const to = String(e?.to || "");
        return baseNodeIds.has(from) && baseNodeIds.has(to);
      });
      if (!validScopedNodes || !validScopedEdges) {
        return { nodes: baseNodes, edges: baseEdges };
      }
      return {
        nodes: scopedNodesCandidate,
        edges: scopedEdgesCandidate.length ? scopedEdgesCandidate : baseEdges,
      };
    },
    [graphScopedModel]
  );

  useEffect(() => {
    setGraphState((prev) => {
      const nextNodes = graphModel.nodes || [];
      const nextEdges = graphModel.edges || [];
      const nextEvents = graphModel.events || [];
      const nextTransitions = buildNodeTransitions(nextEvents);
      const scoped = resolveScopedGraph(nextNodes, nextEdges);
      const scopedNodes = scoped.nodes;
      const scopedEdges = scoped.edges;
      const nextPathSteps = buildPathSteps({
        nodes: scopedNodes,
        edges: scopedEdges,
        transitions: nextTransitions,
        branchLockRootId: String(prev.playback?.branchLockId || ""),
      });
      const nextScreenshots = graphModel.screenshots || [];
      const mode = prev.playback?.mode || "timeline";
      const activeEntries = mode === "path" ? nextPathSteps : nextEvents;
      const prevSelectedRaw =
        prev.selectedNodeId && nextNodes.some((n) => n.id === prev.selectedNodeId)
          ? prev.selectedNodeId
          : (nextNodes[0]?.id || "");
      const selectedNodeId =
        String(graphScope?.level || "suite") === "suite"
          ? normalizeSuiteSelectionNodeId(prevSelectedRaw, nextNodes)
          : prevSelectedRaw;
      const selectedEventId =
        prev.selectedEventId && nextEvents.some((e) => e.id === prev.selectedEventId)
          ? prev.selectedEventId
          : (nextEvents[0]?.id || "");
      const maxCursor = Math.max(0, activeEntries.length - 1);
      const cursor = Math.max(0, Math.min(prev.playback?.cursor || 0, maxCursor));
      const activeEntry = activeEntries[cursor] || null;
      const transitionCursor = mode === "path"
        ? Number(activeEntry?.transitionCursor ?? -1)
        : (activeEntry ? cursor : -1);
      const activeNodeRaw = String(activeEntry?.nodeId || "");
      const activeNodeId =
        String(graphScope?.level || "suite") === "suite"
          ? normalizeSuiteSelectionNodeId(activeNodeRaw, nextNodes)
          : activeNodeRaw;
      return {
        ...prev,
        nodes: nextNodes,
        edges: nextEdges,
        events: nextEvents,
        screenshots: nextScreenshots,
        selectedNodeId: mode === "path" ? selectedNodeId : (activeNodeId || selectedNodeId),
        selectedEventId,
        playback: {
          isPlaying: prev.playback?.isPlaying || false,
          cursor,
          speed: Number(prev.playback?.speed || 1),
          mode,
          transitions: nextTransitions,
          pathSteps: nextPathSteps,
          transitionCursor,
          branchLockId: String(prev.playback?.branchLockId || ""),
        },
      };
    });
  }, [graphModel, resolveScopedGraph, graphScope?.level, normalizeSuiteSelectionNodeId]);

  useEffect(() => {
    setGraphState((prev) => {
      const transitions = prev.playback?.transitions || [];
      const branchLockId = String(prev.playback?.branchLockId || "");
      const scoped = resolveScopedGraph(prev.nodes || [], prev.edges || []);
      const scopedNodes = scoped.nodes;
      const scopedEdges = scoped.edges;
      const nextPathSteps = buildPathSteps({
        nodes: scopedNodes,
        edges: scopedEdges,
        transitions,
        branchLockRootId: branchLockId,
      });
      const prevPathSteps = prev.playback?.pathSteps || [];
      const sigOf = (rows) => {
        if (!rows.length) return "0";
        const mid = rows[Math.floor(rows.length / 2)] || {};
        const head = rows.slice(0, Math.min(6, rows.length)).map((r) => `${r.focusNodeId}:${r.transitionId}`).join("|");
        return `${rows.length}:${rows[0]?.focusNodeId || ""}:${rows[0]?.transitionId || ""}:${mid?.focusNodeId || ""}:${mid?.transitionId || ""}:${rows[rows.length - 1]?.focusNodeId || ""}:${rows[rows.length - 1]?.transitionId || ""}:${head}`;
      };
      const prevSig = sigOf(prevPathSteps);
      const nextSig = sigOf(nextPathSteps);
      if (prevSig === nextSig) return prev;
      const mode = prev.playback?.mode || "timeline";
      const nextCursor =
        mode === "path"
          ? Math.min(Number(prev.playback?.cursor || 0), Math.max(0, nextPathSteps.length - 1))
          : Number(prev.playback?.cursor || 0);
      const nextStep = nextPathSteps[nextCursor] || null;
      return {
        ...prev,
        playback: {
          ...prev.playback,
          pathSteps: nextPathSteps,
          cursor: nextCursor,
          transitionCursor: mode === "path" ? Number(nextStep?.transitionCursor ?? -1) : Number(prev.playback?.transitionCursor ?? -1),
        },
      };
    });
  }, [graphScope, graphState.playback?.branchLockId, resolveScopedGraph]);

  useEffect(() => {
    if (!graphState.playback?.isPlaying) return;
    const speed = Number(graphState.playback?.speed || 1);
    const intervalMs = Math.max(120, Math.round(680 / Math.max(0.25, speed)));
    const id = window.setInterval(() => {
      setGraphState((prev) => {
        const mode = prev.playback?.mode || "timeline";
        const activeEntries = mode === "path" ? (prev.playback?.pathSteps || []) : (prev.events || []);
        const max = Math.max(0, activeEntries.length - 1);
        const nextCursor = stepNextCursor(prev.playback?.cursor || 0, max);
        const atEnd = nextCursor >= max;
        const active = activeEntries[nextCursor] || null;
        const selectedEventId = mode === "path"
          ? (active?.sourceEventId || prev.selectedEventId)
          : (active?.id || prev.selectedEventId);
        return {
          ...prev,
          playback: {
            isPlaying: atEnd ? false : Boolean(prev.playback?.isPlaying),
            cursor: nextCursor,
            speed: Number(prev.playback?.speed || 1),
            mode,
            transitions: prev.playback?.transitions || [],
            pathSteps: prev.playback?.pathSteps || [],
            transitionCursor: mode === "path" ? Number(active?.transitionCursor ?? prev.playback?.transitionCursor ?? -1) : nextCursor,
            branchLockId: String(prev.playback?.branchLockId || ""),
          },
          selectedEventId,
          selectedNodeId: mode === "path"
            ? prev.selectedNodeId
            : (
                (String(graphScope?.level || "suite") === "suite"
                  ? normalizeSuiteSelectionNodeId(String(active?.nodeId || ""), prev.nodes || [])
                  : String(active?.nodeId || ""))
                || prev.selectedNodeId
              ),
        };
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [graphState.playback?.isPlaying, graphState.playback?.speed, graphState.playback?.mode, graphScope?.level, normalizeSuiteSelectionNodeId]);

  useEffect(() => {
    if ((graphState.playback?.mode || "timeline") !== "path") return;
    const activeNodeId = String(pathPlaybackState.activeNodeId || "");
    if (!activeNodeId) return;
    const nextSelectedEventId = pathPlaybackState.activeTransition?.sourceEventId || graphState.selectedEventId;
    setGraphState((prev) => {
      const nextExplanation = String(pathPlaybackState.explanation || "");
      const prevExplanation = String(prev.playback?.pathExplanation || "");
      if (prev.selectedNodeId === activeNodeId && prev.selectedEventId === nextSelectedEventId && prevExplanation === nextExplanation) return prev;
      return {
        ...prev,
        selectedNodeId: activeNodeId,
        selectedEventId: nextSelectedEventId,
        playback: {
          ...prev.playback,
          transitionCursor: Number(pathPlaybackState.transitionCursorUsed ?? prev.playback?.transitionCursor ?? -1),
          pathExplanation: nextExplanation,
        },
      };
    });
  }, [graphState.playback?.mode, pathPlaybackState.activeNodeId, pathPlaybackState.activeTransition?.sourceEventId, pathPlaybackState.transitionCursorUsed, pathPlaybackState.explanation, graphState.selectedEventId]);


  useEffect(() => {
    if (artifactReplayMode) {
      runAutoTrackRef.current = { runId: "", aggregateId: "", engaged: false };
    }
  }, [artifactReplayMode]);

  useEffect(() => {
    if (tab !== "graph") return;
    if (!artifactReplayMode) return;
    if (!graphState.playback?.isPlaying) return;
    if (!followActiveChild || followActivePaused) return;
    const nodeId = String(playbackActiveNodeId || "");
    if (!nodeId) return;

    if (nodeId.includes("::")) {
      const aggregateId = String(nodeId.split("::")[0] || "");
      if (!aggregateId) return;
      const nextChildId = canonicalChildId(aggregateId, nodeId.split("::").slice(1).join("::"));
      if (graphScope?.level === "suite") {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nextChildId }));
        if (!isPytestGateAggregateId(aggregateId, graphNodesWithPlayback)) setGraphBubbleAggregateId(aggregateId);
        else setGraphBubbleAggregateId("");
        return;
      }
      if (
        graphScope?.level !== "child" ||
        String(graphScope?.aggregateId || "") !== aggregateId ||
        String(graphScope?.childId || "") !== nextChildId
      ) {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nextChildId }));
        setGraphScope({ level: "child", aggregateId, childId: nextChildId });
      }
      return;
    }

    const isAggregate = graphNodesWithPlayback.some((n) => String(n?.id || "") === nodeId && Boolean(n?.aggregateSummary));
    if (isAggregate) {
      if (graphScope?.level === "suite") {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nodeId }));
        if (!isPytestGateAggregateId(nodeId, graphNodesWithPlayback)) setGraphBubbleAggregateId(nodeId);
        else setGraphBubbleAggregateId("");
        return;
      }
      if (graphScope?.level !== "aggregate" || String(graphScope?.aggregateId || "") !== nodeId) {
        setGraphState((prev) => ({ ...prev, selectedNodeId: nodeId }));
        setGraphScope({ level: "aggregate", aggregateId: nodeId, childId: "" });
      }
      return;
    }

    if (graphScope?.level !== "suite" || String(graphState.selectedNodeId || "") !== nodeId) {
      setGraphState((prev) => ({ ...prev, selectedNodeId: nodeId }));
      setGraphScope({ level: "suite", aggregateId: "", childId: "" });
    }
  }, [
    tab,
    artifactReplayMode,
    graphState.playback?.isPlaying,
    followActiveChild,
    followActivePaused,
    playbackActiveNodeId,
    graphScope,
    graphNodesWithPlayback,
    graphState.selectedNodeId,
  ]);

  useEffect(() => {
    if (tab !== "graph") return;
    if (suppressLiveGraphAutotrack) return;
    const tracking = runAutoTrackRef.current;
    const runId = String(tracking?.runId || "");
    const runRow = runId ? (runs.find((r) => String(r?.run_id || "") === runId) || null) : activeRunRow;
    const runStatus = String(runRow?.status || "").toLowerCase();
    const runIsActive = ["running", "queued", "retrying"].includes(runStatus);

    // Always pop out on tracked run completion, even if follow is paused by manual interaction.
    if (tracking.engaged && (!runRow || !runIsActive)) {
      const aggregateId = String(tracking.aggregateId || graphScope?.aggregateId || "");
      if (aggregateId) {
        setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
        setGraphScope({ level: "aggregate", aggregateId, childId: "" });
      } else {
        setGraphScope({ level: "suite", aggregateId: "", childId: "" });
      }
      runAutoTrackRef.current = { runId: "", aggregateId: "", engaged: false };
      return;
    }
    if (!followActiveChild) return;
    if (!runIsActive) return;

    const activeAggregateFromGraph = pickActiveAggregateFromGraph(graphNodesWithPlayback, statusById);
    const activeAggregateId = pickActiveRunNodeId(runRow, graphNodesWithPlayback, statusById);
    const preferredAggregateId = pickPreferredAggregateId(runRow, graphNodesWithPlayback);
    let aggregateId = String(activeAggregateFromGraph || activeAggregateId || preferredAggregateId || tracking.aggregateId || "");
    if (!aggregateId) return;

    // If user paused follow but run has moved to a different active node,
    // auto-resume so details do not stay pinned to stale context.
    if (followActivePaused) {
      const currentAggregate = String(graphScope?.aggregateId || "");
      if (!currentAggregate || currentAggregate !== aggregateId) {
        setFollowActivePaused(false);
      } else {
        return;
      }
    }
    if (tracking.aggregateId !== aggregateId) {
      runAutoTrackRef.current = {
        runId: String(runRow?.run_id || activeRunId || ""),
        aggregateId,
        engaged: Boolean(tracking.engaged),
      };
    }

    let aggregateNode = graphNodesWithPlayback.find((n) => String(n?.id || "") === aggregateId) || null;
    let activeChild = pickActiveChildFromAggregateNode(aggregateNode);
    const remappedAggregateId = pickAggregateForActiveChild(activeChild, graphNodesWithPlayback, aggregateId);
    if (remappedAggregateId && remappedAggregateId !== aggregateId) {
      aggregateId = remappedAggregateId;
      aggregateNode = graphNodesWithPlayback.find((n) => String(n?.id || "") === aggregateId) || null;
      const aggregateActiveChild = pickActiveChildFromAggregateNode(aggregateNode);
      const childExists = (aggregateNode?.aggregateChildren || []).some((c) => String(c?.id || "") === activeChild);
      if (!childExists) activeChild = aggregateActiveChild;
    }
    if (!tracking.engaged) {
      runAutoTrackRef.current = { runId: String(runRow?.run_id || activeRunId || ""), aggregateId, engaged: true };
    }

    // Enter aggregate and follow to child while active child signals exist.
    if (graphScope?.level === "suite") {
      setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
      if (!isPytestGateAggregateId(aggregateId, graphNodesWithPlayback)) setGraphBubbleAggregateId(aggregateId);
      else setGraphBubbleAggregateId("");
      return;
    }
    if ((graphScope?.level === "aggregate" || graphScope?.level === "child") && String(graphScope?.aggregateId || "") !== aggregateId) {
      setGraphState((prev) => ({ ...prev, selectedNodeId: aggregateId }));
      setGraphScope({ level: activeChild ? "child" : "aggregate", aggregateId, childId: activeChild ? canonicalChildId(aggregateId, activeChild) : "" });
      return;
    }
    if (graphScope?.level === "aggregate" && activeChild) {
      setGraphScope({ level: "child", aggregateId, childId: canonicalChildId(aggregateId, activeChild) });
      return;
    }
    if (graphScope?.level === "child" && graphScope?.aggregateId === aggregateId && activeChild) {
      const nextChild = canonicalChildId(aggregateId, activeChild);
      if (String(graphScope?.childId || "") !== nextChild) {
        setGraphScope({ level: "child", aggregateId, childId: nextChild });
      }
    }
  }, [tab, followActiveChild, followActivePaused, runs, activeRunRow, activeRunId, graphNodesWithPlayback, graphScope, statusById, suppressLiveGraphAutotrack]);

  function selectGraphNode(nodeId) {
    const node = graphNodesWithPlayback.find((row) => row.id === nodeId) || null;
    setGraphState((prev) => ({
      ...(function () {
        const lockId = nodeId || "";
        const nextPathSteps = buildPathSteps({
          nodes: (graphScopedModel?.nodes && graphScopedModel.nodes.length ? graphScopedModel.nodes : (prev.nodes || [])),
          edges: (graphScopedModel?.edges && graphScopedModel.edges.length ? graphScopedModel.edges : (prev.edges || [])),
          transitions: prev.playback?.transitions || [],
          branchLockRootId: lockId,
        });
        const nextPathCursor =
          (prev.playback?.mode || "timeline") === "path"
            ? Math.min(Number(prev.playback?.cursor || 0), Math.max(0, nextPathSteps.length - 1))
            : Number(prev.playback?.cursor || 0);
        return {
          ...prev,
          selectedNodeId: nodeId || "",
          playback: {
            ...prev.playback,
            branchLockId: lockId,
            pathSteps: nextPathSteps,
            cursor: nextPathCursor,
            transitionCursor:
              (prev.playback?.mode || "timeline") === "path"
                ? Number((nextPathSteps[nextPathCursor] || {}).transitionCursor ?? -1)
                : Number(prev.playback?.transitionCursor ?? -1),
          },
        };
      })(),
    }));
    // Manual graph interaction must pause auto-follow so UI never feels hijacked.
    setFollowActivePaused(true);
    setManualGraphChildId("");
    // Keep suite-mode bubble behavior consistent regardless of aggregate filters.
    if (String(graphScope?.level || "suite") === "suite" && node?.aggregateSummary && nodeId) {
      if (!isPytestGateAggregateId(String(nodeId), graphNodesWithPlayback)) setGraphBubbleAggregateId(String(nodeId));
      else setGraphBubbleAggregateId("");
    }
    if (graphScope?.level === "child" && node?.id === graphScope.aggregateId) {
      setGraphScope({ level: "aggregate", aggregateId: graphScope.aggregateId, childId: "" });
    }
    if (nodeId) setGraphDetailsOpen(true);
  }

  function updateGraphPlayback(patch) {
    setGraphState((prev) => {
      const nextMode = patch.mode == null ? (prev.playback?.mode || "timeline") : patch.mode;
      const activeEntries = nextMode === "path" ? (prev.playback?.pathSteps || []) : (prev.events || []);
      const max = Math.max(0, activeEntries.length - 1);
      const baseCursor = Number(prev.playback?.cursor || 0);
      const nextCursor = patch.cursor == null ? baseCursor : Math.max(0, Math.min(patch.cursor, max));
      const active = activeEntries[nextCursor] || null;
      const selectedEventId = nextMode === "path" ? (active?.sourceEventId || prev.selectedEventId) : (active?.id || prev.selectedEventId);
      const next = {
        ...prev,
        playback: {
          isPlaying: patch.isPlaying == null ? Boolean(prev.playback?.isPlaying) : Boolean(patch.isPlaying),
          cursor: nextCursor,
          speed: patch.speed == null ? Number(prev.playback?.speed || 1) : Number(patch.speed) || 1,
          mode: nextMode,
          transitions: prev.playback?.transitions || [],
          pathSteps: prev.playback?.pathSteps || [],
          transitionCursor: nextMode === "path" ? Number(active?.transitionCursor ?? prev.playback?.transitionCursor ?? -1) : nextCursor,
          branchLockId: String(prev.playback?.branchLockId || ""),
        },
      };
      if (patch.cursor != null || patch.mode != null) {
        const activeNodeId = String(active?.focusNodeId || active?.nodeId || "");
        const normalizedActiveNodeId = activeNodeId.includes("::")
          ? String(activeNodeId.split("::")[0] || "")
          : activeNodeId;
        next.selectedEventId = selectedEventId;
        next.selectedNodeId = normalizedActiveNodeId || prev.selectedNodeId;
      }
      return next;
    });
  }



  return { selectGraphNode, updateGraphPlayback };
}
