import { useEffect, useRef, type ReactNode } from 'react';
import type { ChatMessage as ChatMessageType, DashboardDataBridge } from '../../types/chat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';

interface ChatContainerProps {
  messages: ChatMessageType[];
  isTyping: boolean;
  onSendMessage: (text: string) => void;
  onAction: (actionValue: string) => void;
  onSalesforceSaveUrl?: (contactId: number, contactName: string, url: string, promptId: string) => Promise<void>;
  onSalesforceSearch?: (contactId: number, contactName: string, promptId: string) => Promise<void>;
  onSalesforceSkip?: (contactId: number, promptId: string) => Promise<void>;
  dashboardData?: DashboardDataBridge;
  sectionBar?: ReactNode;
}

export function ChatContainer({
  messages,
  isTyping,
  onSendMessage,
  onAction,
  onSalesforceSaveUrl,
  onSalesforceSearch,
  onSalesforceSkip,
  dashboardData,
  sectionBar,
}: ChatContainerProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg">
      {/* Scrollable message area */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            onAction={onAction}
            onSalesforceSaveUrl={onSalesforceSaveUrl}
            onSalesforceSearch={onSalesforceSearch}
            onSalesforceSkip={onSalesforceSkip}
            dashboardData={dashboardData}
          />
        ))}
        {isTyping ? <TypingIndicator /> : null}
        <div ref={bottomRef} />
      </div>

      {/* Section bar — always visible above input */}
      {sectionBar}

      {/* Input — always visible at bottom */}
      <ChatInput onSend={onSendMessage} disabled={isTyping} />
    </div>
  );
}
