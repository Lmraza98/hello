import { ChevronRight, Loader2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ThoughtUIState } from '../../types/chat';

function phaseLabel(phase: ThoughtUIState['phase']): string {
  if (phase === 'planning') return 'Planning';
  if (phase === 'tool_running') return 'Running tools';
  if (phase === 'synthesizing') return 'Synthesizing';
  return 'Thinking';
}

export function ThinkingMetaCard({ state }: { state: ThoughtUIState }) {
  const [expanded, setExpanded] = useState(false);
  const stepLines = useMemo(() => state.steps.slice(-5), [state.steps]);
  if (!state.visible || state.phase === 'idle' || state.phase === 'complete' || state.display_mode !== 'panel') return null;

  const title = state.title || 'Working on your request';
  const summary = state.summary || 'Processing request';
  const hasBody = Boolean(summary || stepLines.length > 0 || state.toolActivity.length > 0);

  return (
    <div className="mx-1 my-2 rounded-[10px] border border-slate-200 bg-slate-100/80 px-3 py-2 text-slate-700">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
          <span className="truncate text-[13px] font-medium">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
          <span>{phaseLabel(state.phase)}</span>
          {hasBody ? (
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          ) : null}
        </div>
      </button>
      {expanded && hasBody ? (
        <div className="mt-2 border-t border-slate-200 pt-2 text-[12px] text-slate-600">
          {summary ? <p className="mb-1.5 leading-relaxed">{summary}</p> : null}
          {state.toolActivity.length > 0 ? (
            <div className="mb-1.5 space-y-1">
              {state.toolActivity.slice(-3).map((tool) => (
                <p key={`${tool.name}-${tool.status}`} className="flex items-center gap-1.5">
                  <Wrench className="h-3 w-3 text-slate-500" />
                  <span className="capitalize">{tool.name}</span>
                  <span className="text-[11px] text-slate-500">({tool.status})</span>
                </p>
              ))}
            </div>
          ) : null}
          {stepLines.length > 0 ? (
            <div className="space-y-1">
              {stepLines.map((line, idx) => (
                <p key={`${line}-${idx}`} className="truncate text-[11px] text-slate-500">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
