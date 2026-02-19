import { createContext, useContext } from 'react';
import type { ChatMessage, ThoughtUIState } from '../types/chat';

export interface ChatProviderApi {
  messages: ChatMessage[];
  isTyping: boolean;
  assistantStreamingText: string;
  sendMessage: (text: string) => Promise<void>;
  uploadFiles: (files: File[]) => Promise<void>;
  stopAssistantResponse: () => void;
  handleAction: (actionValue: string) => Promise<void>;
  browserViewerOpen: boolean;
  closeBrowserViewer: () => void;
  salesforceSaveUrl: (contactId: number, contactName: string, url: string, promptId: string) => Promise<void>;
  salesforceSearch: (contactId: number, contactName: string, promptId: string) => Promise<void>;
  salesforceSkip: (contactId: number, promptId: string) => Promise<void>;
  thoughtState: ThoughtUIState;
}

export const ChatContext = createContext<ChatProviderApi | undefined>(undefined);

export function useChatProvider() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatProvider must be used inside ChatProvider');
  return ctx;
}
