import type { ThoughtUIState } from '../../types/chat';

export function ThinkingMicroBubble({ state }: { state: ThoughtUIState }) {
  if (!state.visible || state.phase === 'idle' || state.phase === 'complete' || state.display_mode !== 'micro') return null;
  const label = state.summary || state.title || 'Thinking';
  const plainPlanning = /planning the best sequence of actions/i.test(label);
  return (
    <div className="flex justify-start">
      <div className={plainPlanning ? 'max-w-[90%] px-1 py-1 opacity-85 transition-opacity duration-200' : 'max-w-[90%] rounded-xl border border-border bg-surface px-2.5 py-1.5 opacity-85 transition-opacity duration-200'}>
        <p className="text-[12px] text-text-muted">
          {label}
          <span className="ui-stream-cursor" />
        </p>
      </div>
    </div>
  );
}
