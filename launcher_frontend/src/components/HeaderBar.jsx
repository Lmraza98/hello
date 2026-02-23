import React from "react";
import { AlertTriangle } from "lucide-react";
import { Z_APP_TOPBAR } from "../lib/zIndex";

export default function HeaderBar({ startup, onOpenIssues }) {
  const issueCount = startup?.issues?.length ?? 0;
  const blocking = Boolean(issueCount && startup?.ready === false);

  return (
    <div
      className="sticky top-0 border-b border-slate-800 bg-slate-950/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-slate-950/85"
      style={{ zIndex: Z_APP_TOPBAR }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-base font-semibold">LeadPilot Launcher</div>
        <button
          type="button"
          onClick={onOpenIssues}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
            blocking
              ? "border-rose-500/60 bg-rose-950/30 text-rose-300"
              : issueCount
              ? "border-amber-500/50 bg-amber-950/20 text-amber-300"
              : "border-slate-700 text-slate-300"
          }`}
          title="Open startup issues"
        >
          <AlertTriangle className="h-3 w-3" />
          startup issues: {issueCount}
        </button>
      </div>
    </div>
  );
}
