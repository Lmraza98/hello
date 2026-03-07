/**
 * Chat persistence stores messages in browser storage so they survive
 * page navigation (Dashboard -> Contacts -> Dashboard).
 */
import type { ChatMessage } from '../types/chat';

const STORAGE_KEY = 'hello_chat_messages';
const SESSIONS_KEY = 'hello_chat_sessions';
const ACTIVE_SESSION_KEY = 'hello_chat_active_session';
const MAX_MESSAGES = 80;
const memoryMessages = new Map<string, ChatMessage[]>();
let memorySessionTabs: PersistedChatSessionTab[] | null = null;
let memoryActiveSessionId: string | null = null;

export type PersistedChatSessionTab = {
  id: string;
  label: string;
};

function normalizeSessionId(sessionId?: string): string {
  return (sessionId || 'session-1').trim() || 'session-1';
}

function keyForSession(sessionId?: string): string {
  return `${STORAGE_KEY}:${normalizeSessionId(sessionId)}`;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function storageCandidates(): Storage[] {
  return [getLocalStorage(), getSessionStorage()].filter((storage): storage is Storage => Boolean(storage));
}

function trimMessagesForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_MESSAGES).map((message) => {
    if (message.type === 'lead_research_results') {
      return {
        ...message,
        items: message.items.slice(0, 25),
        traces: message.traces?.slice(0, 10),
        evidence: message.evidence?.slice(0, 10),
      };
    }
    if (message.type === 'retrieval_results') {
      return {
        ...message,
        items: message.items.slice(0, 20),
      };
    }
    return message;
  });
}

function serializeMessages(messages: ChatMessage[]): string {
  return JSON.stringify(
    messages.map((message) => ({
      ...message,
      timestamp: (message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)).toISOString(),
    }))
  );
}

function parseMessages(raw: string): ChatMessage[] | null {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  return parsed.map((item) => {
    const message = item as Omit<ChatMessage, 'timestamp'> & { timestamp: string | Date };
    return {
      ...message,
      timestamp: new Date(message.timestamp),
    };
  });
}

export function saveMessages(messages: ChatMessage[], sessionId?: string): void {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const trimmed = trimMessagesForStorage(messages);
  memoryMessages.set(normalizedSessionId, trimmed);
  const payload = serializeMessages(trimmed);
  for (const storage of storageCandidates()) {
    try {
      storage.setItem(keyForSession(normalizedSessionId), payload);
    } catch {
      // continue to remaining fallbacks
    }
  }
}

export function loadMessages(sessionId?: string): ChatMessage[] | null {
  const normalizedSessionId = normalizeSessionId(sessionId);
  for (const storage of storageCandidates()) {
    try {
      const raw =
        storage.getItem(keyForSession(normalizedSessionId)) ||
        (normalizedSessionId === 'session-1' ? storage.getItem(STORAGE_KEY) : null);
      if (!raw) continue;
      return parseMessages(raw);
    } catch {
      // continue to remaining fallbacks
    }
  }
  const cached = memoryMessages.get(normalizedSessionId);
  return cached && cached.length > 0 ? cached : null;
}

export function clearMessages(sessionId?: string): void {
  const normalizedSessionId = normalizeSessionId(sessionId);
  memoryMessages.delete(normalizedSessionId);
  for (const storage of storageCandidates()) {
    try {
      storage.removeItem(keyForSession(normalizedSessionId));
    } catch {
      // ignore
    }
  }
}

export function saveSessionTabs(tabs: PersistedChatSessionTab[]): void {
  memorySessionTabs = tabs;
  const payload = JSON.stringify(tabs);
  for (const storage of storageCandidates()) {
    try {
      storage.setItem(SESSIONS_KEY, payload);
    } catch {
      // ignore
    }
  }
}

export function loadSessionTabs(): PersistedChatSessionTab[] | null {
  for (const storage of storageCandidates()) {
    try {
      const raw = storage.getItem(SESSIONS_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as PersistedChatSessionTab[];
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      return parsed
        .map((tab) => ({
          id: String(tab?.id || '').trim(),
          label: String(tab?.label || '').trim(),
        }))
        .filter((tab) => tab.id && tab.label);
    } catch {
      // continue to remaining fallbacks
    }
  }
  return memorySessionTabs && memorySessionTabs.length > 0 ? memorySessionTabs : null;
}

export function saveActiveSessionId(sessionId: string): void {
  memoryActiveSessionId = sessionId;
  for (const storage of storageCandidates()) {
    try {
      storage.setItem(ACTIVE_SESSION_KEY, sessionId);
    } catch {
      // ignore
    }
  }
}

export function loadActiveSessionId(): string | null {
  for (const storage of storageCandidates()) {
    try {
      const raw = storage.getItem(ACTIVE_SESSION_KEY);
      if (raw) return raw.trim() || null;
    } catch {
      // continue to remaining fallbacks
    }
  }
  return memoryActiveSessionId;
}
