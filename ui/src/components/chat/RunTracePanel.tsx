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

function formatTime(ts: string): string {
  const t = new Date(ts);
  const hh = `${t.getHours()}`.padStart(2, '0');
  const mm = `${t.getMinutes()}`.padStart(2, '0');
  const ss = `${t.getSeconds()}`.padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function RunTracePanel({ expanded, inDrawer = false }: { expanded: boolean; inDrawer?: boolean }) {
  const [events, setEvents] = useState<ChatRunEvent[]>([]);
  const [liveStream, setLiveStream] = useState('');
  const [lastStream, setLastStream] = useState('');
  const [streamActive, setStreamActive] = useState(false);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const firstOpenRef = useRef(true);

  useEffect(() => {
    if (!expanded) return;
    firstOpenRef.current = true;
    autoFollowRef.current = true;
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const load = () => {
      setEvents(getRunEvents());
      setLiveStream(getTokenStream());
      setLastStream(getLastTokenStream());
      setStreamActive(isTokenStreamActive());
    };
    load();
    const timer = window.setInterval(load, 250);
    return () => window.clearInterval(timer);
  }, [expanded]);

  // Auto-follow only when the user is near bottom (or on first open).
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (firstOpenRef.current || autoFollowRef.current) {
      node.scrollTop = node.scrollHeight;
      firstOpenRef.current = false;
    }
  }, [events, liveStream]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((event) => formatEventLine(event).toLowerCase().includes(q));
  }, [events, query]);

  const latestReasoningSummary = useMemo(() => {
    const reasoning = [...events].reverse().find((event) => event.phase === 'reasoning');
    if (!reasoning?.meta) return [] as string[];
    const summary = reasoning.meta.summary;
    if (!Array.isArray(summary)) return [] as string[];
    return summary.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
  }, [events]);

  if (!expanded) return null;

  return (
    <div className={`${inDrawer ? '' : 'mb-2'} rounded-md border border-border bg-bg`}>
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
      <div className="border-b border-border px-2.5 py-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter trace..."
          className="h-7 w-full rounded border border-border bg-surface px-2 text-xs text-text outline-none focus:border-accent"
        />
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const node = e.currentTarget;
          const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
          autoFollowRef.current = distance <= 24;
        }}
        className={`${inDrawer ? 'max-h-[calc(100vh-12rem)]' : 'max-h-44'} overflow-y-auto px-2.5 py-2`}
      >
        {visible.length === 0 && !liveStream && !lastStream ? (
          <p className="text-[11px] text-text-dim">No events yet.</p>
        ) : inDrawer ? (
          <div className="space-y-2">
            {latestReasoningSummary.length > 0 && (
              <section className="rounded border border-border bg-bg p-2">
                <p className="mb-1 text-[11px] font-semibold text-text">LLM Reasoning</p>
                <div className="space-y-1">
                  {latestReasoningSummary.map((line, idx) => (
                    <p key={`reasoning-${idx}`} className="whitespace-pre-wrap break-words text-[11px] text-text-muted">
                      {line}
                    </p>
                  ))}
                </div>
              </section>
            )}
            {visible.map((event, idx) => (
              <details key={`${event.ts}-${idx}`} className="rounded border border-border/80 bg-surface open:bg-bg">
                <summary className="cursor-pointer list-none px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-text">{event.message}</p>
                      <p className="text-[10px] uppercase tracking-wide text-text-dim">{event.phase}</p>
                    </div>
                    <span className="text-[10px] text-text-dim">{formatTime(event.ts)}</span>
                  </div>
                </summary>
                <div className="space-y-2 border-t border-border px-2 py-2">
                  <pre className="overflow-x-auto rounded border border-border bg-slate-950 p-2 font-mono text-[11px] text-slate-100">
                    {formatEventLine(event)}
                  </pre>
                  {event.meta ? (
                    <pre className="overflow-x-auto rounded border border-border bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
                      {JSON.stringify(event.meta, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </details>
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
