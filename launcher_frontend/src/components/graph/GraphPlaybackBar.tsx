import React from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";

type PlaybackMode = "timeline" | "path";

type Props = {
  cursor: number;
  entriesLength: number;
  currentNodeLabel: string;
  speed: number;
  isPlaying: boolean;
  playbackMode: PlaybackMode;
  pathStepsLength: number;
  pathExplanation: string;
  bottomTab: "timeline" | "artifacts";
  onPlayback: (patch: Partial<{ isPlaying: boolean; cursor: number; speed: number; mode: PlaybackMode }>) => void;
  onSetBottomTab?: (tab: "timeline" | "artifacts") => void;
};

export default function GraphPlaybackBar({
  cursor,
  entriesLength,
  currentNodeLabel,
  speed,
  isPlaying,
  playbackMode,
  pathStepsLength,
  pathExplanation,
  bottomTab,
  onPlayback,
  onSetBottomTab,
}: Props) {
  const max = Math.max(entriesLength - 1, 0);
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-900/90 px-4 py-2 text-xs shadow-xl ring-1 ring-slate-700/60 backdrop-blur-md">
      <div className="flex items-center gap-1">
        <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors" onClick={() => onPlayback({ cursor: Math.max(0, cursor - 1), isPlaying: false })} title="Step back (J/Left)">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={`flex h-8 w-8 items-center justify-center rounded-full border ${isPlaying ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"} transition-colors`} onClick={() => onPlayback({ isPlaying: !isPlaying })} title="Play/Pause (L/Space)">
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>
        <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors" onClick={() => onPlayback({ cursor: Math.min(max, cursor + 1), isPlaying: false })} title="Step forward (K/Right)">
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input className="w-64 accent-blue-500 cursor-pointer" type="range" min={0} max={max} value={cursor} onChange={(e) => onPlayback({ cursor: Number(e.target.value), isPlaying: false })} />
        <div className="flex min-w-[120px] flex-col justify-center">
          <span className="text-[10px] font-medium text-slate-300">
            {Math.min(cursor + 1, Math.max(entriesLength, 1))} / {Math.max(entriesLength, 1)}
          </span>
          <span className="truncate text-[10px] text-slate-500">
            {currentNodeLabel || "No node selected"}
          </span>
        </div>
      </div>

      <div className="h-5 w-[1px] bg-slate-700" />

      <select className="rounded-md border border-slate-700 bg-slate-950/50 px-1 py-1 text-[11px] text-slate-300 outline-none hover:border-slate-600 focus:border-blue-500 transition-colors" value={speed} onChange={(e) => onPlayback({ speed: Number(e.target.value) || 1 })}>
        <option value={0.5}>0.5x</option>
        <option value={1}>1.0x</option>
        <option value={2}>2.0x</option>
        <option value={4}>4.0x</option>
      </select>

      <div className="inline-flex items-center rounded-full border border-slate-700/60 bg-slate-950/50 p-0.5">
        <button
          type="button"
          className={`rounded-full px-2.5 py-1 text-[10px] transition-colors ${playbackMode === "timeline" ? "bg-blue-600/30 text-blue-300" : "text-slate-400 hover:text-slate-200"}`}
          onClick={() => onPlayback({ mode: "timeline", isPlaying: false })}
        >
          Chrono
        </button>
        <button
          type="button"
          className={`rounded-full px-2.5 py-1 text-[10px] transition-colors ${playbackMode === "path" ? "bg-blue-600/30 text-blue-300" : "text-slate-400 hover:text-slate-200"} disabled:opacity-40 disabled:cursor-not-allowed`}
          onClick={() => onPlayback({ mode: "path", isPlaying: false })}
          disabled={!pathStepsLength}
          title={pathStepsLength ? "Dependency-aware DAG walk" : "No DAG walk steps available"}
        >
          Path
        </button>
      </div>

      <div className="h-5 w-[1px] bg-slate-700" />

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onSetBottomTab?.("timeline")} className={`rounded-full px-3 py-1 text-[10px] transition-colors ${bottomTab === "timeline" ? "bg-blue-600 text-white" : "border border-slate-700 text-slate-300 hover:bg-slate-800"}`}>Timeline</button>
        <button type="button" onClick={() => onSetBottomTab?.("artifacts")} className={`rounded-full px-3 py-1 text-[10px] transition-colors ${bottomTab === "artifacts" ? "bg-blue-600 text-white" : "border border-slate-700 text-slate-300 hover:bg-slate-800"}`}>Artifacts</button>
      </div>
      
      {playbackMode === "path" && pathExplanation ? <span className="absolute -top-6 right-0 max-w-[280px] rounded bg-slate-800/90 px-2 py-1 truncate text-[10px] text-slate-300 ring-1 ring-slate-700">{pathExplanation}</span> : null}
    </div>
  );
}

