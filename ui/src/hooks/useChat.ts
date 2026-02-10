import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { processAction, processMessage, type EngineCallbacks } from '../services/workflowEngine';
import { loadMessages, saveMessages } from '../services/chatPersistence';
import type {
  BackgroundTask,
  ChatMessage,
  EmbeddedComponentMessage,
  EmbeddedComponentType,
  Workflow,
} from '../types/chat';

let _counter = 0;
function createId() {
  return `msg-${Date.now()}-${++_counter}`;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  type: 'text',
  sender: 'bot',
  content:
    'Hi! I am your sales assistant. I can help you find contacts, manage campaigns, and send emails. Type "help" to see what I can do.',
  timestamp: new Date(),
};

const SECTION_TO_COMPONENT: Record<string, EmbeddedComponentType> = {
  overview: 'overview',
  conversations: 'active_conversations',
  scheduled: 'scheduled_sends',
  performance: 'email_performance',
  contacts: 'todays_contacts',
};

export function useChat(options?: {
  recentReplies?: unknown[];
  stats?: unknown;
  emailStats?: unknown;
  onExpandSection?: (key: string) => void;
  onBrowserViewerOpen?: () => void;
  onBrowserViewerClose?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const persisted = loadMessages();
    return persisted && persisted.length > 0 ? persisted : [WELCOME_MESSAGE];
  });
  const [isTyping, setIsTyping] = useState(false);
  const [browserViewerOpen, setBrowserViewerOpen] = useState(false);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const activeWorkflowRef = useRef<Workflow | null>(null);
  const sfPollersRef = useRef<Record<number, number>>({});
  const optimisticButtonsRef = useRef<Record<string, ChatMessage | undefined>>({});

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const appendMessages = useCallback((newMessages: ChatMessage[]) => {
    setMessages((prev) => [...prev, ...newMessages]);
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const updateMessage = useCallback((id: string, updater: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const openBrowserViewer = useCallback(() => {
    setBrowserViewerOpen(true);
    options?.onBrowserViewerOpen?.();
  }, [options]);

  const closeBrowserViewer = useCallback(() => {
    setBrowserViewerOpen(false);
    options?.onBrowserViewerClose?.();
  }, [options]);

  /* ── Section button click → inject embedded component message ── */
  const handleSectionClick = useCallback((section: string) => {
    const componentType = SECTION_TO_COMPONENT[section];
    if (!componentType) return;

    const msg: EmbeddedComponentMessage = {
      id: createId(),
      type: 'embedded_component',
      componentType,
      sender: 'bot',
      timestamp: new Date(),
      props: {}, // data comes from dashboardData bridge, not here
    };

    setMessages((prev) => [...prev, msg]);
  }, []);

  /* Callbacks that let workflow steps push UI changes immediately. */
  const getEngineCallbacks = useCallback((): EngineCallbacks => ({
    emitMessages: (msgs: ChatMessage[]) => {
      setMessages((prev) => [...prev, ...msgs]);
    },
    openBrowserViewer: () => {
      setBrowserViewerOpen(true);
      options?.onBrowserViewerOpen?.();
    },
  }), [options]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isTyping) return;

      const userMsg: ChatMessage = {
        id: createId(),
        type: 'text',
        sender: 'user',
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);

      try {
        const result = await processMessage(trimmed, activeWorkflowRef.current, {
          recentReplies: options?.recentReplies,
          stats: options?.stats,
          emailStats: options?.emailStats,
          backgroundTasks,
        }, getEngineCallbacks());

        activeWorkflowRef.current = result.workflow;
        appendMessages(result.messages);

        if (result.expandSection && options?.onExpandSection) {
          options.onExpandSection(result.expandSection);
        }
        if (result.openBrowserViewer) {
          openBrowserViewer();
        }
        if (result.closeBrowserViewer) {
          if (result.openBrowserViewer) {
            setTimeout(() => closeBrowserViewer(), 600);
          } else {
            closeBrowserViewer();
          }
        }
      } catch {
        appendMessages([
          {
            id: createId(),
            type: 'status',
            sender: 'bot',
            content: 'Something went wrong. Please try again.',
            status: 'error',
            timestamp: new Date(),
          },
        ]);
        activeWorkflowRef.current = null;
      } finally {
        setIsTyping(false);
      }
    },
    [appendMessages, closeBrowserViewer, getEngineCallbacks, isTyping, openBrowserViewer, options]
  );

  const handleAction = useCallback(
    async (actionValue: string) => {
      // Support action metadata like "add_contact::src=msg-..."
      const parts = actionValue.split('::');
      const baseAction = parts[0] || actionValue;
      const src = parts.find((p) => p.startsWith('src='))?.slice(4);

      if (baseAction.startsWith('open_url:')) {
        const url = baseAction.slice('open_url:'.length).trim();
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }
      if (baseAction === 'salesnav_search') {
        openBrowserViewer();
      }

      // Handle Outlook connect action from chat message
      if (baseAction === 'connect_outlook') {
        // Delegated to Dashboard.tsx via the dashboardData bridge
        return;
      }
      if (baseAction === 'dismiss_outlook') {
        if (src) removeMessage(src);
        return;
      }

      // Optimistic UX for contact save prompts.
      const isContactDbPromptAction = baseAction === 'add_contact' || baseAction === 'cancel';
      if (src && isContactDbPromptAction) {
        const original = messages.find((m) => m.id === src);
        if (original) optimisticButtonsRef.current[src] = original;

        updateMessage(src, (m) => {
          if (m.type !== 'action_buttons') return m;
          const nextContent =
            baseAction === 'add_contact'
              ? 'Saving...'
              : 'Skipped';
          return {
            ...m,
            content: nextContent,
            buttons: [],
          };
        });
      }

      setIsTyping(true);

      try {
        const result = await processAction(baseAction, activeWorkflowRef.current, getEngineCallbacks());
        activeWorkflowRef.current = result.workflow;
        appendMessages(result.messages);

        if (result.expandSection && options?.onExpandSection) {
          options.onExpandSection(result.expandSection);
        }
        if (result.openBrowserViewer) {
          openBrowserViewer();
        }
        if (result.closeBrowserViewer) {
          if (result.openBrowserViewer) {
            setTimeout(() => closeBrowserViewer(), 600);
          } else {
            closeBrowserViewer();
          }
        }

        // If contact save succeeded, flip optimistic state to "Added to database"
        if (src && baseAction === 'add_contact') {
          updateMessage(src, (m) => {
            if (m.type !== 'action_buttons') return m;
            return {
              ...m,
              content: 'Added to database',
              buttons: [],
            };
          });
          delete optimisticButtonsRef.current[src];
        }
      } catch {
        // Revert optimistic UI
        if (src && optimisticButtonsRef.current[src]) {
          const original = optimisticButtonsRef.current[src];
          delete optimisticButtonsRef.current[src];
          if (original) {
            setMessages((prev) => prev.map((m) => (m.id === src ? original : m)));
          }
        }
        appendMessages([
          {
            id: createId(),
            type: 'status',
            sender: 'bot',
            content: 'Action failed. Please try again.',
            status: 'error',
            timestamp: new Date(),
          },
        ]);
        activeWorkflowRef.current = null;
      } finally {
        setIsTyping(false);
      }
    },
    [appendMessages, closeBrowserViewer, getEngineCallbacks, messages, openBrowserViewer, options, removeMessage, updateMessage]
  );

  const startSalesforcePolling = useCallback((contactId: number, contactName: string, loadingMsgId?: string) => {
    if (sfPollersRef.current[contactId]) return;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const c = await api.getContact(contactId);
        const status = c.salesforce_status;
        const url = c.salesforce_url;

        if (status === 'uploaded' && url) {
          if (loadingMsgId) removeMessage(loadingMsgId);
          closeBrowserViewer();
          appendMessages([
            {
              id: createId(),
              type: 'text',
              sender: 'bot',
              content: `Found **${contactName}** in Salesforce.`,
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'Open their Lead record:',
              timestamp: new Date(),
              buttons: [
                { label: 'View Lead', value: `open_url:${url}`, variant: 'primary' },
              ],
            },
          ]);
          window.clearInterval(sfPollersRef.current[contactId]);
          delete sfPollersRef.current[contactId];
          return;
        }

        if (status === 'not_found') {
          if (loadingMsgId) removeMessage(loadingMsgId);
          closeBrowserViewer();
          appendMessages([
            {
              id: createId(),
              type: 'text',
              sender: 'bot',
              content: `${contactName} was not found in Salesforce. They'll be included in the next bulk upload.`,
              timestamp: new Date(),
            },
          ]);
          window.clearInterval(sfPollersRef.current[contactId]);
          delete sfPollersRef.current[contactId];
          return;
        }

        // Timeout safety so we don't spin forever on auth/queue failures.
        if (Date.now() - startedAt > 45000) {
          if (loadingMsgId) removeMessage(loadingMsgId);
          closeBrowserViewer();
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Couldn't search Salesforce for ${contactName} (timed out). Make sure Salesforce is authenticated and try again.`,
              status: 'info',
              timestamp: new Date(),
            },
          ]);
          window.clearInterval(sfPollersRef.current[contactId]);
          delete sfPollersRef.current[contactId];
        }
      } catch {
        // keep polling silently (best-effort)
      }
    };

    const intervalId = window.setInterval(poll, 2000);
    sfPollersRef.current[contactId] = intervalId;
    void poll();
  }, [appendMessages, closeBrowserViewer, removeMessage]);

  const salesforceSaveUrl = useCallback(async (contactId: number, contactName: string, url: string, promptId: string) => {
    await api.saveSalesforceUrl(contactId, url);
    removeMessage(promptId);
    appendMessages([
      {
        id: createId(),
        type: 'text',
        sender: 'bot',
        content: `Salesforce URL saved for **${contactName}**.`,
        timestamp: new Date(),
      },
    ]);
  }, [appendMessages, removeMessage]);

  const salesforceSearch = useCallback(async (contactId: number, contactName: string, promptId: string) => {
    removeMessage(promptId);
    // Open browser viewer so the user can see automation.
    openBrowserViewer();

    const loadingId = createId();
    appendMessages([
      {
        id: loadingId,
        type: 'status',
        sender: 'bot',
        content: `Searching Salesforce for ${contactName}...`,
        status: 'loading',
        timestamp: new Date(),
      },
    ]);

    try {
      const res = await api.enqueueSalesforceSearch(contactId);
      if (res.busy) {
        appendMessages([
          {
            id: createId(),
            type: 'status',
            sender: 'bot',
            content: "Couldn't search Salesforce right now — the browser is busy. I'll try again when it's free.",
            status: 'info',
            timestamp: new Date(),
          },
        ]);
      }
    } catch {
      appendMessages([
        {
          id: createId(),
          type: 'status',
          sender: 'bot',
          content: "Couldn't search Salesforce right now. I'll retry when possible.",
          status: 'info',
          timestamp: new Date(),
        },
      ]);
    }

    startSalesforcePolling(contactId, contactName, loadingId);
  }, [appendMessages, openBrowserViewer, removeMessage, startSalesforcePolling]);

  const salesforceSkip = useCallback(async (contactId: number, promptId: string) => {
    removeMessage(promptId);
    try {
      await api.skipSalesforce(contactId);
    } catch {
      // ignore
    }
  }, [removeMessage]);

  const cancelWorkflow = useCallback(() => {
    if (activeWorkflowRef.current) {
      activeWorkflowRef.current.status = 'cancelled';
      activeWorkflowRef.current = null;
      appendMessages([
        {
          id: createId(),
          type: 'text',
          sender: 'bot',
          content: 'Action cancelled. What else can I help with?',
          timestamp: new Date(),
        },
      ]);
    }
  }, [appendMessages]);

  /* ── Background task management ── */
  const addBackgroundTask = useCallback((task: BackgroundTask) => {
    setBackgroundTasks((prev) => [...prev, task]);
  }, []);

  const updateBackgroundTask = useCallback(
    (taskId: string, update: Partial<BackgroundTask>) => {
      setBackgroundTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...update } : t))
      );
    },
    []
  );

  const getBackgroundTasks = useCallback(() => {
    return backgroundTasks;
  }, [backgroundTasks]);

  return {
    messages,
    isTyping,
    sendMessage,
    handleAction,
    handleSectionClick,
    salesforceSaveUrl,
    salesforceSearch,
    salesforceSkip,
    cancelWorkflow,
    hasActiveWorkflow: activeWorkflowRef.current?.status === 'waiting_user',
    browserViewerOpen,
    closeBrowserViewer,
    backgroundTasks,
    addBackgroundTask,
    updateBackgroundTask,
    getBackgroundTasks,
  };
}
