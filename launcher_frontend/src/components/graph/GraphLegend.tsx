import React from "react";

const items = [
  { id: "not_run", label: "Not run", tone: "bg-slate-700" },
  { id: "running", label: "Running", tone: "bg-sky-400" },
  { id: "passed", label: "Passed", tone: "bg-emerald-400" },
  { id: "failed", label: "Failed", tone: "bg-rose-400" },
  { id: "skipped", label: "Skipped", tone: "bg-amber-400" },
  { id: "blocked", label: "Blocked", tone: "bg-slate-500" },
];

export default function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
      {items.map((item) => (
        <div key={item.id} className="inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2 py-0.5">
          <span className={`h-2 w-2 rounded-full ${item.tone}`} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

