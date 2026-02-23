import React from "react";
import GraphNode from "./GraphNode";
import { pathForEdge } from "./graphUtils";

type GraphCanvasProps = {
  layout: { width: number; height: number; byId: Record<string, any> };
  zoom: number;
  allNodes: any[];
  allEdges: any[];
  aggregateFilterIds: string[];
  renderedEdges: any[];
  executionPath: { selectedEdges: Set<string>; selectedNodes: Set<string> };
  transition: { from: string; to: string; until: number } | null;
  blockedChain: { edgeKeys: Set<string>; nodeIds: Set<string> };
  cycleInfo: { hasCycle: boolean; cycleEdges: Set<string> };
  activeNeighborhood: Set<string>;
  effectiveViewMode: "story" | "full";
  hasSearchQuery: boolean;
  matchedIds: Set<string>;
  effectivePathHighlightMode: "off" | "path";
  entryNodeId: string;
  entryNodePos: any;
  renderedNodes: any[];
  selectedNodeId: string;
  currentNodeId: string;
  statusDim: Record<string, boolean>;
  unmetDepsByNode: Record<string, string[]>;
  scopedNodeById: Map<string, any>;
  childMetaById: Map<string, any>;
  eventBadgeByNode: Record<string, string>;
  prereqProof: { total: number; proven: number; missing: number };
  bubbleAggregateId: string;
  setHoveredNodeId: React.Dispatch<React.SetStateAction<string>>;
  graphScope: { level?: string; aggregateId?: string; childId?: string };
  onSelectNode: (id: string) => void;
  onSelectInlineChild?: (childId: string, aggregateId: string) => void;
  onEnterAggregate?: (aggregateId: string) => void;
  setOpenInspectorNodeId: React.Dispatch<React.SetStateAction<string>>;
  setInspectorPinned: React.Dispatch<React.SetStateAction<boolean>>;
  setBlockedFocusNode: React.Dispatch<React.SetStateAction<string>>;
  onOpenNodeDetails?: () => void;
};

function getEdgeStyle(edge: any, ctx: any) {
  let stroke = "#475569";
  let strokeWidth = 1.1;
  let strokeOpacity = ctx.dimmed ? 0.14 : 0.56;
  let strokeDasharray: string | undefined;
  if (ctx.trans) {
    stroke = "#60a5fa";
    strokeWidth = 2.8;
    strokeOpacity = ctx.dimmed ? 0.5 : 0.95;
  } else if (ctx.blocked) {
    stroke = "#ef4444";
    strokeWidth = 2.0;
    strokeOpacity = ctx.dimmed ? 0.4 : 0.88;
  } else if (ctx.pathMode && ctx.inExecutionPath) {
    stroke = "#38bdf8";
    strokeWidth = 2.1;
    strokeOpacity = 0.95;
  } else if (ctx.inCycle) {
    stroke = "#f59e0b";
    strokeWidth = 2.0;
    strokeOpacity = ctx.dimmed ? 0.25 : 0.92;
    strokeDasharray = "5 4";
  } else if (edge.synthetic) {
    stroke = "#334155";
    strokeWidth = 0.9;
    strokeOpacity = ctx.pathMode ? 0.14 : ctx.dimmed ? 0.1 : 0.2;
    strokeDasharray = "4 4";
  } else if (ctx.pathMode) {
    stroke = "#475569";
    strokeWidth = 1.0;
    strokeOpacity = 0.16;
  }
  return {
    stroke,
    strokeWidth,
    strokeOpacity,
    strokeDasharray,
    markerEnd: "url(#graph-arrow)",
  };
}

function getNodeRenderState(node: any, ctx: any) {
  const isSelected = node.id === ctx.selectedNodeId;
  const isCurrent = node.id === ctx.currentNodeId;
  const activePath = ctx.activeNeighborhood.has(node.id);
  const inExecutionPath = ctx.executionPath.selectedNodes.has(node.id);
  const dimByStory = ctx.effectiveViewMode === "story" && !activePath && !isCurrent;
  const dimByExecutionPath =
    ctx.effectivePathHighlightMode === "path" &&
    ctx.executionPath.selectedNodes.size > 0 &&
    !inExecutionPath;
  const dimBySearch = ctx.hasSearchQuery && ctx.matchedIds.size > 0 && !ctx.matchedIds.has(node.id);
  const dimByStatus = ctx.statusDim[node.status || "not_run"];
  const dimmed = dimByExecutionPath || dimByStory || dimBySearch || dimByStatus;
  const unmet = ctx.unmetDepsByNode[node.id] || [];
  const blockedHint = unmet.length
    ? `Blocked by: ${unmet
        .slice(0, 3)
        .map((id: string) => ctx.scopedNodeById.get(id)?.name || ctx.childMetaById.get(id)?.name || id)
        .join(", ")}`
    : "";
  return {
    dimmed,
    highlighted: (ctx.effectivePathHighlightMode === "path" ? inExecutionPath : activePath) || isSelected,
    compact: ctx.zoom < 0.9,
    blockedHint,
    inBlockedChain: ctx.blockedChain.nodeIds.has(node.id),
    prereqBadge:
      node.id === ctx.currentNodeId && ctx.prereqProof.total > 0
        ? `deps ${ctx.prereqProof.proven}/${ctx.prereqProof.total}`
        : "",
    eventBadge: ctx.eventBadgeByNode[node.id] || "",
    isSelected,
    isCurrent,
  };
}

function nodeRectFromPos(pos: any) {
  if (!pos) return null;
  const x = Number(pos.x);
  const y = Number(pos.y);
  const w = Number(pos.width);
  const h = Number(pos.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
}

function boundsFromRects(rects: any[]) {
  const valid = (rects || []).filter(Boolean);
  if (!valid.length) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  valid.forEach((r) => {
    left = Math.min(left, Number(r.left));
    top = Math.min(top, Number(r.top));
    right = Math.max(right, Number(r.right));
    bottom = Math.max(bottom, Number(r.bottom));
  });
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) return null;
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function pickStartChildId({ aggregateId, childIds, edges, posById }: any) {
  const idSet = new Set((childIds || []).map((id: string) => String(id || "")).filter(Boolean));
  if (!aggregateId || !idSet.size) return "";
  const indegree = new Map<string, number>();
  idSet.forEach((id) => indegree.set(id, 0));
  (edges || []).forEach((edge: any) => {
    if (edge?.semantic === false) return;
    const from = String(edge?.from || "");
    const to = String(edge?.to || "");
    if (!idSet.has(from) || !idSet.has(to)) return;
    indegree.set(to, (indegree.get(to) || 0) + 1);
  });
  const roots = Array.from(idSet).filter((id) => (indegree.get(id) || 0) === 0);
  const candidates = roots.length ? roots : Array.from(idSet);
  const sorted = [...candidates].sort((a, b) => {
    const ap = posById?.[a];
    const bp = posById?.[b];
    const ax = Number(ap?.x ?? Number.POSITIVE_INFINITY);
    const bx = Number(bp?.x ?? Number.POSITIVE_INFINITY);
    if (ax !== bx) return ax - bx;
    const ay = Number(ap?.y ?? Number.POSITIVE_INFINITY);
    const by = Number(bp?.y ?? Number.POSITIVE_INFINITY);
    if (ay !== by) return ay - by;
    return String(a).localeCompare(String(b));
  });
  return String(sorted[0] || "");
}

function isPytestGateAggregate(node: any) {
  const id = String(node?.id || "").toLowerCase();
  const name = String(node?.name || "").toLowerCase();
  return id === "backend-gate-pytest-ready" || /pytest runtime ready/.test(id) || /pytest runtime ready/.test(name);
}

function EdgesLayer({ layout, zoom, renderedEdges, edgeCtx, effectiveById }: any) {
  return (
    <svg width={layout.width * zoom} height={layout.height * zoom} className="absolute left-0 top-0">
      <defs>
        <marker id="graph-arrow" markerWidth="5" markerHeight="5" refX="4.5" refY="2.5" orient="auto">
          <polygon points="0 0, 5 2.5, 0 5" fill="#64748b" />
        </marker>
      </defs>
      <g transform={`scale(${zoom})`}>
        {renderedEdges.map((edge: any) => {
          const from = effectiveById[edge.from];
          const to = effectiveById[edge.to];
          if (!from || !to) return null;
          const key = `${edge.from}->${edge.to}`;
          const inExecutionPath = edgeCtx.executionPath.selectedEdges.has(key);
          const trans = edgeCtx.transition && edgeCtx.transition.from === edge.from && edgeCtx.transition.to === edge.to && edgeCtx.transition.until > Date.now();
          const blocked = edgeCtx.blockedChain.edgeKeys.has(key);
          const inCycle = edgeCtx.cycleInfo.cycleEdges.has(key);
          const activePath = edgeCtx.activeNeighborhood.has(edge.from) && edgeCtx.activeNeighborhood.has(edge.to);
          const dimByStory = edgeCtx.effectiveViewMode === "story" && !activePath;
          const dimBySearch =
            edgeCtx.hasSearchQuery &&
            edgeCtx.matchedIds.size > 0 &&
            !edgeCtx.matchedIds.has(edge.from) &&
            !edgeCtx.matchedIds.has(edge.to);
          const style = getEdgeStyle(edge, {
            dimmed: dimByStory || dimBySearch,
            pathMode: edgeCtx.effectivePathHighlightMode === "path",
            inExecutionPath,
            trans,
            blocked,
            inCycle,
          });
          return (
            <path
              key={key}
              d={pathForEdge(from, to)}
              fill="none"
              stroke={style.stroke}
              strokeWidth={style.strokeWidth}
              strokeOpacity={style.strokeOpacity}
              strokeDasharray={style.strokeDasharray}
              markerEnd={style.markerEnd}
            />
          );
        })}
      </g>
    </svg>
  );
}

function OverlaysLayer({ cycleInfo, entryNodePos }: any) {
  return (
    <>
      {cycleInfo.hasCycle ? (
        <div className="pointer-events-none absolute right-3 top-3 rounded border border-amber-600/70 bg-amber-950/70 px-2 py-0.5 text-[10px] text-amber-200">
          Non-DAG edge detected
        </div>
      ) : null}
      {entryNodePos ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: entryNodePos.x - 8,
            top: entryNodePos.y - 18,
            zIndex: 30,
          }}
        >
          <span className="rounded-full border border-emerald-500/60 bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
            Start
          </span>
        </div>
      ) : null}
    </>
  );
}

function NodesLayer({ renderedNodes, effectiveById, nodeCtx, actionsCtx }: any) {
  return (
    <>
      {renderedNodes.map((node: any) => {
        const pos = effectiveById[node.id];
        if (!pos) return null;
        const merged = { ...node, ...pos };
        const state = getNodeRenderState(node, nodeCtx);
        return (
          <GraphNode
            key={node.id}
            node={merged}
            selected={state.isSelected}
            current={state.isCurrent}
            dimmed={state.dimmed}
            highlighted={state.highlighted}
            compact={state.compact}
            eventBadge={state.eventBadge}
            prereqBadge={state.prereqBadge}
            blockedHint={state.blockedHint}
            blockedChain={state.inBlockedChain}
            onMouseEnter={() => actionsCtx.setHoveredNodeId(node.id)}
            onMouseLeave={() => actionsCtx.setHoveredNodeId((prev: string) => (prev === node.id ? "" : prev))}
            onClick={(latestNode: any) => {
              const nodeToUse = latestNode || node;
              const clickedId = String(nodeToUse?.id || "");
              const scopeLevel = String(nodeCtx.graphScope?.level || "");
              const aggregateIdInSuite = String(nodeCtx.activeSuiteAggregateId || "");
              const isInlineChildClick =
                scopeLevel === "suite" &&
                Boolean(aggregateIdInSuite) &&
                clickedId.startsWith(`${aggregateIdInSuite}::`);
              if (isInlineChildClick) {
                actionsCtx.onSelectNode(aggregateIdInSuite);
                actionsCtx.onSelectInlineChild?.(clickedId, aggregateIdInSuite);
              } else {
                actionsCtx.onSelectNode(clickedId);
              }
              if (
                scopeLevel !== "suite" &&
                nodeToUse?.aggregateSummary &&
                Array.isArray(nodeToUse?.aggregateChildren)
              ) {
                actionsCtx.onEnterAggregate?.(String(nodeToUse.id || ""));
              }
              actionsCtx.setOpenInspectorNodeId(nodeToUse.id);
              actionsCtx.setInspectorPinned(false);
              const currentUnmet = nodeCtx.unmetDepsByNode[nodeToUse.id] || [];
              if ((nodeToUse.status || "") === "blocked" || currentUnmet.length) {
                actionsCtx.setBlockedFocusNode((prev: string) => (prev === nodeToUse.id ? "" : nodeToUse.id));
              } else {
                actionsCtx.setBlockedFocusNode("");
              }
            }}
            onDoubleClick={(latestNode: any) => {
              const nodeToUse = latestNode || node;
              void nodeToUse;
              actionsCtx.onOpenNodeDetails?.();
            }}
          />
        );
      })}
    </>
  );
}

export function GraphCanvas({
  layout,
  zoom,
  allNodes,
  allEdges,
  aggregateFilterIds,
  renderedEdges,
  executionPath,
  transition,
  blockedChain,
  cycleInfo,
  activeNeighborhood,
  effectiveViewMode,
  hasSearchQuery,
  matchedIds,
  effectivePathHighlightMode,
  entryNodeId,
  entryNodePos,
  renderedNodes,
  selectedNodeId,
  currentNodeId,
  statusDim,
  unmetDepsByNode,
  scopedNodeById,
  childMetaById,
  eventBadgeByNode,
  prereqProof,
  bubbleAggregateId,
  setHoveredNodeId,
  graphScope,
  onSelectNode,
  onSelectInlineChild,
  onEnterAggregate,
  setOpenInspectorNodeId,
  setInspectorPinned,
  setBlockedFocusNode,
  onOpenNodeDetails,
}: GraphCanvasProps) {
  const sourceNodes = Array.isArray(allNodes) && allNodes.length ? allNodes : renderedNodes;
  const sourceEdges = Array.isArray(allEdges) && allEdges.length ? allEdges : renderedEdges;
  const activeSuiteAggregateId = React.useMemo(() => {
    if (String(graphScope?.level || "") !== "suite") return "";
    const isAggregateId = (id: string) =>
      Boolean(id && (sourceNodes || []).some((n: any) => String(n?.id || "") === id && Boolean(n?.aggregateSummary)));
    const activeFilters = Array.isArray(aggregateFilterIds)
      ? aggregateFilterIds.map((id) => String(id || "")).filter(Boolean)
      : [];
    const filterSet = new Set(activeFilters);
    const selected = String(selectedNodeId || "");
    if (activeFilters.length) {
      if (isAggregateId(selected) && filterSet.has(selected)) return selected;
      if (selected.includes("::")) {
        const parent = String(selected.split("::")[0] || "");
        if (isAggregateId(parent) && filterSet.has(parent)) return parent;
      }
    }
    if (isAggregateId(selected)) return selected;
    if (selected.includes("::")) {
      const parent = String(selected.split("::")[0] || "");
      if (isAggregateId(parent)) return parent;
    }
    const current = String(currentNodeId || "");
    if (activeFilters.length && current.includes("::")) {
      const parent = String(current.split("::")[0] || "");
      if (isAggregateId(parent) && filterSet.has(parent)) return parent;
    }
    if (activeFilters.length && isAggregateId(current) && filterSet.has(current)) return current;
    if (current.includes("::")) {
      const parent = String(current.split("::")[0] || "");
      if (isAggregateId(parent)) return parent;
    }
    if (isAggregateId(current)) return current;
    const filteredFirst = activeFilters.find((id) => isAggregateId(String(id || "")));
    return String(filteredFirst || "");
  }, [graphScope?.level, sourceNodes, aggregateFilterIds, selectedNodeId, currentNodeId]);
  const effectiveById = React.useMemo(() => {
    const base = layout?.byId || {};
    if (String(graphScope?.level || "") !== "suite") return base;
    const bubbleIdRaw = String(bubbleAggregateId || "");
    const bubbleId = bubbleIdRaw && bubbleIdRaw === String(activeSuiteAggregateId || "") ? bubbleIdRaw : "";
    const aggregateNodes = (sourceNodes || []).filter((n: any) => Boolean(n?.aggregateSummary) && base[String(n?.id || "")]);
    const remapped = { ...base };
    if (bubbleId && base[bubbleId] && aggregateNodes.length >= 2) {
      const gateNode = aggregateNodes.find((n: any) => isPytestGateAggregate(n)) || null;
      const gateId = String(gateNode?.id || "");
      if (bubbleId !== gateId) {
        const movable = aggregateNodes.filter((n: any) => String(n?.id || "") !== gateId);
        if (movable.length >= 2) {
          const sortedMovable = [...movable].sort((a: any, b: any) => {
            const ay = base[String(a?.id || "")]?.y ?? Number.POSITIVE_INFINITY;
            const by = base[String(b?.id || "")]?.y ?? Number.POSITIVE_INFINITY;
            if (ay !== by) return ay - by;
            return String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""));
          });
          const selectedIndex = sortedMovable.findIndex((n: any) => String(n?.id || "") === bubbleId);
          if (selectedIndex > 0) {
            const targetOrder = [...sortedMovable];
            const [selected] = targetOrder.splice(selectedIndex, 1);
            targetOrder.unshift(selected);
            sortedMovable.forEach((slotNode: any, idx: number) => {
              const assignedNode = targetOrder[idx];
              const slotPos = base[String(slotNode?.id || "")];
              const assignedPos = base[String(assignedNode?.id || "")];
              if (!slotPos || !assignedPos) return;
              remapped[String(assignedNode?.id || "")] = { ...assignedPos, y: slotPos.y };
            });
            const fromPos = base[bubbleId];
            const toPos = remapped[bubbleId];
            const deltaY = Number(toPos?.y || 0) - Number(fromPos?.y || 0);
            if (Math.abs(deltaY) > 0.1) {
              Object.keys(remapped).forEach((nodeId) => {
                if (!String(nodeId).startsWith(`${bubbleId}::`)) return;
                const childPos = base[nodeId];
                if (!childPos) return;
                remapped[nodeId] = { ...childPos, y: childPos.y + deltaY };
              });
            }
          }
        }
      }
    }
    const selectedAggregateId = String(activeSuiteAggregateId || "");
    const selectedAggregateNode = (sourceNodes || []).find((n: any) => String(n?.id || "") === selectedAggregateId) || null;
    if (isPytestGateAggregate(selectedAggregateNode)) return base;
    if (selectedAggregateNode?.aggregateSummary) {
      const childIds = Object.keys(remapped).filter((id) => String(id).startsWith(`${selectedAggregateId}::`) && remapped[id]);
      if (childIds.length > 0 && aggregateNodes.length > 0) {
        const aggRects = aggregateNodes.map((n: any) => nodeRectFromPos(remapped[String(n?.id || "")])).filter(Boolean);
        const childRects = childIds.map((id) => nodeRectFromPos(remapped[id])).filter(Boolean);
        const aggBounds = boundsFromRects(aggRects);
        const childBounds = boundsFromRects(childRects);
        if (aggBounds && childBounds) {
          const minChildLeft = aggBounds.right + 24;
          if (childBounds.left < minChildLeft) {
            const dx = minChildLeft - childBounds.left;
            childIds.forEach((id) => {
              const p = remapped[id];
              if (!p) return;
              remapped[id] = { ...p, x: Number(p.x || 0) + dx };
            });
          }
          const aggregatePos = remapped[selectedAggregateId];
          const startChildId = pickStartChildId({ aggregateId: selectedAggregateId, childIds, edges: sourceEdges || [], posById: remapped });
          const startPos = startChildId ? remapped[startChildId] : null;
          if (aggregatePos && startPos) {
            const aggregateCenterY = Number(aggregatePos.y || 0) + Number(aggregatePos.height || 0) / 2;
            const startCenterY = Number(startPos.y || 0) + Number(startPos.height || 0) / 2;
            const dy = Math.max(-1200, Math.min(1200, aggregateCenterY - startCenterY));
            if (Math.abs(dy) > 0.1) {
              childIds.forEach((id) => {
                const p = remapped[id];
                if (!p) return;
                remapped[id] = { ...p, y: Number(p.y || 0) + dy };
              });
            }
          }
        }
      }
    }
    return remapped;
  }, [layout?.byId, graphScope?.level, bubbleAggregateId, activeSuiteAggregateId, sourceNodes, sourceEdges]);
  const effectiveEntryNodePos = React.useMemo(() => {
    const entryId = String(entryNodeId || "");
    if (entryId && effectiveById?.[entryId]) return effectiveById[entryId];
    return entryNodePos || null;
  }, [entryNodeId, effectiveById, entryNodePos]);

  const edgeCtx = {
    executionPath,
    transition,
    blockedChain,
    cycleInfo,
    activeNeighborhood,
    effectiveViewMode,
    hasSearchQuery,
    matchedIds,
    effectivePathHighlightMode,
  };
  const nodeCtx = {
    selectedNodeId,
    currentNodeId,
    activeNeighborhood,
    executionPath,
    effectiveViewMode,
    effectivePathHighlightMode,
    hasSearchQuery,
    matchedIds,
    statusDim,
    unmetDepsByNode,
    scopedNodeById,
    childMetaById,
    blockedChain,
    zoom,
    eventBadgeByNode,
    prereqProof,
    graphScope,
    activeSuiteAggregateId,
  };
  const actionsCtx = {
    onSelectNode,
    onSelectInlineChild,
    onEnterAggregate,
    setOpenInspectorNodeId,
    setInspectorPinned,
    setBlockedFocusNode,
    setHoveredNodeId,
    onOpenNodeDetails,
  };

  return (
    <div style={{ width: layout.width * zoom, height: layout.height * zoom, position: "relative" }}>
      <EdgesLayer layout={layout} zoom={zoom} renderedEdges={renderedEdges} edgeCtx={edgeCtx} effectiveById={effectiveById} />
      <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", position: "relative", width: layout.width, height: layout.height }}>
        <OverlaysLayer cycleInfo={cycleInfo} entryNodePos={effectiveEntryNodePos} />
        <NodesLayer renderedNodes={renderedNodes} effectiveById={effectiveById} nodeCtx={nodeCtx} actionsCtx={actionsCtx} />
      </div>
    </div>
  );
}
