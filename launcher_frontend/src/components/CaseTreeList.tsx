import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { flattenTree } from "../lib/caseTree";

const ROW_HEIGHT = 32;
const OVERSCAN = 8;

const TreeRow = memo(function TreeRow({
  row,
  isSelected,
  onToggle,
  onSelectCase,
  onRunCase,
  setDrawerOpen,
  expanded,
}) {
  const { node, depth } = row;
  const indent = Math.max(0, depth) * 14;
  if (node.type === "test") {
    const status = node.status || "idle";
    const durationVal = typeof node.row?.duration === "number" ? `${node.row.duration.toFixed(2)}s` : (typeof node.row?.parentDuration === "number" ? `${node.row.parentDuration.toFixed(2)}s` : "n/a");
    return (
      <div
        className={`group flex h-10 items-center justify-between gap-2 rounded-md px-2 text-xs ${isSelected ? "border-l-4 border-blue-400 bg-blue-900/35" : "hover:bg-slate-900/60"}`}
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        <button
          type="button"
          onClick={() => {
            onSelectCase(node.caseId);
            setDrawerOpen(true);
          }}
          className="min-w-0 flex-1 text-left"
        >
          <div className={`truncate ${isSelected ? "font-semibold text-slate-100" : "text-slate-200"}`}>{node.label}</div>
          <div className="truncate text-[11px] text-slate-400">{node.row?.file_path || node.row?.nodeid || node.caseId}</div>
        </button>
        <div className="flex w-[96px] items-center justify-end gap-2">
          <button type="button" onClick={() => onRunCase(node.row?.id || node.caseId)} className="opacity-0 transition-opacity group-hover:opacity-100" title="Run case test">
            <Play className="h-3.5 w-3.5 text-blue-300" />
          </button>
          <StatusBadge status={status} showIdleText={isSelected || status !== "idle"} />
          <span className="w-[44px] text-right text-[10px] text-slate-400">{durationVal}</span>
        </div>
      </div>
    );
  }

  const isOpen = expanded.has(node.id);
  const showChevron = (node.children || []).length > 0;
  return (
    <button
      type="button"
      onClick={() => onToggle(node.id)}
      className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs hover:bg-slate-900/60"
      style={{ paddingLeft: `${8 + indent}px` }}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-slate-200">
        {showChevron ? (isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />) : <span className="w-3.5" />}
        <span className="truncate">{node.label}</span>
      </span>
      <span className="ml-2 shrink-0 text-[11px] text-slate-400">{node.failed}/{node.total}</span>
    </button>
  );
});

export default function CaseTreeList({
  root,
  expanded,
  setExpanded,
  selectedCaseId,
  onSelectCase,
  onRunCase,
  setDrawerOpen,
}) {
  const scrollerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(320);

  const rows = useMemo(() => flattenTree(root, expanded), [root, expanded]);
  const total = rows.length;
  const virtual = total > 200;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const end = virtual ? Math.min(total, start + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2) : total;
  const visibleRows = rows.slice(start, end);
  const topPad = virtual ? start * ROW_HEIGHT : 0;
  const bottomPad = virtual ? Math.max(0, (total - end) * ROW_HEIGHT) : 0;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setHeight(rect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onKeyDown(event) {
    if (!rows.length) return;
    const currentIndex = rows.findIndex((r) => r.node.type === "test" && r.node.caseId === selectedCaseId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const idx = Math.min(rows.length - 1, Math.max(0, currentIndex + 1));
      const target = rows[idx];
      if (target?.node?.type === "test") onSelectCase(target.node.caseId);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const idx = Math.max(0, currentIndex > 0 ? currentIndex - 1 : 0);
      const target = rows[idx];
      if (target?.node?.type === "test") onSelectCase(target.node.caseId);
    }
    if (event.key === "ArrowRight") {
      const cur = rows[currentIndex];
      if (cur?.node?.type !== "test") toggle(cur.node.id);
    }
    if (event.key === "ArrowLeft") {
      const cur = rows[currentIndex];
      if (cur?.node?.type !== "test") toggle(cur.node.id);
    }
  }

  return (
    <div
      ref={scrollerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 scroll-smooth focus:outline-none"
    >
      {topPad ? <div style={{ height: topPad }} /> : null}
      {visibleRows.map((row) => (
        <TreeRow
          key={row.node.id}
          row={row}
          isSelected={row.node.type === "test" && row.node.caseId === selectedCaseId}
          onToggle={toggle}
          onSelectCase={onSelectCase}
          onRunCase={onRunCase}
          setDrawerOpen={setDrawerOpen}
          expanded={expanded}
        />
      ))}
      {bottomPad ? <div style={{ height: bottomPad }} /> : null}
    </div>
  );
}
