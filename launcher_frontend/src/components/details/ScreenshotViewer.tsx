import React, { useMemo, useState } from "react";
import { Expand, X } from "lucide-react";

export default function ScreenshotViewer({
  screenshot,
  title = "Screenshot",
}: {
  screenshot: any;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const src = useMemo(() => String(screenshot?.url || "").trim(), [screenshot?.url]);

  if (!src) {
    return <div className="rounded-md border border-slate-800/70 bg-slate-950/60 p-2 text-xs text-slate-500">No screenshot attached to this event.</div>;
  }

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-300">{title}</div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-800"
            title="Expand screenshot"
          >
            <Expand className="h-3 w-3" />
            Expand
          </button>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative block w-full overflow-hidden rounded-md border border-slate-700 bg-slate-900/70 text-left"
          title="Open screenshot"
        >
          <img src={src} alt={title} className="block w-full" />
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
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 p-4">
          <button type="button" className="absolute inset-0" onClick={() => setOpen(false)} aria-label="Close screenshot preview" />
          <div className="relative z-[3001] max-h-[92vh] max-w-[96vw] overflow-auto rounded border border-slate-700 bg-slate-950 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="truncate text-xs text-slate-200">{title}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-800"
              >
                <X className="h-3 w-3" />
                Close
              </button>
            </div>
            <div className="relative">
              <img src={src} alt={title} className="block max-h-[82vh] max-w-[94vw] object-contain" />
              {(screenshot.annotations || []).map((ann: any, idx: number) => {
                const left = ann.x <= 1 ? `${ann.x * 100}%` : `${ann.x}%`;
                const top = ann.y <= 1 ? `${ann.y * 100}%` : `${ann.y}%`;
                const width = ann.w <= 1 ? `${ann.w * 100}%` : `${ann.w}%`;
                const height = ann.h <= 1 ? `${ann.h * 100}%` : `${ann.h}%`;
                return (
                  <div
                    key={`modal-${ann.label || idx}-${idx}`}
                    className="pointer-events-none absolute border border-blue-300/85 bg-blue-500/10"
                    style={{ left, top, width, height }}
                  >
                    {ann.label ? <span className="absolute -top-5 left-0 rounded bg-blue-950/90 px-1.5 py-0.5 text-[10px] text-blue-100">{ann.label}</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
