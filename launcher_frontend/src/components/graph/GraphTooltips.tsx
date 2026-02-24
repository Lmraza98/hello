import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import { Z_GRAPH_TOOLTIPS, TOPBAR_HEIGHT } from "../../lib/zIndex";
import type { GraphNodeLike } from "./graphTypes";

type NodePos = { x: number; y: number; width: number; height: number };

type GraphTooltipsProps = {
  hoveredNode: GraphNodeLike | null;
  hoveredNodePos: NodePos | null;
  zoom: number;
  overlayTick: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  inspectorNode: GraphNodeLike | null;
  inspectorNodePos: NodePos | null;
  inspectorRef: React.RefObject<HTMLDivElement | null>;
  inspectorPinned: boolean;
  setInspectorPinned: (value: boolean | ((prev: boolean) => boolean)) => void;
  setOpenInspectorNodeId: (value: string) => void;
};

export function GraphTooltips({
  hoveredNode,
  hoveredNodePos,
  zoom,
  overlayTick,
  scrollRef,
  inspectorNode,
  inspectorNodePos,
  inspectorRef,
  inspectorPinned,
  setInspectorPinned,
  setOpenInspectorNodeId,
}: GraphTooltipsProps) {
  return null;

  function computePopupPosition(pos: NodePos, width = 260, height = 110) {
    const container = scrollRef?.current;
    if (!container || !pos) return null;
    const rect = container.getBoundingClientRect();
    let left = rect.left + pos.x * zoom - container.scrollLeft + pos.width * zoom + 10;
    let top = rect.top + pos.y * zoom - container.scrollTop + 4;
    if (left + width > window.innerWidth - 8) left = Math.max(8, left - width - pos.width * zoom - 20);
    if (top + height > window.innerHeight - 8) top = Math.max(TOPBAR_HEIGHT + 8, window.innerHeight - height - 8);
    if (top < TOPBAR_HEIGHT + 8) top = TOPBAR_HEIGHT + 8;
    return { left, top };
  }

  const hoverTooltip = useMemo(() => {
    if (!hoveredNode || !hoveredNodePos || typeof document === "undefined") return null;
    const coords = computePopupPosition(hoveredNodePos, 248, 84);
    if (!coords) return null;
    return createPortal(
      <div className="pointer-events-none fixed w-[248px] rounded-md border border-slate-700 bg-slate-950/95 p-2 text-xs text-slate-200 shadow-2xl" style={{ left: coords.left, top: coords.top, zIndex: Z_GRAPH_TOOLTIPS }}>
        <div className="truncate font-semibold">{hoveredNode.name}</div>
        <div className="mt-0.5 truncate text-[11px] text-slate-400">{hoveredNode.filePath || hoveredNode.id}</div>
        <div className="mt-1 flex items-center justify-between">
          <span className="rounded border border-slate-700 px-1.5 py-0.5 uppercase">{hoveredNode.status}</span>
          <span>{hoveredNode.durationMs ? `${(hoveredNode.durationMs / 1000).toFixed(2)}s` : "n/a"}</span>
        </div>
      </div>,
      document.body
    );
  }, [hoveredNode, hoveredNodePos, zoom, overlayTick, scrollRef]);

  const inspectorPopup = useMemo(() => {
    if (!inspectorNode || !inspectorNodePos || typeof document === "undefined") return null;
    const coords = computePopupPosition(inspectorNodePos, 320, 154);
    if (!coords) return null;
    return createPortal(
      <div
        ref={inspectorRef}
        className="fixed w-[320px] rounded-md border border-slate-700 bg-slate-950/98 p-2 text-xs text-slate-200 shadow-2xl"
        style={{ left: coords.left, top: coords.top, zIndex: Z_GRAPH_TOOLTIPS }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="truncate font-semibold">{inspectorNode.name}</div>
          <div className="flex items-center gap-1">
            <button type="button" className={`rounded border px-1.5 py-0.5 text-[10px] ${inspectorPinned ? "border-blue-500 text-blue-200" : "border-slate-700 text-slate-300"}`} onClick={() => setInspectorPinned((v: boolean) => !v)}>
              {inspectorPinned ? "Pinned" : "Pin"}
            </button>
            <button type="button" className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300" onClick={() => setOpenInspectorNodeId("")}>
              X
            </button>
          </div>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-slate-400">{inspectorNode.filePath || inspectorNode.id}</div>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <div className="rounded border border-slate-800 bg-slate-900/50 px-2 py-1">
            <div className="text-[10px] text-slate-400">Status</div>
            <div className="text-[11px] uppercase text-slate-100">{inspectorNode.status}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/50 px-2 py-1">
            <div className="text-[10px] text-slate-400">Duration</div>
            <div className="text-[11px] text-slate-100">{inspectorNode.durationMs ? `${(inspectorNode.durationMs / 1000).toFixed(2)}s` : "n/a"}</div>
          </div>
        </div>
        <div className="mt-1 text-[10px] text-slate-500">Esc closes. Outside click closes when unpinned.</div>
      </div>,
      document.body
    );
  }, [inspectorNode, inspectorNodePos, inspectorPinned, zoom, overlayTick, scrollRef]);

  return (
    <>
      {hoverTooltip}
      {inspectorPopup}
    </>
  );
}
