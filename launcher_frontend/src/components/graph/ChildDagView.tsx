import React from "react";
import { Z_GRAPH_UI } from "../../lib/zIndex";

export default function ChildDagView({
  source,
  runId,
  attemptId,
}: {
  source: "real" | "derived" | "placeholder";
  runId?: string;
  attemptId?: string | number;
}) {
  const dotClass = source === "real" ? "bg-emerald-400" : source === "derived" ? "bg-amber-400" : "bg-slate-400";
  const text = source === "real" ? "Real DAG" : source === "derived" ? "Derived DAG from timeline" : "Waiting for events";
  return (
    <div className="absolute left-3 top-14 inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-950/82 px-2 py-0.5 text-[10px] text-slate-300" style={{ zIndex: Z_GRAPH_UI }}>
      <span className={`inline-flex h-2 w-2 rounded-full ${dotClass}`} />
      <span>{text}</span>
      <span className="text-slate-500">run {runId || "n/a"}</span>
      <span className="text-slate-500">attempt {String(attemptId ?? "latest")}</span>
    </div>
  );
}
