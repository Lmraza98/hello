/**
 * Chat persistence — stores messages in localStorage so they survive
 * page navigation (Dashboard → Contacts → Dashboard).
 */
import type { ChatMessage } from '../types/chat';

const STORAGE_KEY = 'hello_chat_messages';
const MAX_MESSAGES = 200; // cap to avoid localStorage bloat

export function saveMessages(messages: ChatMessage[]): void {
  try {
    // Trim to last N messages
    const trimmed = messages.slice(-MAX_MESSAGES);
    const serializable = trimmed.map((m) => ({
      ...m,
      timestamp: (m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp)).toISOString(),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function loadMessages(): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Rehydrate timestamps
    return parsed.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));
  } catch {
    return null;
  }
}

export function clearMessages(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
