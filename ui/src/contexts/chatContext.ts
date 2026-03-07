import { createContext, useContext } from 'react';
import type { ChatMessage, ThoughtUIState } from '../types/chat';

export interface ChatSessionTab {
  id: string;
  label: string;
}

export interface ChatProviderApi {
  messages: ChatMessage[];
  isTyping: boolean;
  assistantStreamingText: string;
  sendMessage: (text: string) => Promise<void>;
  chatModelSelection: string;
  plannerModelSelection: string;
  setChatModelSelection: (model: string) => void;
  setPlannerModelSelection: (model: string) => void;
  chatModelOptions: Array<{ value: string; label: string; provider: 'ollama' | 'openai' | 'openrouter'; model: string }>;
  plannerModelOptions: Array<{ value: string; label: string; provider: 'ollama' | 'openai' | 'openrouter'; model: string }>;
  localRuntimeAvailable: boolean;
  localRuntimeLabel: string;
  uploadFiles: (files: File[]) => Promise<void>;
  stopAssistantResponse: () => void;
  handleAction: (actionValue: string) => Promise<void>;
  browserViewerOpen: boolean;
  closeBrowserViewer: () => void;
  salesforceSaveUrl: (contactId: number, contactName: string, url: string, promptId: string) => Promise<void>;
  salesforceSearch: (contactId: number, contactName: string, promptId: string) => Promise<void>;
  salesforceSkip: (contactId: number, promptId: string) => Promise<void>;
  thoughtState: ThoughtUIState;
  sessions: ChatSessionTab[];
  activeSessionId: string;
  createSession: () => void;
  setActiveSession: (sessionId: string) => void;
  guidanceActive: boolean;
}

export const ChatContext = createContext<ChatProviderApi | undefined>(undefined);

export function useChatProvider() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatProvider must be used inside ChatProvider');
  return ctx;
}
