import React from "react";
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, MinusCircle } from "lucide-react";
import type { GraphNodeLike } from "./graphTypes";

const statusStyles: Record<string, string> = {
  not_run: "border-slate-700 bg-slate-900 text-slate-300",
  running: "border-sky-500/60 bg-sky-950/40 text-sky-200",
  passed: "border-emerald-500/60 bg-emerald-950/35 text-emerald-200",
  failed: "border-rose-500/60 bg-rose-950/35 text-rose-200",
  skipped: "border-amber-500/60 bg-amber-950/35 text-amber-200",
  blocked: "border-slate-700 bg-slate-900/60 text-slate-500",
};

function statusIcon(status: string) {
  if (status === "running") return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
  if (status === "passed") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5" />;
  if (status === "skipped") return <MinusCircle className="h-3.5 w-3.5" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

type GraphNodeProps = {
  node: GraphNodeLike;
  selected: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onClick: (node: GraphNodeLike) => void;
  onDoubleClick?: (node: GraphNodeLike) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  compact?: boolean;
  current?: boolean;
  eventBadge?: string;
  prereqBadge?: string;
  blockedHint?: string;
  blockedChain?: boolean;
};

function GraphNode({
  node,
  selected,
  dimmed,
  highlighted,
  onClick,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
  compact = false,
  current = false,
  eventBadge = "",
  prereqBadge = "",
  blockedHint = "",
  blockedChain = false,
}: GraphNodeProps) {
  const status = node.status || "not_run";
  const agg = node.aggregateSummary || null;
  const hasAgg = Boolean(agg && agg.total > 0);
  return (
    <button
      type="button"
      onClick={() => onClick(node)}
      onDoubleClick={() => onDoubleClick?.(node)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-graph-node-id={node.id}
      className={`absolute rounded-md border px-2.5 py-1.5 text-left transition-all duration-500 ease-out ${selected || current ? "ring-2 ring-blue-400" : "hover:border-sky-400/40"} ${blockedChain ? "ring-2 ring-rose-400/80" : ""} ${dimmed ? "opacity-20" : "opacity-100"} ${highlighted ? "shadow-[0_0_0_1px_rgba(96,165,250,0.45)]" : ""} ${statusStyles[status] || statusStyles.not_run}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
    >
      <div className={`truncate ${compact ? "text-[12px]" : "text-[13px]"} font-semibold`}>{node.name}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px]">
        {!compact ? <span className="truncate text-slate-400/80">{node.filePath || "n/a"}</span> : <span />}
        <span className="inline-flex items-center gap-1 rounded-full border border-current/40 px-1 py-0.5 uppercase tracking-wide">
          {statusIcon(status)}
          {!compact ? status : ""}
        </span>
      </div>
      {hasAgg ? (
        <div className="mt-1.5 space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800/70">
            <div className="h-full bg-cyan-400" style={{ width: `${Math.max(0, Math.min(100, agg.progressPct || 0))}%` }} />
          </div>
          {agg.running > 0 ? (
            <div className="truncate text-[9px] text-cyan-200">
              {agg.running > 1 ? `Running: ${agg.running}` : `Now running: ${agg.latestRunningChildName || "child"}`}
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-[9px] font-medium">
            {agg.passed > 0 && <span className="flex items-center gap-0.5 text-emerald-400"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>{agg.passed}</span>}
            {agg.failed > 0 && <span className="flex items-center gap-0.5 text-rose-400"><div className="w-1.5 h-1.5 rounded-full bg-rose-500"/>{agg.failed}</span>}
            {agg.running > 0 && <span className="flex items-center gap-0.5 text-sky-400"><div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"/>{agg.running}</span>}
            {agg.not_run > 0 && <span className="flex items-center gap-0.5 text-slate-400"><div className="w-1.5 h-1.5 rounded-full bg-slate-500"/>{agg.not_run}</span>}
            <span className="ml-auto text-slate-500">{agg.total} total</span>
          </div>
        </div>
      ) : null}
      {current ? <span className="pointer-events-none absolute inset-0 animate-pulse rounded-md ring-1 ring-cyan-300/65" /> : null}
      {eventBadge ? (
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[9px] text-slate-200">
          {eventBadge}
        </span>
      ) : null}
      {prereqBadge ? (
        <span className="pointer-events-none absolute -left-1.5 -bottom-1.5 rounded border border-cyan-700/70 bg-cyan-950 px-1 py-0.5 text-[9px] text-cyan-200">
          {prereqBadge}
        </span>
      ) : null}
      {node.outOfOrder ? (
        <span className="pointer-events-none absolute -left-1.5 -top-1.5 rounded border border-amber-700 bg-amber-950 px-1 py-0.5 text-[9px] text-amber-200">
          order
        </span>
      ) : null}
    </button>
  );
}

function areEqual(prev: GraphNodeProps, next: GraphNodeProps) {
  const pn = prev.node || {};
  const nn = next.node || {};
  return (
    pn.id === nn.id &&
    pn.x === nn.x &&
    pn.y === nn.y &&
    pn.width === nn.width &&
    pn.height === nn.height &&
    pn.status === nn.status &&
    pn.name === nn.name &&
    pn.filePath === nn.filePath &&
    prev.selected === next.selected &&
    prev.dimmed === next.dimmed &&
    prev.highlighted === next.highlighted &&
    prev.compact === next.compact &&
    prev.current === next.current &&
    prev.eventBadge === next.eventBadge &&
    prev.prereqBadge === next.prereqBadge &&
    prev.blockedHint === next.blockedHint &&
    prev.blockedChain === next.blockedChain
  );
}

export default React.memo(GraphNode, areEqual);
