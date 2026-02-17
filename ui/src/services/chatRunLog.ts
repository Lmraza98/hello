export type ChatRunEvent = {
  ts: string;
  lane: 'primary' | 'background';
  phase:
    | 'input'
    | 'planner_event'
    | 'tool_call'
    | 'tool_result'
    | 'confirmation'
    | 'error'
    | 'info';
  message: string;
  meta?: Record<string, unknown>;
};

const RUN_LOG_KEY = 'chat_run_log_v1';
const MAX_EVENTS = 1000;

function readEvents(): ChatRunEvent[] {
  try {
    const raw = localStorage.getItem(RUN_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatRunEvent[]) : [];
  } catch {
    return [];
  }
}

function writeEvents(events: ChatRunEvent[]): void {
  try {
    localStorage.setItem(RUN_LOG_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // best-effort only
  }
}

export function appendRunEvent(event: Omit<ChatRunEvent, 'ts'>): void {
  const events = readEvents();
  events.push({
    ts: new Date().toISOString(),
    ...event,
  });
  writeEvents(events);
}

export function getRunEvents(): ChatRunEvent[] {
  return readEvents();
}

export function clearRunEvents(): void {
  try {
    localStorage.removeItem(RUN_LOG_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// In-memory token stream - avoids localStorage churn for per-token updates.
// RunTracePanel reads this on its poll interval.
// ---------------------------------------------------------------------------
let _activeTokenStream = '';
let _lastTokenStream = '';
let _tokenStreamActive = false;

/** Append a token chunk to the in-memory stream buffer. */
export function appendTokenStreamChunk(chunk: string): void {
  _activeTokenStream += chunk;
  _tokenStreamActive = true;
}

/** Read the current accumulated token stream. */
export function getTokenStream(): string {
  return _activeTokenStream;
}

/** Read the most recently finalized token stream (sticky). */
export function getLastTokenStream(): string {
  return _lastTokenStream;
}

/** Whether a token stream is currently active. */
export function isTokenStreamActive(): boolean {
  return _tokenStreamActive;
}

/** Finalize the token stream - flush to a run event and keep a sticky copy. */
export function finalizeTokenStream(): void {
  if (_activeTokenStream) {
    appendRunEvent({
      lane: 'primary',
      phase: 'planner_event',
      message: `Model output: ${_activeTokenStream}`,
    });
  }
  _lastTokenStream = _activeTokenStream;
  _activeTokenStream = '';
  _tokenStreamActive = false;
}

/** Reset the token stream without flushing. */
export function resetTokenStream(): void {
  _activeTokenStream = '';
  _lastTokenStream = '';
  _tokenStreamActive = false;
}