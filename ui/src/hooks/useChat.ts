import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  processAction as processLlmAction,
  processMessage as processLlmMessage,
  type ChatCompletionMessageParam,
  type ChatSessionState,
} from '../chat/chatEngine';
import type { PendingTaskPlan, PlannedToolCall } from '../chat/chatEngineTypes';
/** @deprecated alias — prefer PlannedToolCall directly */
type ParsedFunctionCall = PlannedToolCall;
import { parseSlashCommand } from '../chat/slashCommands';
import { loadMessages, saveMessages } from '../services/chatPersistence';
import { appendRunEvent } from '../services/chatRunLog';
import {
  processAction as processWorkflowAction,
  processMessage as processWorkflowMessage,
  type EngineCallbacks,
} from '../services/workflowEngine';
import type {
  BackgroundTask,
  ChatMessage,
  EmbeddedComponentMessage,
  EmbeddedComponentType,
  Workflow,
} from '../types/chat';
import type { ChatAction } from '../chat/actions';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';

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

const SHOW_VERBOSE_CHAT_DEBUG =
  (import.meta.env.VITE_CHAT_DEBUG_VERBOSE || 'false').toLowerCase() === 'true';

function formatMs(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '0ms';
  return `${Math.round(num)}ms`;
}

function summarizeTraceTiming(
  trace: {
    timings?: Record<string, unknown>;
    executedCalls?: Array<{ name: string; result?: unknown; durationMs?: number }>;
  } | undefined
): string | null {
  if (!trace) return null;
  const parts: string[] = [];
  if (trace.timings && typeof trace.timings === 'object') {
    const timings = trace.timings;
    if (timings.totalMs != null) parts.push(`total ${formatMs(timings.totalMs)}`);
    if (timings.routeMs != null) parts.push(`route ${formatMs(timings.routeMs)}`);
    if (timings.reactMs != null) parts.push(`react ${formatMs(timings.reactMs)}`);
    if (timings.dispatchMs != null) parts.push(`dispatch ${formatMs(timings.dispatchMs)}`);
  }
  const hybrid = [...(trace.executedCalls || [])]
    .reverse()
    .find((call) => call.name === 'hybrid_search' && call.result && typeof call.result === 'object');
  if (hybrid && hybrid.result && typeof hybrid.result === 'object') {
    const payload = hybrid.result as { timings?: Record<string, unknown> };
    const t = payload.timings;
    if (t && typeof t === 'object') {
      const hybridParts: string[] = [];
      if (t.total_ms != null) hybridParts.push(`hybrid ${formatMs(t.total_ms)}`);
      if (t.index_refresh_ms != null) hybridParts.push(`refresh ${formatMs(t.index_refresh_ms)}`);
      if (t.exact_ms != null) hybridParts.push(`exact ${formatMs(t.exact_ms)}`);
      if (t.lexical_ms != null) hybridParts.push(`lex ${formatMs(t.lexical_ms)}`);
      if (t.vector_ms != null) hybridParts.push(`vector ${formatMs(t.vector_ms)}`);
      if (hybridParts.length > 0) {
        parts.push(hybridParts.join(', '));
      }
    }
  }
  if (parts.length === 0) return null;
  return `Timing: ${parts.join(' | ')}`;
}

export function useChat(options?: {
  recentReplies?: unknown[];
  stats?: unknown;
  emailStats?: unknown;
  onExpandSection?: (key: string) => void;
  onBrowserViewerOpen?: () => void;
  onBrowserViewerClose?: () => void;
  onAppActions?: (actions: ChatAction[]) => Promise<void> | void;
}) {
  type PendingFilterSelection = {
    sourceUserMessage: string;
    toolName: string;
    argName: string;
    values: string[];
  };

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const persisted = loadMessages();
    return persisted && persisted.length > 0 ? persisted : [WELCOME_MESSAGE];
  });
  const [isTyping, setIsTyping] = useState(false);
  const [browserViewerOpen, setBrowserViewerOpen] = useState(false);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ChatCompletionMessageParam[]>([]);
  const sessionStateRef = useRef<ChatSessionState | undefined>(undefined);
  const activeWorkflowRef = useRef<Workflow | null>(null);
  const pendingToolPlanRef = useRef<{
    uiActions?: ChatAction[];
    calls: ParsedFunctionCall[];
    summary: string;
    sourceUserMessage: string;
    reactTrace?: unknown[];
    pendingTaskPlan?: PendingTaskPlan;
  } | null>(null);
  const pendingFilterSelectionRef = useRef<PendingFilterSelection | null>(null);
  const sfPollersRef = useRef<Record<number, number>>({});
  const optimisticButtonsRef = useRef<Record<string, ChatMessage | undefined>>({});
  const primaryLaneRef = useRef<Promise<void>>(Promise.resolve());

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

  const appendPlannerStatusLog = useCallback((id: string, message: string) => {
    appendRunEvent({
      lane: 'primary',
      phase: 'planner_event',
      message,
    });
    updateMessage(id, (m) => {
      if (m.type !== 'status') return m;
      const existing = (m.details || '').trim();
      const lines = existing ? existing.split('\n') : [];
      const nextLine = `- ${message}`;
      const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
      const nextDetails =
        lastLine === nextLine
          ? existing
          : [...lines, nextLine].join('\n').trim();
      return {
        ...m,
        content: message,
        details: nextDetails,
        status: 'loading',
      };
    });
  }, [updateMessage]);

  const deriveAppActionsFromExecutedCalls = useCallback((executedCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown }>): ChatAction[] => {
    const pushFilter = (actions: ChatAction[], key: string, rawValue: unknown) => {
      const normalized = normalizeQueryFilterParam(key, rawValue);
      if (normalized === null) return;
      actions.push({ type: 'set_filter', key, value: normalized });
    };

    const actions: ChatAction[] = [];
    const successful = executedCalls.filter((x) => x.ok);
    const pendingBrowserWorkflow = [...successful]
      .reverse()
      .find((x) => {
        if (x.name !== 'browser_search_and_extract' && x.name !== 'browser_list_sub_items') return false;
        if (!x.result || typeof x.result !== 'object') return false;
        const row = x.result as Record<string, unknown>;
        return row.status === 'pending' && typeof row.task_id === 'string' && String(row.task_id).trim().length > 0;
      });
    if (pendingBrowserWorkflow && pendingBrowserWorkflow.result && typeof pendingBrowserWorkflow.result === 'object') {
      const taskId = String((pendingBrowserWorkflow.result as Record<string, unknown>).task_id || '').trim();
      const to = taskId ? `/tasks?taskId=${encodeURIComponent(taskId)}` : '/tasks';
      actions.push({ type: 'navigate', to });
      return actions;
    }
    const searchContacts = successful.find((x) => x.name === 'search_contacts');
    if (searchContacts) {
      actions.push({ type: 'navigate', to: '/contacts' });
      const args = searchContacts.args || {};
      pushFilter(actions, 'q', args.name);
      pushFilter(actions, 'company', args.company);
      pushFilter(actions, 'hasEmail', args.has_email);
      return actions;
    }

    const searchCompanies = successful.find((x) => x.name === 'search_companies');
    if (searchCompanies) {
      actions.push({ type: 'navigate', to: '/companies' });
      const args = searchCompanies.args || {};
      pushFilter(actions, 'q', args.q);
      pushFilter(actions, 'company', args.company_name);
      pushFilter(actions, 'vertical', args.vertical);
      pushFilter(actions, 'tier', args.tier);
      return actions;
    }

    return [];
  }, []);

  const extractPendingFilterSelection = useCallback(
    (
      executedCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown }>,
      sourceUserMessage: string
    ): PendingFilterSelection | null => {
      const call = [...executedCalls].reverse().find((x) => x.ok && x.name === 'list_filter_values');
      if (!call || !call.result || typeof call.result !== 'object') return null;
      const payload = call.result as Record<string, unknown>;
      const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.trim() : '';
      const argName = typeof payload.arg_name === 'string' ? payload.arg_name.trim() : '';
      const values = Array.isArray(payload.values)
        ? payload.values.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      if (!toolName || !argName || values.length === 0) return null;
      return { sourceUserMessage, toolName, argName, values };
    },
    []
  );

  const selectAutoFilterValues = useCallback((options: string[]): string[] => {
    const unique = [...new Set(options.map((x) => x.trim()).filter(Boolean))];
    if (unique.length <= 3) return unique;
    return unique.slice(0, 3);
  }, []);

  const openBrowserViewer = useCallback(() => {
    setBrowserViewerOpen(true);
    options?.onBrowserViewerOpen?.();
  }, [options]);

  const closeBrowserViewer = useCallback(() => {
    setBrowserViewerOpen(false);
    options?.onBrowserViewerClose?.();
  }, [options]);

  const handleSectionClick = useCallback((section: string) => {
    const componentType = SECTION_TO_COMPONENT[section];
    if (!componentType) return;

    const msg: EmbeddedComponentMessage = {
      id: createId(),
      type: 'embedded_component',
      componentType,
      sender: 'bot',
      timestamp: new Date(),
      props: {},
    };

    setMessages((prev) => [...prev, msg]);
  }, []);

  const getWorkflowCallbacks = useCallback(
    (): EngineCallbacks => ({
      emitMessages: (msgs: ChatMessage[]) => {
        setMessages((prev) => [...prev, ...msgs]);
      },
      openBrowserViewer: () => {
        setBrowserViewerOpen(true);
        options?.onBrowserViewerOpen?.();
      },
    }),
    [options]
  );

  const enqueuePrimary = useCallback(async (task: () => Promise<void>) => {
    const next = primaryLaneRef.current
      .catch(() => undefined)
      .then(task);
    primaryLaneRef.current = next
      .then(() => undefined)
      .catch(() => undefined);
    return next;
  }, []);

  const runConfirmedToolPlan = useCallback(
    async (pending: { uiActions?: ChatAction[]; calls: ParsedFunctionCall[]; summary: string; sourceUserMessage: string; reactTrace?: unknown[]; pendingTaskPlan?: PendingTaskPlan }) => {
      appendRunEvent({
        lane: 'primary',
        phase: 'confirmation',
        message: 'Executing confirmed tool plan',
        meta: {
          ui_actions: (pending.uiActions || []).length,
          calls: pending.calls.map((c) => c.name),
        },
      });
      setIsTyping(true);
      const plannerStatusId = createId();
      appendMessages([
        {
          id: plannerStatusId,
          type: 'status',
          sender: 'bot',
          content: 'Preparing execution...',
          status: 'loading',
          timestamp: new Date(),
        },
      ]);
      try {
        if ((pending.uiActions || []).length > 0 && options?.onAppActions) {
          await options.onAppActions(pending.uiActions || []);
          appendPlannerStatusLog(plannerStatusId, `Executed ${(pending.uiActions || []).length} UI action(s).`);
        }
        if ((pending.calls || []).length === 0) {
          updateMessage(plannerStatusId, (m) =>
            m.type === 'status'
              ? {
                  ...m,
                  content: 'Execution completed.',
                  details: m.details ? `${m.details}\n- UI actions completed.` : '- UI actions completed.',
                  status: 'success',
                }
              : m
          );
          return;
        }
        const result = await processLlmMessage(pending.sourceUserMessage, {
          conversationHistory,
          sessionState: sessionStateRef.current,
          forceModel: 'qwen3',
          phase: 'executing',
          requireToolConfirmation: false,
          confirmedToolCalls: pending.calls,
          pendingTaskPlan: pending.pendingTaskPlan,
          _reactTrace: (pending.reactTrace || []) as any,
          onPlannerEvent: (message) => {
            appendPlannerStatusLog(plannerStatusId, message);
          },
          onToolCall: (name) => {
            appendRunEvent({
              lane: 'primary',
              phase: 'tool_call',
              message: name,
            });
            appendPlannerStatusLog(plannerStatusId, `Running ${name.replace(/_/g, ' ')}...`);
          },
        });
        updateMessage(plannerStatusId, (m) =>
          m.type === 'status'
            ? {
                ...m,
                content: 'Execution completed.',
                details: m.details ? `${m.details}\n- Execution completed.` : '- Execution completed.',
                status: 'success',
              }
            : m
        );
        if (result.debugTrace?.executionTrace && result.debugTrace.executionTrace.length > 0) {
          appendRunEvent({
            lane: 'primary',
            phase: 'tool_result',
            message: 'Execution trace available',
            meta: { trace: result.debugTrace.executionTrace.slice(0, 20) },
          });
          updateMessage(plannerStatusId, (m) =>
            m.type === 'status'
              ? {
                  ...m,
                  details: `${m.details || ''}\n\nExecution trace:\n${result.debugTrace?.executionTrace?.join('\n') || ''}`.trim(),
                }
              : m
          );
        }
        const confirmedTiming = summarizeTraceTiming(result.debugTrace);
        if (confirmedTiming) {
          appendPlannerStatusLog(plannerStatusId, confirmedTiming);
          appendRunEvent({
            lane: 'primary',
            phase: 'info',
            message: confirmedTiming,
          });
        }
        if (result.appActions && result.appActions.length > 0 && options?.onAppActions) {
          await options.onAppActions(result.appActions);
        }
        if (result.debugTrace?.executedCalls && result.debugTrace.executedCalls.length > 0 && options?.onAppActions) {
          const actions = deriveAppActionsFromExecutedCalls(result.debugTrace.executedCalls);
          if (actions.length > 0) {
            await options.onAppActions(actions);
          }
        }
        if (result.debugTrace?.executedCalls && result.debugTrace.executedCalls.length > 0) {
          const pendingSelection = extractPendingFilterSelection(
            result.debugTrace.executedCalls,
            pending.sourceUserMessage
          );
          if (pendingSelection) {
            pendingFilterSelectionRef.current = null;
            await autoRunFilterSelection(pendingSelection);
            return;
          }
        }
        if (result.confirmation?.required) {
          pendingToolPlanRef.current = {
            uiActions: result.confirmation.uiActions || [],
            calls: result.confirmation.calls,
            summary: result.confirmation.summary,
            sourceUserMessage: pending.sourceUserMessage,
            reactTrace: result.confirmation.traceSnapshot || result.debugTrace?.reactTraceRaw || [],
            pendingTaskPlan: result.confirmation.pendingTaskPlan,
          };
          appendMessages([
            {
              id: createId(),
              type: 'text',
              sender: 'bot',
              content: 'I can run a follow-up discovery step. Confirm to continue?',
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'Choose next step:',
              timestamp: new Date(),
              buttons: [
                { label: 'Confirm', value: 'tool_plan_confirm', variant: 'primary' },
                { label: 'Deny', value: 'tool_plan_deny', variant: 'danger' },
              ],
            },
          ]);
        }
        setConversationHistory(result.updatedHistory);
        sessionStateRef.current = result.sessionState || sessionStateRef.current;
        appendMessages(result.messages);
        if (!SHOW_VERBOSE_CHAT_DEBUG && !result.confirmation?.required) {
          removeMessage(plannerStatusId);
        }
      } catch {
        appendRunEvent({
          lane: 'primary',
          phase: 'error',
          message: 'Confirmed plan execution failed',
        });
        updateMessage(plannerStatusId, (m) =>
          m.type === 'status'
            ? { ...m, content: 'Execution failed during planning/execution stage.', status: 'error' }
            : m
        );
        appendMessages([
          {
            id: createId(),
            type: 'status',
            sender: 'bot',
            content: 'Tool execution failed. Please adjust the request and try again.',
            status: 'error',
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsTyping(false);
      }
    },
    [
      appendMessages,
      conversationHistory,
      updateMessage,
      appendPlannerStatusLog,
      options,
      deriveAppActionsFromExecutedCalls,
      extractPendingFilterSelection,
    ]
  );

  const autoRunFilterSelection = useCallback(
    async (selection: PendingFilterSelection) => {
      const selectedValues = selectAutoFilterValues(selection.values);
      if (selectedValues.length === 0) return;

      appendMessages([
        {
          id: createId(),
          type: 'status',
          sender: 'bot',
          content: `Resolved ${selection.argName} automatically: ${selectedValues.join(', ')}`,
          status: 'info',
          timestamp: new Date(),
        },
      ]);

      const calls: ParsedFunctionCall[] = selectedValues.map((value) => ({
        name: selection.toolName,
        args: { [selection.argName]: value },
      }));
      await runConfirmedToolPlan({
        calls,
        summary: `Planned actions:\n${calls
          .map((call, idx) => `${idx + 1}. ${call.name}(${selection.argName}=${JSON.stringify(call.args[selection.argName])})`)
          .join('\n')}`,
        sourceUserMessage: selection.sourceUserMessage,
      });
    },
    [appendMessages, runConfirmedToolPlan, selectAutoFilterValues]
  );

  const sendMessage = useCallback(
    async (
      text: string,
      requestOptions?: { requestText?: string }
    ) => {
      return enqueuePrimary(async () => {
      const trimmed = text.trim();
      if (!trimmed) return;
      appendRunEvent({
        lane: 'primary',
        phase: 'input',
        message: trimmed,
      });
      const modelRequestText = (requestOptions?.requestText || trimmed).trim() || trimmed;

      const pendingFilterSelection = pendingFilterSelectionRef.current;
      if (pendingFilterSelection) {
        pendingFilterSelectionRef.current = null;
        await autoRunFilterSelection(pendingFilterSelection);
        return;
      }

      const pending = pendingToolPlanRef.current;
      if (pending) {
        const lower = trimmed.toLowerCase();
        const normalized = lower
          .replace(/[^\w\s']/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const tokenCount = normalized ? normalized.split(' ').length : 0;
        const isConfirmText = new Set([
          'yes',
          'y',
          'confirm',
          'run it',
          'do it',
          'proceed',
          'go ahead',
          'ok',
          'okay',
          'save',
          'save them',
          'persist',
          'continue',
          'yes please',
          'confirm please',
        ]).has(normalized);
        const isDenyText = new Set([
          'no',
          'n',
          'deny',
          'cancel',
          'stop',
          'abort',
          "don't",
          'do not',
        ]).has(normalized);
        const looksLikeRefinement = ['instead', 'change', 'update', 'refine', 'adjust', 'not', 'only', 'but', 'with']
          .some((hint) => normalized.includes(hint));
        const looksLikeNewRequest = tokenCount >= 3 && !isConfirmText && !isDenyText && !looksLikeRefinement;

        if (looksLikeNewRequest) {
          pendingToolPlanRef.current = null;
          pendingFilterSelectionRef.current = null;
        } else {
          const userMsgPending: ChatMessage = {
            id: createId(),
            type: 'text',
            sender: 'user',
            content: trimmed,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, userMsgPending]);

          if (isConfirmText) {
            pendingToolPlanRef.current = null;
            await runConfirmedToolPlan(pending);
            return;
          }
          if (isDenyText) {
            pendingToolPlanRef.current = null;
            appendMessages([
              {
                id: createId(),
                type: 'text',
                sender: 'bot',
                content: 'Plan canceled. Tell me how you want to adjust the task and I will re-plan.',
                timestamp: new Date(),
              },
            ]);
            return;
          }

          // Treat any other reply as refinement of the pending tool plan.
          setIsTyping(true);
          const plannerStatusId = createId();
          appendMessages([
            {
              id: plannerStatusId,
              type: 'status',
              sender: 'bot',
              content: 'Refining plan...',
              status: 'loading',
              timestamp: new Date(),
            },
          ]);
          try {
            const replan = await processLlmMessage(
              `Previous planned actions:\n${pending.summary}\n\nUser refinement:\n${trimmed}`,
              {
                conversationHistory,
                sessionState: sessionStateRef.current,
                forceModel: 'qwen3',
                phase: 'refining',
                requireToolConfirmation: true,
                pendingPlanSummary: pending.summary,
                onPlannerEvent: (message) => {
                  appendPlannerStatusLog(plannerStatusId, message);
                },
              }
            );
            const confirmation = replan.confirmation;
            if (confirmation?.required) {
              const plannerMetaMessages: ChatMessage[] = [];
              if (replan.debugTrace && SHOW_VERBOSE_CHAT_DEBUG) {
                const selected = replan.debugTrace.selectedTools.length > 0
                  ? replan.debugTrace.selectedTools.slice(0, 8).join(', ')
                  : 'none';
                plannerMetaMessages.push({
                  id: createId(),
                  type: 'status',
                  sender: 'bot',
                  content:
                    `Planner activity: route=${replan.debugTrace.routeReason}; ` +
                    `selected tools=${selected}; proposed ui_actions=${(confirmation.uiActions || []).length}; proposed calls=${confirmation.calls.length}`,
                  status: 'info',
                  timestamp: new Date(),
                });
              }
              pendingToolPlanRef.current = {
                uiActions: confirmation.uiActions || [],
                calls: confirmation.calls,
                summary: confirmation.summary,
                sourceUserMessage: trimmed,
                reactTrace: confirmation.traceSnapshot || replan.debugTrace?.reactTraceRaw || [],
                pendingTaskPlan: confirmation.pendingTaskPlan,
              };
              pendingFilterSelectionRef.current = null;
              setConversationHistory(replan.updatedHistory);
              sessionStateRef.current = replan.sessionState || sessionStateRef.current;
              appendMessages([
                ...plannerMetaMessages,
                {
                  id: createId(),
                  type: 'text',
                  sender: 'bot',
                  content: 'Confirm to run these planned actions?',
                  timestamp: new Date(),
                },
                {
                  id: createId(),
                  type: 'action_buttons',
                  sender: 'bot',
                  content: 'Choose next step:',
                  timestamp: new Date(),
                  buttons: [
                    { label: 'Confirm', value: 'tool_plan_confirm', variant: 'primary' },
                    { label: 'Deny', value: 'tool_plan_deny', variant: 'danger' },
                  ],
                },
              ]);
              updateMessage(plannerStatusId, (m) =>
                m.type === 'status'
                  ? {
                      ...m,
                      content: 'Refined plan ready for confirmation.',
                      details: m.details
                        ? `${m.details}\n\n${confirmation.summary}`
                        : confirmation.summary,
                      status: 'info',
                    }
                  : m
              );
            }
          } catch {
            updateMessage(plannerStatusId, (m) =>
              m.type === 'status'
                ? { ...m, content: 'Failed to refine the plan.', status: 'error' }
                : m
            );
            appendMessages([
              {
                id: createId(),
                type: 'status',
                sender: 'bot',
                content: 'Failed to update the plan from your reply.',
                status: 'error',
                timestamp: new Date(),
              },
            ]);
          } finally {
            setIsTyping(false);
          }
          return;
        }
      }
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
        const slashIntentMessage = parseSlashCommand(trimmed);
        if (slashIntentMessage) {
          const result = await processWorkflowMessage(
            slashIntentMessage,
            activeWorkflowRef.current,
            {
              recentReplies: options?.recentReplies,
              stats: options?.stats,
              emailStats: options?.emailStats,
              backgroundTasks,
            },
            getWorkflowCallbacks()
          );
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
        } else if (trimmed.startsWith('/')) {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'Unknown slash command. Type "/" to see available intent commands.',
              status: 'info',
              timestamp: new Date(),
            },
          ]);
        } else {
          const plannerStatusId = createId();
          appendMessages([
            {
              id: plannerStatusId,
              type: 'status',
              sender: 'bot',
              content: 'Planning next actions...',
              status: 'loading',
              timestamp: new Date(),
            },
          ]);
          const result = await processLlmMessage(modelRequestText, {
            conversationHistory,
            sessionState: sessionStateRef.current,
            phase: 'planning',
            requireToolConfirmation: true,
            onPlannerEvent: (message) => {
              appendPlannerStatusLog(plannerStatusId, message);
            },
            onToolCall: (name) => {
              appendRunEvent({
                lane: 'primary',
                phase: 'tool_call',
                message: name,
              });
              appendPlannerStatusLog(plannerStatusId, `Running ${name.replace(/_/g, ' ')}...`);
            },
          });
          const shouldKeepPlannerStatus =
            SHOW_VERBOSE_CHAT_DEBUG ||
            Boolean(result.debugTrace?.plannedSummary) ||
            Boolean(result.confirmation?.summary);

          if (shouldKeepPlannerStatus) {
            updateMessage(plannerStatusId, (m) =>
              m.type === 'status'
                ? {
                    ...m,
                    content: 'Planning completed.',
                    details: [
                      (m.details || '').trim(),
                      (result.debugTrace?.plannedSummary || result.confirmation?.summary || '').trim(),
                    ]
                      .filter(Boolean)
                      .join('\n\n'),
                    status: 'info',
                  }
                : m
            );
          } else {
            removeMessage(plannerStatusId);
          }
          if (result.debugTrace?.executionTrace && result.debugTrace.executionTrace.length > 0) {
            updateMessage(plannerStatusId, (m) =>
              m.type === 'status'
                ? {
                    ...m,
                    details: `${m.details || ''}\n\nExecution trace:\n${result.debugTrace?.executionTrace?.join('\n') || ''}`.trim(),
                  }
                : m
            );
          }
          const timingSummary = summarizeTraceTiming(result.debugTrace);
          if (timingSummary) {
            appendPlannerStatusLog(plannerStatusId, timingSummary);
            appendRunEvent({
              lane: 'primary',
              phase: 'info',
              message: timingSummary,
            });
          }
          if (result.appActions && result.appActions.length > 0 && options?.onAppActions) {
            await options.onAppActions(result.appActions);
            appendRunEvent({
              lane: 'primary',
              phase: 'info',
              message: `Executed ${result.appActions.length} planned UI action(s).`,
            });
          }
          if (result.debugTrace?.executedCalls && result.debugTrace.executedCalls.length > 0 && options?.onAppActions) {
            const actions = deriveAppActionsFromExecutedCalls(result.debugTrace.executedCalls);
            if (actions.length > 0) {
              await options.onAppActions(actions);
            }
          }
          if (result.debugTrace?.executedCalls && result.debugTrace.executedCalls.length > 0) {
            const pendingSelection = extractPendingFilterSelection(
              result.debugTrace.executedCalls,
              trimmed
            );
            if (pendingSelection) {
              pendingFilterSelectionRef.current = null;
              await autoRunFilterSelection(pendingSelection);
              return;
            }
          }

          if (result.confirmation?.required) {
            appendRunEvent({
              lane: 'primary',
              phase: 'confirmation',
              message: 'Plan awaiting confirmation',
              meta: {
                ui_actions: (result.confirmation.uiActions || []).length,
                calls: result.confirmation.calls.map((c) => c.name),
              },
            });
            if (result.messages.length > 0) {
              appendMessages(result.messages);
            }
            const plannerMetaMessages: ChatMessage[] = [];
            if (result.debugTrace && SHOW_VERBOSE_CHAT_DEBUG) {
              const selected = result.debugTrace.selectedTools.length > 0
                ? result.debugTrace.selectedTools.slice(0, 8).join(', ')
                : 'none';
              plannerMetaMessages.push({
                id: createId(),
                type: 'status',
                sender: 'bot',
                content:
                  `Planner activity: route=${result.debugTrace.routeReason}; ` +
                  `selected tools=${selected}; proposed ui_actions=${(result.confirmation.uiActions || []).length}; proposed calls=${result.confirmation.calls.length}`,
                status: 'info',
                timestamp: new Date(),
              });
            }
            pendingToolPlanRef.current = {
              uiActions: result.confirmation.uiActions || [],
              calls: result.confirmation.calls,
              summary: result.confirmation.summary,
              sourceUserMessage: trimmed,
              reactTrace: result.confirmation.traceSnapshot || result.debugTrace?.reactTraceRaw || [],
              pendingTaskPlan: result.confirmation.pendingTaskPlan,
            };
            pendingFilterSelectionRef.current = null;
            setConversationHistory(result.updatedHistory);
            sessionStateRef.current = result.sessionState || sessionStateRef.current;
            appendMessages([
              ...plannerMetaMessages,
              {
                id: createId(),
                type: 'text',
                sender: 'bot',
                content: 'Confirm to run these planned actions?',
                timestamp: new Date(),
              },
              {
                id: createId(),
                type: 'action_buttons',
                sender: 'bot',
                content: 'Choose next step:',
                timestamp: new Date(),
                buttons: [
                  { label: 'Confirm', value: 'tool_plan_confirm', variant: 'primary' },
                  { label: 'Deny', value: 'tool_plan_deny', variant: 'danger' },
                ],
              },
            ]);
            return;
          }

          if (result.debugTrace) {
            const trace = result.debugTrace;
            if (SHOW_VERBOSE_CHAT_DEBUG) {
              const switchText =
                trace.modelSwitches.length > 0
                  ? ` | switches: ${trace.modelSwitches.map((s) => `${s.from}->${s.to}`).join(', ')}`
                  : '';
              appendMessages([
                {
                  id: createId(),
                  type: 'status',
                  sender: 'bot',
                  content: `Tool brain: ${trace.toolBrainName} (${trace.toolBrainModel}) | route: ${trace.routeReason}${switchText}`,
                  status: 'info',
                  timestamp: new Date(),
                },
              ]);
            }
            void api.chat.trace({
              user_message: trimmed,
              route: trace.route,
              route_reason: trace.routeReason,
              model_used: trace.modelUsed,
              tool_brain_name: trace.toolBrainName,
              tool_brain_model: trace.toolBrainModel,
              tools_used: trace.toolsUsed,
              fallback_used: trace.fallbackUsed,
              success: trace.success,
              failure_reason: trace.failureReason,
              native_tool_calls: trace.nativeToolCalls,
              token_tool_calls: trace.tokenToolCalls,
              selected_tools: trace.selectedTools,
              model_switches: trace.modelSwitches,
              response_preview: (result.response || '').slice(0, 300),
            }).catch(() => undefined);
          }

          setConversationHistory(result.updatedHistory);
          sessionStateRef.current = result.sessionState || sessionStateRef.current;
          appendMessages(result.messages);
        }
      } catch {
        appendRunEvent({
          lane: 'primary',
          phase: 'error',
          message: 'sendMessage failed',
        });
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
      } finally {
        setIsTyping(false);
      }
      });
    },
    [
      enqueuePrimary,
      appendMessages,
      backgroundTasks,
      closeBrowserViewer,
      conversationHistory,
      getWorkflowCallbacks,
      openBrowserViewer,
      options,
      removeMessage,
      runConfirmedToolPlan,
      appendPlannerStatusLog,
      deriveAppActionsFromExecutedCalls,
      extractPendingFilterSelection,
      autoRunFilterSelection,
    ]
  );

  const handleAction = useCallback(
    async (actionValue: string) => {
      return enqueuePrimary(async () => {
      appendRunEvent({
        lane: 'primary',
        phase: 'input',
        message: `action:${actionValue}`,
      });
      const parts = actionValue.split('::');
      let baseAction = parts[0] || actionValue;
      const src = parts.find((p) => p.startsWith('src='))?.slice(4);
      if (baseAction.startsWith('retry_send_email_contact:')) {
        const rawId = baseAction.split(':')[1] || '';
        const contactId = Number.parseInt(rawId, 10);
        if (!Number.isFinite(contactId) || contactId <= 0) {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'Invalid retry target.',
              status: 'error',
              timestamp: new Date(),
            },
          ]);
          return;
        }
        baseAction = `contact_action:send_email:${contactId}`;
      }
      if (baseAction.startsWith('email_discovery_for_contact:')) {
        const rawId = baseAction.split(':')[1] || '';
        const contactId = Number.parseInt(rawId, 10);
        if (!Number.isFinite(contactId) || contactId <= 0) {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'Invalid contact for email discovery.',
              status: 'error',
              timestamp: new Date(),
            },
          ]);
          return;
        }
        setIsTyping(true);
        try {
          await api.runEmailDiscovery();
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'Email discovery started. This may take a minute.',
              status: 'info',
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'After discovery finishes, retry send:',
              timestamp: new Date(),
              buttons: [
                { label: 'Retry Send', value: `retry_send_email_contact:${contactId}`, variant: 'primary' },
              ],
            },
          ]);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to start email discovery';
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Email discovery failed: ${message}`,
              status: 'error',
              timestamp: new Date(),
            },
          ]);
        } finally {
          setIsTyping(false);
        }
        return;
      }
      if (baseAction === 'dismiss_email_discovery') {
        if (src) removeMessage(src);
        return;
      }
      if (baseAction.startsWith('pick_contact_for_email:')) {
        const rawId = baseAction.split(':')[1] || '';
        const contactId = Number.parseInt(rawId, 10);
        if (!Number.isFinite(contactId) || contactId <= 0) {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'Invalid contact selection.',
              status: 'error',
              timestamp: new Date(),
            },
          ]);
          return;
        }
        if (src) {
          updateMessage(src, (m) =>
            m.type === 'action_buttons'
              ? { ...m, content: `Selected contact #${contactId}.`, buttons: [] }
              : m
          );
        }
        baseAction = `contact_action:send_email:${contactId}`;
      }
      if (baseAction.startsWith('pick_entity:')) {
        const parts = baseAction.split(':');
        const entityType = (parts[1] || '').trim().toLowerCase();
        const entityId = (parts[2] || '').trim();
        if (!entityType || !entityId) {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'Invalid entity selection.',
              status: 'error',
              timestamp: new Date(),
            },
          ]);
          return;
        }
        const current = sessionStateRef.current;
        if (current?.entities && current.entities.length > 0) {
          const selected = current.entities.find(
            (entity) =>
              entity.entityType.toLowerCase() === entityType &&
              String(entity.entityId) === entityId
          );
          if (selected) {
            sessionStateRef.current = {
              ...current,
              activeEntity: { ...selected, updatedAt: Date.now() },
              entities: [
                { ...selected, updatedAt: Date.now() },
                ...current.entities.filter(
                  (entity) =>
                    !(
                      entity.entityType.toLowerCase() === entityType &&
                      String(entity.entityId) === entityId
                    )
                ),
              ],
            };
          }
        }
        if (src) {
          updateMessage(src, (m) =>
            m.type === 'action_buttons'
              ? { ...m, content: `Selected ${entityType} #${entityId}.`, buttons: [] }
              : m
          );
        }
        appendMessages([
          {
            id: createId(),
            type: 'status',
            sender: 'bot',
            content: `Selected ${entityType} #${entityId}. Continue with your request.`,
            status: 'success',
            timestamp: new Date(),
          },
        ]);
        return;
      }

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

      if (baseAction === 'connect_outlook') {
        return;
      }
      if (baseAction === 'tool_plan_confirm') {
        const pending = pendingToolPlanRef.current;
        if (!pending) {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'No pending tool plan to confirm.',
              status: 'info',
              timestamp: new Date(),
            },
          ]);
          return;
        }
        pendingToolPlanRef.current = null;
        pendingFilterSelectionRef.current = null;
        await runConfirmedToolPlan(pending);
        return;
      }
      if (baseAction === 'tool_plan_deny') {
        pendingToolPlanRef.current = null;
        pendingFilterSelectionRef.current = null;
        appendMessages([
          {
            id: createId(),
            type: 'text',
            sender: 'bot',
            content: 'Plan canceled. Tell me how you want to adjust the task and I will re-plan.',
            timestamp: new Date(),
          },
        ]);
        return;
      }
      if (baseAction === 'dismiss_outlook') {
        if (src) removeMessage(src);
        return;
      }

      const isContactDbPromptAction = baseAction === 'add_contact' || baseAction === 'cancel';
      if (src && isContactDbPromptAction) {
        const original = messages.find((m) => m.id === src);
        if (original) optimisticButtonsRef.current[src] = original;

        updateMessage(src, (m) => {
          if (m.type !== 'action_buttons') return m;
          const nextContent = baseAction === 'add_contact' ? 'Saving...' : 'Skipped';
          return {
            ...m,
            content: nextContent,
            buttons: [],
          };
        });
      }

      setIsTyping(true);

      try {
        if (
          (activeWorkflowRef.current && activeWorkflowRef.current.status === 'waiting_user') ||
          baseAction.startsWith('contact_action:')
        ) {
          const workflowResult = await processWorkflowAction(
            baseAction,
            activeWorkflowRef.current,
            getWorkflowCallbacks()
          );
          activeWorkflowRef.current = workflowResult.workflow;
          appendMessages(workflowResult.messages);

          if (workflowResult.expandSection && options?.onExpandSection) {
            options.onExpandSection(workflowResult.expandSection);
          }
          if (workflowResult.openBrowserViewer) {
            openBrowserViewer();
          }
          if (workflowResult.closeBrowserViewer) {
            if (workflowResult.openBrowserViewer) {
              setTimeout(() => closeBrowserViewer(), 600);
            } else {
              closeBrowserViewer();
            }
          }
        } else {
          const result = await processLlmAction(baseAction, conversationHistory, sessionStateRef.current);
          setConversationHistory(result.updatedHistory);
          sessionStateRef.current = result.sessionState || sessionStateRef.current;
          appendMessages(result.messages);
        }

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
      } finally {
        setIsTyping(false);
      }
      });
    },
    [
      enqueuePrimary,
      appendMessages,
      closeBrowserViewer,
      conversationHistory,
      getWorkflowCallbacks,
      messages,
      openBrowserViewer,
      options,
      removeMessage,
      runConfirmedToolPlan,
      updateMessage,
    ]
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
            content: "Couldn't search Salesforce right now - the browser is busy. I'll try again when it's free.",
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
    browserViewerOpen,
    closeBrowserViewer,
    backgroundTasks,
    addBackgroundTask,
    updateBackgroundTask,
    getBackgroundTasks,
  };
}
