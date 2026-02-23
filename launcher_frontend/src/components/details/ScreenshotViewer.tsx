import React from "react";

export default function ScreenshotViewer({
  screenshot,
  title = "Screenshot",
}: {
  screenshot: any;
  title?: string;
}) {
  if (!screenshot?.url) {
    return <div className="rounded-md border border-slate-800/70 bg-slate-950/60 p-2 text-xs text-slate-500">No screenshot attached to this event.</div>;
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-slate-300">{title}</div>
      <div className="relative overflow-hidden rounded-md border border-slate-700 bg-slate-900/70">
        <img src={screenshot.url} alt={title} className="block w-full" />
        {(screenshot.annotations || []).map((ann: any, idx: number) => {
          const left = ann.x <= 1 ? `${ann.x * 100}%` : `${ann.x}%`;
          const top = ann.y <= 1 ? `${ann.y * 100}%` : `${ann.y}%`;
          const width = ann.w <= 1 ? `${ann.w * 100}%` : `${ann.w}%`;
          const height = ann.h <= 1 ? `${ann.h * 100}%` : `${ann.h}%`;
          return (
            <div
              key={`${ann.label || idx}-${idx}`}
              className="pointer-events-none absolute border border-blue-300/85 bg-blue-500/10"
              style={{ left, top, width, height }}
            >
              {ann.label ? <span className="absolute -top-5 left-0 rounded bg-blue-950/90 px-1.5 py-0.5 text-[10px] text-blue-100">{ann.label}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

