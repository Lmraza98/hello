import React, { useRef, useEffect } from "react";
import GraphNode from "./GraphNode";
import { pathForEdge } from "./graphUtils";

export function GraphCanvas({
  layout,
  zoom,
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
  setHoveredNodeId,
  graphScope,
  onSelectNode,
  onEnterAggregate,
  setOpenInspectorNodeId,
  setInspectorPinned,
  setBlockedFocusNode,
  onOpenNodeDetails,
}: any) {
  const latestPropsRef = useRef({ graphScope, unmetDepsByNode });
  useEffect(() => {
    latestPropsRef.current = { graphScope, unmetDepsByNode };
  }, [graphScope, unmetDepsByNode]);

  return (
    <div style={{ width: layout.width * zoom, height: layout.height * zoom, position: "relative" }}>
      <svg width={layout.width * zoom} height={layout.height * zoom} className="absolute left-0 top-0">
        <defs>
          <marker id="graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="context-stroke" />
          </marker>
        </defs>
        <g transform={`scale(${zoom})`}>
          {renderedEdges.map((edge: any) => {
            const from = layout.byId[edge.from];
            const to = layout.byId[edge.to];
            if (!from || !to) return null;
            const key = `${edge.from}->${edge.to}`;
            const inExecutionPath = executionPath.selectedEdges.has(key);
            const trans = transition && transition.from === edge.from && transition.to === edge.to && transition.until > Date.now();
            const blocked = blockedChain.edgeKeys.has(key);
            const inCycle = cycleInfo.cycleEdges.has(key);
            const activePath = activeNeighborhood.has(edge.from) && activeNeighborhood.has(edge.to);
            const dimByStory = effectiveViewMode === "story" && !activePath;
            const dimBySearch =
              hasSearchQuery &&
              matchedIds.size > 0 &&
              !matchedIds.has(edge.from) &&
              !matchedIds.has(edge.to);
            const dimmed = dimByStory || dimBySearch;
            const pathMode = effectivePathHighlightMode === "path";
            const semanticEdge = edge?.semantic !== false;
            let stroke = "#475569";
            let strokeWidth = 1.1;
            let strokeOpacity = dimmed ? 0.14 : 0.56;
            let strokeDasharray: string | undefined;
            if (trans) {
              stroke = "#60a5fa";
              strokeWidth = 2.8;
              strokeOpacity = dimmed ? 0.5 : 0.95;
            } else if (blocked) {
              stroke = "#ef4444";
              strokeWidth = 2.0;
              strokeOpacity = dimmed ? 0.4 : 0.88;
            } else if (pathMode && inExecutionPath) {
              stroke = "#38bdf8";
              strokeWidth = 2.1;
              strokeOpacity = 0.95;
            } else if (inCycle) {
              stroke = "#f59e0b";
              strokeWidth = 2.0;
              strokeOpacity = dimmed ? 0.25 : 0.92;
              strokeDasharray = "5 4";
            } else if (!semanticEdge || edge.synthetic) {
              stroke = "#334155";
              strokeWidth = 0.9;
              strokeOpacity = pathMode ? 0.14 : dimmed ? 0.1 : 0.2;
              strokeDasharray = "4 4";
            } else if (pathMode) {
              stroke = "#475569";
              strokeWidth = 1.0;
              strokeOpacity = 0.16;
            }
            return (
              <path
                key={key}
                d={pathForEdge(from, to)}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                strokeDasharray={strokeDasharray}
                markerEnd={semanticEdge ? "url(#graph-arrow)" : undefined}
              />
            );
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 rounded border border-slate-700/80 bg-slate-950/90 px-2 py-1 text-[10px] text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[px] w-5 bg-slate-300" />
          Dependency
        </span>
        <span className="mx-2 text-slate-600">|</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[px] w-5 border-t border-dashed border-slate-500" />
          Grouping
        </span>
      </div>
      {cycleInfo.hasCycle ? (
        <div className="pointer-events-none absolute right-3 top-3 rounded border border-amber-600/70 bg-amber-950/70 px-2 py-0.5 text-[10px] text-amber-200">
          Non-DAG edge detected
        </div>
      ) : null}
      {entryNodePos ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: (entryNodePos.x - 8) * zoom,
            top: (entryNodePos.y - 18) * zoom,
          }}
        >
          <span className="rounded-full border border-emerald-500/60 bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
            Start
          </span>
        </div>
      ) : null}
      <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", position: "relative", width: layout.width, height: layout.height }}>
        {renderedNodes.map((node: any) => {
          const pos = layout.byId[node.id];
          if (!pos) return null;
          const merged = { ...node, ...pos };
          const isSelected = node.id === selectedNodeId;
          const isCurrent = node.id === currentNodeId;
          const activePath = activeNeighborhood.has(node.id);
          const inExecutionPath = executionPath.selectedNodes.has(node.id);
          const dimByStory = effectiveViewMode === "story" && !activePath && !isCurrent;
          const dimByExecutionPath = effectivePathHighlightMode === "path" && executionPath.selectedNodes.size > 0 && !inExecutionPath;
          const dimBySearch = hasSearchQuery && matchedIds.size > 0 && !matchedIds.has(node.id);
          const dimByStatus = statusDim[node.status || "not_run"];
          const dimmed = dimByExecutionPath || dimByStory || dimBySearch || dimByStatus;
          const unmet = unmetDepsByNode[node.id] || [];
          const blockedHint = unmet.length ? `Blocked by: ${unmet.slice(0, 3).map((id: string) => scopedNodeById.get(id)?.name || childMetaById.get(id)?.name || id).join(", ")}` : "";
          const inBlockedChain = blockedChain.nodeIds.has(node.id);
          return (
            <GraphNode
              key={node.id}
              node={merged}
              selected={isSelected}
              current={isCurrent}
              dimmed={dimmed}
              highlighted={(effectivePathHighlightMode === "path" ? inExecutionPath : activePath) || isSelected}
              compact={zoom < 0.9}
              eventBadge={eventBadgeByNode[node.id] || ""}
              prereqBadge={node.id === currentNodeId && prereqProof.total > 0 ? `deps ${prereqProof.proven}/${prereqProof.total}` : ""}
              blockedHint={blockedHint}
              blockedChain={inBlockedChain}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId((prev: string) => (prev === node.id ? "" : prev))}
              onClick={(latestNode: any) => {
                const currentProps = latestPropsRef.current;
                const nodeToUse = latestNode || node;
                onSelectNode(nodeToUse.id);
                setOpenInspectorNodeId(nodeToUse.id);
                setInspectorPinned(false);
                const currentUnmet = currentProps.unmetDepsByNode[nodeToUse.id] || [];
                if ((nodeToUse.status || "") === "blocked" || currentUnmet.length) {
                  setBlockedFocusNode((prev: string) => (prev === nodeToUse.id ? "" : nodeToUse.id));
                } else {
                  setBlockedFocusNode("");
                }
              }}
              onDoubleClick={(latestNode: any) => {
                const nodeToUse = latestNode || node;
                onOpenNodeDetails?.();
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
