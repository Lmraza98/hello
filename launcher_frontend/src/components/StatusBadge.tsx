import React from "react";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

export default function StatusBadge({ status, showIdleText = false }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        RUNNING
      </span>
    );
  }
  if (status === "passed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        PASSED
      </span>
    );
  }
  if (status === "failed" || status === "timed_out") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-950/40 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
        <XCircle className="h-3 w-3" />
        FAILED
      </span>
    );
  }
  if (status === "queued" || status === "retrying") {
    return <span className="rounded-full border border-violet-500/40 bg-violet-950/40 px-2 py-0.5 text-[10px] font-semibold text-violet-300">QUEUED</span>;
  }
  if (status === "canceled") {
    return <span className="rounded-full border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300">CANCELED</span>;
  }
  if (!showIdleText) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500/70" title="idle" />;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/30 bg-slate-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
      <Circle className="h-2.5 w-2.5 fill-slate-500 text-slate-500" />
      <span>IDLE</span>
    </span>
  );
}
