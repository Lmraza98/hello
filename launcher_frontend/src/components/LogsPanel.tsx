import React from "react";

export default function LogsPanel({ logs }) {
  return <textarea value={logs} readOnly className="h-full w-full flex-1 resize-none bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none" />;
}
