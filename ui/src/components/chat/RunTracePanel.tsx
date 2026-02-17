import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearRunEvents,
  getRunEvents,
  getLastTokenStream,
  getTokenStream,
  isTokenStreamActive,
  type ChatRunEvent,
} from '../../services/chatRunLog';

function formatEventLine(event: ChatRunEvent): string {
  const t = new Date(event.ts);
  const hh = `${t.getHours()}`.padStart(2, '0');
  const mm = `${t.getMinutes()}`.padStart(2, '0');
  const ss = `${t.getSeconds()}`.padStart(2, '0');
  return `[${hh}:${mm}:${ss}] ${event.phase}: ${event.message}`;
}

export function RunTracePanel({ expanded }: { expanded: boolean }) {
  const [events, setEvents] = useState<ChatRunEvent[]>([]);
  const [liveStream, setLiveStream] = useState('');
  const [lastStream, setLastStream] = useState('');
  const [streamActive, setStreamActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const load = () => {
      setEvents(getRunEvents());
      setLiveStream(getTokenStream());
      setLastStream(getLastTokenStream());
      setStreamActive(isTokenStreamActive());
    };
    load();
    // Poll faster (200ms) when a token stream is active for smoother updates.
    const timer = window.setInterval(load, streamActive ? 200 : 500);
    return () => window.clearInterval(timer);
  }, [expanded, streamActive]);

  // Auto-scroll to bottom when new content arrives.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, liveStream]);

  // Render everything we have. MAX_EVENTS is capped in chatRunLog.ts.
  const visible = useMemo(() => events, [events]);

  if (!expanded) return null;

  return (
    <div className="mb-2 rounded-md border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
        <p className="text-[11px] font-medium text-text">
          Run Trace ({events.length})
          {streamActive && (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={async () => {
              const lines = visible.map((event) => formatEventLine(event));
              if (lastStream) lines.push(`\n[sticky] Model output:\n${lastStream}`);
              const payload = lines.join('\n');
              try {
                await navigator.clipboard.writeText(payload);
              } catch {
                // best-effort only
              }
            }}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              clearRunEvents();
              setEvents([]);
              setLiveStream('');
              setLastStream('');
            }}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover"
          >
            Clear
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="max-h-44 overflow-y-auto px-2.5 py-2">
        {visible.length === 0 && !liveStream && !lastStream ? (
          <p className="text-[11px] text-text-dim">No events yet.</p>
        ) : (
          <div className="space-y-1">
            {visible.map((event, idx) => (
              <p key={`${event.ts}-${idx}`} className="whitespace-pre-wrap break-words font-mono text-[11px] text-text-muted">
                {formatEventLine(event)}
              </p>
            ))}
            {liveStream && (
              <p className="whitespace-pre-wrap wrap-break-word font-mono text-[11px] text-emerald-400">
                {'> '}{liveStream}
                {streamActive && <span className="animate-pulse">|</span>}
              </p>
            )}
            {!liveStream && lastStream && (
              <p className="whitespace-pre-wrap wrap-break-word font-mono text-[11px] text-emerald-400">
                {'> '}{lastStream}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
