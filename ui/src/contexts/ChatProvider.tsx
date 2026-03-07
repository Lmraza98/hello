import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage } from '../types/chat';
import { useChat } from '../hooks/useChat';
import { buildChatRequest, parseAssistantResponse, type ChatAction } from '../chat/actions';
import { usePageContext } from './PageContextProvider';
import { prewarmToolPlannerContext, stopFilterContextPrefetch } from '../chat/models/toolPlanner';
import { ChatContext, type ChatProviderApi, type ChatSessionTab } from './chatContext';
import { loadActiveSessionId, loadMessages, loadSessionTabs, saveActiveSessionId, saveMessages, saveSessionTabs } from '../services/chatPersistence';
import { useAssistantGuide } from './AssistantGuideContext';

const DEFAULT_SESSION: ChatSessionTab = {
  id: 'session-1',
  label: 'Session 1',
};

function normalizeSessionTabs(value: ChatSessionTab[] | null | undefined): ChatSessionTab[] {
  const seen = new Set<string>();
  const tabs = (value || [])
    .map((tab) => ({
      id: String(tab?.id || '').trim(),
      label: String(tab?.label || '').trim(),
    }))
    .filter((tab) => tab.id && tab.label && !seen.has(tab.id) && (seen.add(tab.id), true));
  return tabs.length > 0 ? tabs : [DEFAULT_SESSION];
}

function nextSessionTab(existing: ChatSessionTab[]): ChatSessionTab {
  const nextNumber =
    existing.reduce((max, tab) => {
      const match = /^session-(\d+)$/i.exec(tab.id);
      const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0) + 1;
  return {
    id: `session-${nextNumber}`,
    label: `Session ${nextNumber}`,
  };
}

function SessionScopedChatProvider({
  children,
  onActions,
  sessions,
  activeSessionId,
  initialMessages,
  persistSessionMessages,
  createSession,
  setActiveSession,
}: {
  children: ReactNode;
  onActions?: (actions: ChatAction[]) => Promise<void> | void;
  sessions: ChatSessionTab[];
  activeSessionId: string;
  initialMessages: ChatMessage[] | null;
  persistSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
  createSession: () => void;
  setActiveSession: (sessionId: string) => void;
}) {
  const plannerPrefetchEnabled = String(process.env.NEXT_PUBLIC_TOOL_PLANNER_PREFETCH_ENABLED ?? '0') === '1';
  const { pageContext } = usePageContext();
  const { guideState, clearHighlight, setActiveSession: setActiveGuideSession } = useAssistantGuide();
  const chat = useChat({
    sessionId: activeSessionId,
    initialMessages,
    onMessagesChange: persistSessionMessages,
    onAppActions: onActions,
  });
  const lastHandledBotMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveGuideSession(activeSessionId);
  }, [activeSessionId, setActiveGuideSession]);

  useEffect(() => {
    const botTextMessages = chat.messages.filter(
      (m) => m.type === 'text' && m.sender === 'bot'
    );
    const latest = botTextMessages[botTextMessages.length - 1] as Extract<ChatMessage, { type: 'text' }> | undefined;
    lastHandledBotMessageIdRef.current = latest?.id || null;
  }, [activeSessionId]);

  const switchSession = useCallback(
    (sessionId: string) => {
      persistSessionMessages(activeSessionId, chat.messages);
      setActiveSession(sessionId);
    },
    [
      activeSessionId,
      chat.messages,
      persistSessionMessages,
      setActiveSession,
    ]
  );

  const addSession = useCallback(() => {
    persistSessionMessages(activeSessionId, chat.messages);
    createSession();
  }, [
    activeSessionId,
    chat.messages,
    createSession,
    persistSessionMessages,
  ]);

  useEffect(() => {
    if (!plannerPrefetchEnabled) return undefined;
    void prewarmToolPlannerContext();
    return () => stopFilterContextPrefetch();
  }, [plannerPrefetchEnabled]);

  useEffect(() => {
    const botTextMessages = chat.messages.filter(
      (m) => m.type === 'text' && m.sender === 'bot'
    );
    const latest = botTextMessages[botTextMessages.length - 1] as Extract<ChatMessage, { type: 'text' }> | undefined;
    if (!latest || latest.id === lastHandledBotMessageIdRef.current) return;
    lastHandledBotMessageIdRef.current = latest.id;
    const parsed = parseAssistantResponse(latest.content);
    if (parsed.actions.length > 0) {
      void onActions?.(parsed.actions);
    }
  }, [chat.messages, onActions]);

  const value = useMemo<ChatProviderApi>(
    () => ({
      ...chat,
      sessions,
      activeSessionId,
      createSession: addSession,
      setActiveSession: switchSession,
      guidanceActive: guideState.active,
      sendMessage: async (text: string) => {
        clearHighlight();
        const contextual = buildChatRequest({ userMessage: text, pageContext });
        await chat.sendMessage(text, { requestText: contextual });
      },
    }),
    [activeSessionId, addSession, chat, clearHighlight, guideState.active, pageContext, sessions, switchSession]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function ChatProvider({
  children,
  onActions,
}: {
  children: ReactNode;
  onActions?: (actions: ChatAction[]) => Promise<void> | void;
}) {
  const [sessions, setSessions] = useState<ChatSessionTab[]>([DEFAULT_SESSION]);
  const [activeSessionId, setActiveSessionId] = useState<string>(DEFAULT_SESSION.id);
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);
  const sessionCacheRef = useRef<Record<string, ChatMessage[]>>({});
  const resolvedActiveSessionId = sessions.some((tab) => tab.id === activeSessionId) ? activeSessionId : sessions[0]?.id || DEFAULT_SESSION.id;

  useEffect(() => {
    const loadedTabs = normalizeSessionTabs(loadSessionTabs());
    const savedActiveId = loadActiveSessionId();
    const cache: Record<string, ChatMessage[]> = {};
    for (const tab of loadedTabs) {
      const persisted = loadMessages(tab.id);
      if (persisted && persisted.length > 0) {
        cache[tab.id] = persisted;
      }
    }
    sessionCacheRef.current = cache;
    setSessions(loadedTabs);
    setActiveSessionId(
      savedActiveId && loadedTabs.some((tab) => tab.id === savedActiveId)
        ? savedActiveId
        : loadedTabs[0]?.id || DEFAULT_SESSION.id
    );
    setHydratedFromStorage(true);
  }, []);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    saveSessionTabs(sessions);
  }, [hydratedFromStorage, sessions]);

  useEffect(() => {
    if (!hydratedFromStorage) return;
    saveActiveSessionId(resolvedActiveSessionId);
  }, [hydratedFromStorage, resolvedActiveSessionId]);

  const createSession = useCallback(() => {
    const next = nextSessionTab(sessions);
    setSessions((prev) => [...prev, next]);
    setActiveSessionId(next.id);
  }, [sessions]);

  const persistSessionMessages = useCallback((sessionId: string, messages: ChatMessage[]) => {
    sessionCacheRef.current[sessionId] = messages;
    saveMessages(messages, sessionId);
  }, []);

  const setActiveSession = useCallback(
    (sessionId: string) => {
      if (!sessions.some((tab) => tab.id === sessionId)) return;
      setActiveSessionId(sessionId);
    },
    [sessions]
  );

  return (
    <SessionScopedChatProvider
      onActions={onActions}
      sessions={sessions}
      activeSessionId={resolvedActiveSessionId}
      initialMessages={sessionCacheRef.current[resolvedActiveSessionId] || null}
      persistSessionMessages={persistSessionMessages}
      createSession={createSession}
      setActiveSession={setActiveSession}
    >
      {children}
    </SessionScopedChatProvider>
  );
}
