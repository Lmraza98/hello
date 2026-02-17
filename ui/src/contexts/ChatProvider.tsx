import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ChatMessage } from '../types/chat';
import { useChat } from '../hooks/useChat';
import { buildChatRequest, parseAssistantResponse, type ChatAction } from '../chat/actions';
import { usePageContext } from './PageContextProvider';
import { prewarmToolPlannerContext, stopFilterContextPrefetch } from '../chat/models/toolPlanner';
import { ChatContext, type ChatProviderApi } from './chatContext';

export function ChatProvider({
  children,
  onActions,
}: {
  children: ReactNode;
  onActions?: (actions: ChatAction[]) => Promise<void> | void;
}) {
  const { pageContext } = usePageContext();
  const chat = useChat({ onAppActions: onActions });
  const lastHandledBotMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    void prewarmToolPlannerContext();
    return () => stopFilterContextPrefetch();
  }, []);

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
      sendMessage: async (text: string) => {
        const contextual = buildChatRequest({ userMessage: text, pageContext });
        await chat.sendMessage(text, { requestText: contextual });
      },
    }),
    [chat, pageContext]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
