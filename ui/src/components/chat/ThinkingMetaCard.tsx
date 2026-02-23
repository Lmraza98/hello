import { ChevronRight, Loader2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ThoughtUIState } from '../../types/chat';
import { UnifiedCard } from './UnifiedCard';

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
    <UnifiedCard
      title={title}
      icon={<Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
      statusLabel={phaseLabel(state.phase)}
      statusClass="bg-slate-100 text-slate-500"
      actions={
        hasBody ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        ) : undefined
      }
    >
      {expanded && hasBody ? (
        <div className="space-y-1.5">
          {summary ? <p className="text-xs text-text-muted">{summary}</p> : null}
          {state.toolActivity.length > 0 ? (
            <div className="space-y-1">
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
    </UnifiedCard>
  );
}
