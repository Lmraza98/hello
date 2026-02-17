export function applyRefinementRules(userMessage: string): string {
  return userMessage.trim();
}

export function extractUserIntentText(rawMessage: string): string {
  const text = rawMessage.trim();
  const startMarker = '[PAGE_CONTEXT]';
  const endMarker = '[/PAGE_CONTEXT]';
  const start = text.indexOf(startMarker);
  if (start < 0) return text;
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return text;

  const before = text.slice(0, start).trim();
  const after = text.slice(end + endMarker.length).trim();
  const merged = [before, after].filter(Boolean).join('\n').trim();
  return merged || before || text;
}

export function extractPageContext(rawMessage: string): string | null {
  const text = rawMessage.trim();
  const startMarker = '[PAGE_CONTEXT]';
  const endMarker = '[/PAGE_CONTEXT]';
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return null;
  const content = text.slice(start + startMarker.length, end).trim();
  return content || null;
}
