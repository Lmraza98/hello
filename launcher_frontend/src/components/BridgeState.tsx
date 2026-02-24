import React from "react";

export default function BridgeState({ bridgeError }) {
  return (
    <div className="flex h-full items-center justify-center bg-slate-950 text-slate-100">
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm">{bridgeError || "Connecting launcher bridge..."}</div>
    </div>
  );
}
