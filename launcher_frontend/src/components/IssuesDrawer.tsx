import React from "react";
import { Z_PANE } from "../lib/zIndex";

export default function IssuesDrawer({ startup, onClose }) {
  return (
    <aside className="fixed inset-y-0 right-0 w-[360px] border-l border-slate-800 bg-slate-950 shadow-2xl" style={{ zIndex: Z_PANE }}>
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div className="text-sm font-semibold">Startup Issues</div>
        <button type="button" onClick={onClose} className="rounded border border-slate-700 px-2 py-1 text-xs">Close</button>
      </div>
      <div className="space-y-2 p-3">
        {startup?.issues?.map((issue) => (
          <div key={issue.code} className="rounded border border-slate-700 bg-slate-900 p-2 text-xs">
            <div className="font-semibold text-rose-300">{issue.code}</div>
            <div className="mt-1 text-slate-400">{issue.message}</div>
            <div className="mt-1">Fix: {issue.remediation}</div>
          </div>
        ))}
        {!startup?.issues?.length ? <div className="text-xs text-slate-400">No startup issues.</div> : null}
      </div>
    </aside>
  );
}
