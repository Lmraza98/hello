import type { LocalChatMessage } from './models/ollamaClient';

export const CHAT_PLANNER_MAX_USER_TURNS = Number.parseInt(process.env.NEXT_PUBLIC_CHAT_MAX_USER_TURNS || '4', 10);
export const DEBUG_RESULT_CHAR_CAP = Number.parseInt(process.env.NEXT_PUBLIC_CHAT_DEBUG_RESULT_CHAR_CAP || '1200', 10);

function safeDebugSerialize(value: unknown, maxChars: number): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 16))}â€¦(truncated)â€¦`;
  } catch {
    const text = String(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 16))}â€¦(truncated)â€¦`;
  }
}

export function sanitizeDebugResult(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return safeDebugSerialize(value, DEBUG_RESULT_CHAR_CAP);
  if (Array.isArray(value)) {
    const capped = value.slice(0, 20);
    return capped.map((item) => sanitizeDebugResult(item));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (count >= 20) {
        out.__truncated_keys__ = true;
        break;
      }
      if (k === 'details' || k === 'raw' || k === 'html' || k === 'content') {
        out[k] = safeDebugSerialize(v, Math.min(700, DEBUG_RESULT_CHAR_CAP));
      } else {
        out[k] = sanitizeDebugResult(v);
      }
      count += 1;
    }
    return out;
  }
  return value;
}

export function compactPlannerHistoryByTurns(
  history: LocalChatMessage[],
  limitRaw: number
): LocalChatMessage[] {
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 4;
  if (limit <= 0 || history.length === 0) return history;

  let userTurns = 0;
  let startIdx = history.length;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') {
      userTurns += 1;
      startIdx = i;
      if (userTurns >= limit) break;
    }
  }
  const sliced = history.slice(startIdx);
  const withoutTool = sliced.filter((m) => m.role !== 'tool');
  return withoutTool.length > 0 ? withoutTool : sliced;
}

