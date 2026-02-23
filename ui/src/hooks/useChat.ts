import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  processAction as processLlmAction,
  processMessage as processLlmMessage,
  type ChatCompletionMessageParam,
  type ChatSessionState,
} from '../chat/chatEngine';
import type { ChatEngineResult } from '../chat/chatEngine/pipelineTypes';
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
  ThoughtPhase,
  ThoughtUIState,
  ThoughtToolActivity,
  Workflow,
} from '../types/chat';
import type { ChatAction } from '../chat/actions';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';
import { areAllPlannedCallsReadOnly } from '../chat/chatEnginePolicy';

let _counter = 0;
function createId() {
  return `msg-${Date.now()}-${++_counter}`;
}

type WorkflowResultPreview = {
  company?: string;
  vp?: string;
  title?: string;
  signal?: string;
};

function pickPreview(result: unknown): WorkflowResultPreview | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  const company =
    (typeof row.company_name === 'string' && row.company_name.trim()) ||
    (typeof row.company === 'string' && row.company.trim()) ||
    (typeof row.name === 'string' && row.name.trim()) ||
    '';
  const vp =
    (typeof row.vp_name === 'string' && row.vp_name.trim()) ||
    (typeof row.full_name === 'string' && row.full_name.trim()) ||
    (typeof row.name === 'string' && row.name.trim()) ||
    '';
  const title =
    (typeof row.title === 'string' && row.title.trim()) ||
    (typeof row.vp_title === 'string' && row.vp_title.trim()) ||
    '';
  const signal =
    (typeof row.signal === 'string' && row.signal.trim()) ||
    (typeof row.signal_summary === 'string' && row.signal_summary.trim()) ||
    (typeof row.reason === 'string' && row.reason.trim()) ||
    '';
  if (!company && !vp && !title && !signal) return null;
  return { company: company || undefined, vp: vp || undefined, title: title || undefined, signal: signal || undefined };
}

function summarizeCompoundCompleted(payload: Record<string, unknown>): string {
  const workflowId = typeof payload.workflow_id === 'string' ? payload.workflow_id : '';
  const totalResultsRaw = Number(payload.total_results ?? 0);
  const totalResults = Number.isFinite(totalResultsRaw) ? Math.max(0, Math.round(totalResultsRaw)) : 0;
  const rows = Array.isArray(payload.results) ? payload.results : [];
  const previews = rows.map((row) => pickPreview(row)).filter((row): row is WorkflowResultPreview => Boolean(row)).slice(0, 5);
  const lines: string[] = [];
  lines.push(`Compound workflow ${workflowId || '(unknown)'} completed.`);
  lines.push(totalResults > 0 ? `Found ${totalResults} matching result${totalResults === 1 ? '' : 's'}.` : 'Completed with 0 qualifying results.');
  if (previews.length > 0) {
    lines.push('Top results:');
    for (const item of previews) {
      const left = [item.company, item.vp].filter(Boolean).join(' | ');
      const right = [item.title, item.signal].filter(Boolean).join(' | ');
      lines.push(`- ${[left, right].filter(Boolean).join(' - ')}`);
    }
  }
  lines.push('You can also review full workflow details in /tasks.');
  return lines.join('\n');
}

function summarizeCompoundFailed(workflowId: string, payload: Record<string, unknown>): string {
  const err = payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
    ? (payload.error as Record<string, unknown>)
    : {};
  const code = typeof err.code === 'string' ? err.code.trim() : '';
  const message = typeof err.message === 'string' ? err.message.trim() : '';
  const phase = typeof payload.current_phase_id === 'string' ? payload.current_phase_id : '';
  const summary = [code, message].filter(Boolean).join(': ') || 'Unknown error';
  const phaseText = phase ? ` in phase "${phase}"` : '';
  return `Compound workflow ${workflowId || '(unknown)'} failed${phaseText}: ${summary}\nYou can inspect full error details in /tasks.`;
}

function extractCompoundWorkflowIdsFromText(text: string): string[] {
  const out: string[] = [];
  if (!text || typeof text !== 'string') return out;
  const re = /compound workflow\s+([a-z0-9-]{8,})/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text)) !== null) {
    const id = String(m[1] || '').trim();
    if (id) out.push(id);
  }
  return [...new Set(out)];
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

const INITIAL_THOUGHT_STATE: ThoughtUIState = {
  phase: 'idle',
  display_mode: 'none',
  title: '',
  summary: '',
  steps: [],
  toolActivity: [],
  visible: false,
  allowAnswerNow: false,
};

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

function truncateReasoningLine(value: string, max = 240): string {
  const text = (value || '').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function buildReasoningSummary(trace: ChatEngineResult['debugTrace']): string[] {
  if (!trace) return [];
  const lines: string[] = [];
  lines.push(`Route: ${trace.routeReason} (${trace.route})`);
  lines.push(`Model: ${trace.modelUsed}`);
  if (trace.plannedSummary) {
    lines.push(`Plan: ${truncateReasoningLine(trace.plannedSummary, 300)}`);
  }
  if (trace.reactTrace && trace.reactTrace.length > 0) {
    for (const step of trace.reactTrace.slice(0, 6)) {
      const thought = truncateReasoningLine(step.thought);
      if (thought) lines.push(`Step ${step.step} thought: ${thought}`);
      if (step.actions.length > 0) lines.push(`Step ${step.step} actions: ${step.actions.join(', ')}`);
      if (step.reflection) lines.push(`Step ${step.step} reflection: ${truncateReasoningLine(step.reflection)}`);
    }
  } else if (trace.executionTrace && trace.executionTrace.length > 0) {
    for (const line of trace.executionTrace.slice(0, 8)) {
      lines.push(`Execution: ${truncateReasoningLine(line)}`);
    }
  }
  return lines.slice(0, 24);
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
  const [thoughtState, setThoughtState] = useState<ThoughtUIState>(INITIAL_THOUGHT_STATE);
  const [isTyping, setIsTyping] = useState(false);
  const [assistantStreamingText, setAssistantStreamingText] = useState('');
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
  const pendingDocumentAssumptionEditRef = useRef<{
    documentId: string;
    promptMessageId?: string;
  } | null>(null);
  const pendingDocumentQuestionScopeRef = useRef<string | null>(null);
  const documentPollersRef = useRef<Record<string, number>>({});
  const pendingFilterSelectionRef = useRef<PendingFilterSelection | null>(null);
  const sfPollersRef = useRef<Record<number, number>>({});
  const compoundPollersRef = useRef<Record<string, number>>({});
  const compoundTerminalSeenRef = useRef<Set<string>>(new Set());
  const optimisticButtonsRef = useRef<Record<string, ChatMessage | undefined>>({});
  const primaryLaneRef = useRef<Promise<void>>(Promise.resolve());
  const thoughtRevealTimerRef = useRef<number | null>(null);
  const thoughtPanelTimerRef = useRef<number | null>(null);
  const sawAssistantTokenRef = useRef(false);
  const typingStartedAtRef = useRef(0);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    return () => {
      if (thoughtRevealTimerRef.current) {
        window.clearTimeout(thoughtRevealTimerRef.current);
        thoughtRevealTimerRef.current = null;
      }
      if (thoughtPanelTimerRef.current) {
        window.clearTimeout(thoughtPanelTimerRef.current);
        thoughtPanelTimerRef.current = null;
      }
      for (const id of Object.keys(compoundPollersRef.current)) {
        window.clearInterval(compoundPollersRef.current[id]);
      }
      compoundPollersRef.current = {};
      for (const id of Object.keys(documentPollersRef.current)) {
        window.clearInterval(documentPollersRef.current[id]);
      }
      documentPollersRef.current = {};
    };
  }, []);

  const appendMessages = useCallback((newMessages: ChatMessage[]) => {
    setMessages((prev) => [...prev, ...newMessages]);
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const updateMessage = useCallback((id: string, updater: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const setThoughtPhase = useCallback((phase: ThoughtPhase, fields?: Partial<ThoughtUIState>, forceVisible = false) => {
    setThoughtState((prev) => ({
      ...prev,
      phase,
      ...(fields || {}),
      visible: forceVisible ? true : (fields?.visible ?? prev.visible),
      display_mode: forceVisible
        ? (prev.display_mode === 'none' ? 'micro' : prev.display_mode)
        : (fields?.display_mode ?? prev.display_mode),
    }));
  }, []);

  const startThought = useCallback((title: string, summary: string) => {
    if (thoughtRevealTimerRef.current) {
      window.clearTimeout(thoughtRevealTimerRef.current);
      thoughtRevealTimerRef.current = null;
    }
    if (thoughtPanelTimerRef.current) {
      window.clearTimeout(thoughtPanelTimerRef.current);
      thoughtPanelTimerRef.current = null;
    }
    const now = Date.now();
    setThoughtState({
      phase: 'planning',
      display_mode: 'none',
      title,
      summary,
      steps: [],
      toolActivity: [],
      visible: false,
      allowAnswerNow: false,
      startedAtMs: now,
    });
    thoughtRevealTimerRef.current = window.setTimeout(() => {
      setThoughtState((prev) => {
        if (prev.phase === 'complete' || prev.phase === 'idle') return prev;
        return { ...prev, visible: true, display_mode: 'micro' };
      });
      thoughtRevealTimerRef.current = null;
    }, 500);
    thoughtPanelTimerRef.current = window.setTimeout(() => {
      setThoughtState((prev) => {
        if (prev.phase === 'complete' || prev.phase === 'idle') return prev;
        return { ...prev, visible: true, display_mode: 'panel' };
      });
      thoughtPanelTimerRef.current = null;
    }, 2000);
  }, []);

  const appendThoughtStep = useCallback((step: string) => {
    const line = String(step || '').trim();
    if (!line) return;
    setThoughtState((prev) => {
      const next = prev.steps.filter((s) => s !== line);
      next.push(line);
      return {
        ...prev,
        steps: next.slice(-6),
      };
    });
  }, []);

  const updateThoughtTool = useCallback((name: string, status: ThoughtToolActivity['status']) => {
    const label = name.replace(/_/g, ' ').trim();
    if (!label) return;
    setThoughtState((prev) => {
      const current = prev.toolActivity.filter((row) => row.name !== label);
      current.push({ name: label, status });
      return {
        ...prev,
        phase: 'tool_running',
        visible: true,
        display_mode: prev.display_mode === 'none' ? 'micro' : prev.display_mode,
        toolActivity: current.slice(-8),
      };
    });
  }, []);

  const completeThought = useCallback(() => {
    if (thoughtRevealTimerRef.current) {
      window.clearTimeout(thoughtRevealTimerRef.current);
      thoughtRevealTimerRef.current = null;
    }
    if (thoughtPanelTimerRef.current) {
      window.clearTimeout(thoughtPanelTimerRef.current);
      thoughtPanelTimerRef.current = null;
    }
    setThoughtState(INITIAL_THOUGHT_STATE);
  }, []);

  const suppressThoughtForStreaming = useCallback(() => {
    if (thoughtRevealTimerRef.current) {
      window.clearTimeout(thoughtRevealTimerRef.current);
      thoughtRevealTimerRef.current = null;
    }
    if (thoughtPanelTimerRef.current) {
      window.clearTimeout(thoughtPanelTimerRef.current);
      thoughtPanelTimerRef.current = null;
    }
    setThoughtState(INITIAL_THOUGHT_STATE);
  }, []);

  const resetAssistantStreaming = useCallback(() => {
    sawAssistantTokenRef.current = false;
    setAssistantStreamingText('');
  }, []);

  const handleAssistantToken = useCallback((token: string) => {
    if (!token) return;
    if (!sawAssistantTokenRef.current) {
      sawAssistantTokenRef.current = true;
      suppressThoughtForStreaming();
    }
    setAssistantStreamingText((prev) => prev + token);
  }, [suppressThoughtForStreaming]);

  const beginTyping = useCallback(() => {
    typingStartedAtRef.current = Date.now();
    setIsTyping(true);
  }, []);

  const endTyping = useCallback(async () => {
    const elapsed = Date.now() - typingStartedAtRef.current;
    const minWindowMs = 150;
    if (elapsed < minWindowMs) {
      await new Promise((resolve) => window.setTimeout(resolve, minWindowMs - elapsed));
    }
    setIsTyping(false);
  }, []);

  const sleep = useCallback((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)), []);

  const maybeStreamFallbackAssistantText = useCallback(
    async (resultMessages: ChatMessage[], fallbackText?: string) => {
      if (sawAssistantTokenRef.current) return;
      const firstBotText = resultMessages.find(
        (m) =>
          m.sender === 'bot' &&
          m.type === 'text' &&
          'content' in m &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0
      );
      const content =
        ((firstBotText && 'content' in firstBotText && typeof firstBotText.content === 'string' ? firstBotText.content : '') ||
          fallbackText ||
          '').trim();
      if (!content) return;

      sawAssistantTokenRef.current = true;
      suppressThoughtForStreaming();

      const chars = Array.from(content);
      const chunkSize = Math.max(2, Math.ceil(chars.length / 28));
      let cursor = 0;
      while (cursor < chars.length) {
        const next = Math.min(chars.length, cursor + chunkSize);
        setAssistantStreamingText(chars.slice(0, next).join(''));
        cursor = next;
        await sleep(18);
      }
      await sleep(90);
    },
    [sleep, suppressThoughtForStreaming]
  );

  const appendPlannerStatusLog = useCallback((message: string) => {
    appendRunEvent({
      lane: 'primary',
      phase: 'planner_event',
      message,
    });
    appendThoughtStep(message);
  }, [appendThoughtStep]);

  const appendReasoningTrace = useCallback((trace: ChatEngineResult['debugTrace'], source: 'planning' | 'executing') => {
    const summary = buildReasoningSummary(trace);
    if (summary.length === 0) return;
    appendRunEvent({
      lane: 'primary',
      phase: 'reasoning',
      message: `LLM reasoning (${source})`,
      meta: {
        source,
        route: trace?.route,
        route_reason: trace?.routeReason,
        model: trace?.modelUsed,
        summary,
      },
    });
  }, []);

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
      const exactNameOnlyLookup =
        typeof args.name === 'string' &&
        args.name.trim().length > 0 &&
        (typeof args.company !== 'string' || args.company.trim().length === 0) &&
        (typeof args.query !== 'string' || args.query.trim().length === 0) &&
        args.has_email == null &&
        args.today_only == null;
      if (exactNameOnlyLookup) {
        return [];
      }
      pushFilter(actions, 'q', args.name);
      pushFilter(actions, 'company', args.company);
      pushFilter(actions, 'hasEmail', args.has_email);
      return actions;
    }

    const searchCompanies = successful.find((x) => x.name === 'search_companies');
    if (searchCompanies) {
      actions.push({ type: 'navigate', to: '/companies' });
      const args = searchCompanies.args || {};
      const exactCompanyOnlyLookup =
        typeof args.company_name === 'string' &&
        args.company_name.trim().length > 0 &&
        (typeof args.q !== 'string' || args.q.trim().length === 0) &&
        (typeof args.vertical !== 'string' || args.vertical.trim().length === 0) &&
        (typeof args.tier !== 'string' || args.tier.trim().length === 0);
      if (exactCompanyOnlyLookup) {
        return [];
      }
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

  const startCompoundWorkflowPolling = useCallback((workflowId: string) => {
    const normalizedId = workflowId.trim();
    if (!normalizedId) return;
    if (compoundPollersRef.current[normalizedId]) return;

    const poll = async () => {
      try {
        const status = await api.getCompoundWorkflowStatus(normalizedId);
        if (!status || status.ok !== true) return;
        const state = String(status.status || '').toLowerCase();
        if (!['completed', 'failed', 'cancelled'].includes(state)) return;

        if (compoundTerminalSeenRef.current.has(normalizedId)) {
          const existing = compoundPollersRef.current[normalizedId];
          if (existing) {
            window.clearInterval(existing);
            delete compoundPollersRef.current[normalizedId];
          }
          return;
        }
        compoundTerminalSeenRef.current.add(normalizedId);

        const terminalEvent = Array.isArray(status.events)
          ? status.events.find((ev) => String(ev?.type || '').toLowerCase() === state)
          : null;
        const payload = terminalEvent && terminalEvent.payload && typeof terminalEvent.payload === 'object'
          ? (terminalEvent.payload as Record<string, unknown>)
          : (status as unknown as Record<string, unknown>);

        const content =
          state === 'completed'
            ? summarizeCompoundCompleted(payload)
            : summarizeCompoundFailed(normalizedId, status as unknown as Record<string, unknown>);

        appendMessages([
          {
            id: createId(),
            type: 'text',
            sender: 'bot',
            content,
            timestamp: new Date(),
          },
        ]);

        const intervalId = compoundPollersRef.current[normalizedId];
        if (intervalId) {
          window.clearInterval(intervalId);
          delete compoundPollersRef.current[normalizedId];
        }
      } catch {
        // keep polling silently
      }
    };

    const intervalId = window.setInterval(poll, 2500);
    compoundPollersRef.current[normalizedId] = intervalId;
    void poll();
  }, [appendMessages]);

  const trackCompoundWorkflowRuns = useCallback((executedCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean; result?: unknown }>) => {
    const runs = executedCalls
      .filter((call) => call.ok && call.name === 'compound_workflow_run' && call.result && typeof call.result === 'object')
      .map((call) => call.result as Record<string, unknown>)
      .map((payload) => (typeof payload.workflow_id === 'string' ? payload.workflow_id.trim() : ''))
      .filter(Boolean);
    for (const workflowId of runs) {
      startCompoundWorkflowPolling(workflowId);
    }
  }, [startCompoundWorkflowPolling]);

  const trackCompoundWorkflowRunsFromMessages = useCallback((msgs: ChatMessage[], responseText?: string) => {
    const ids: string[] = [];
    for (const msg of msgs || []) {
      if (msg.type === 'text' || msg.type === 'status') {
        ids.push(...extractCompoundWorkflowIdsFromText(msg.content || ''));
      }
      if (msg.type === 'status' && msg.details) {
        ids.push(...extractCompoundWorkflowIdsFromText(msg.details));
      }
    }
    if (responseText) {
      ids.push(...extractCompoundWorkflowIdsFromText(responseText));
    }
    for (const workflowId of [...new Set(ids)]) {
      startCompoundWorkflowPolling(workflowId);
    }
  }, [startCompoundWorkflowPolling]);

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
      beginTyping();
      resetAssistantStreaming();
      startThought('Executing confirmed plan', 'Applying approved actions and collecting outputs.');
      try {
        appendThoughtStep('Preparing execution');
        if ((pending.uiActions || []).length > 0 && options?.onAppActions) {
          await options.onAppActions(pending.uiActions || []);
          appendPlannerStatusLog(`Executed ${(pending.uiActions || []).length} UI action(s).`);
        }
        if ((pending.calls || []).length === 0) {
          appendThoughtStep('Execution completed');
          return;
        }
        const result = await processLlmMessage(pending.sourceUserMessage, {
          conversationHistory,
          sessionState: sessionStateRef.current,
          forceModel: 'qwen3',
          phase: 'executing',
          debug: true,
          requireToolConfirmation: false,
          confirmedToolCalls: pending.calls,
          pendingTaskPlan: pending.pendingTaskPlan,
          _reactTrace: (pending.reactTrace || []) as any,
          onPlannerEvent: (message) => {
            appendPlannerStatusLog(message);
          },
          onAssistantToken: handleAssistantToken,
          onToolCall: (name) => {
            appendRunEvent({
              lane: 'primary',
              phase: 'tool_call',
              message: name,
            });
            updateThoughtTool(name, 'running');
            appendPlannerStatusLog(`Running ${name.replace(/_/g, ' ')}...`);
          },
        });
        setThoughtPhase('synthesizing', { summary: 'Synthesizing final response from executed steps.' }, true);
        appendThoughtStep('Execution completed');
        if (result.debugTrace?.executionTrace && result.debugTrace.executionTrace.length > 0) {
          appendRunEvent({
            lane: 'primary',
            phase: 'tool_result',
            message: 'Execution trace available',
            meta: { trace: result.debugTrace.executionTrace.slice(0, 20) },
          });
        }
        appendReasoningTrace(result.debugTrace, 'executing');
        const confirmedTiming = summarizeTraceTiming(result.debugTrace);
        if (confirmedTiming) {
          appendPlannerStatusLog(confirmedTiming);
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
          trackCompoundWorkflowRuns(result.debugTrace.executedCalls);
        }
        trackCompoundWorkflowRunsFromMessages(result.messages || [], result.response);
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
              content: pending.summary || 'Review and confirm the planned actions.',
              timestamp: new Date(),
              buttons: [
                { label: 'Confirm', value: 'tool_plan_confirm', variant: 'primary' },
                { label: 'Deny', value: 'tool_plan_deny', variant: 'danger' },
              ],
            },
          ]);
        }
        await maybeStreamFallbackAssistantText(result.messages, result.response);
        setConversationHistory(result.updatedHistory);
        sessionStateRef.current = result.sessionState || sessionStateRef.current;
        appendMessages(result.messages);
      } catch {
        appendRunEvent({
          lane: 'primary',
          phase: 'error',
          message: 'Confirmed plan execution failed',
        });
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
        completeThought();
        await endTyping();
      }
    },
    [
      appendMessages,
      conversationHistory,
      appendPlannerStatusLog,
      appendReasoningTrace,
      appendThoughtStep,
      options,
      deriveAppActionsFromExecutedCalls,
      extractPendingFilterSelection,
      setThoughtPhase,
      startThought,
      updateThoughtTool,
      completeThought,
      trackCompoundWorkflowRuns,
      trackCompoundWorkflowRunsFromMessages,
      handleAssistantToken,
      resetAssistantStreaming,
      beginTyping,
      endTyping,
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

  const summarizeDocumentAnalysis = useCallback((documentPayload: unknown): string => {
    if (!documentPayload || typeof documentPayload !== 'object') return 'Document analysis completed.';
    const doc = documentPayload as Record<string, unknown>;
    const filename = String(doc.filename || 'document');
    const status = String(doc.status || '');
    const docType = String(doc.document_type || 'other');
    const confidence = Number(doc.document_type_confidence || 0);
    const summary = typeof doc.summary === 'string' ? doc.summary.trim() : '';
    const entities = (doc.extracted_entities && typeof doc.extracted_entities === 'object')
      ? (doc.extracted_entities as Record<string, unknown>)
      : {};
    const companies = Array.isArray(entities.companies) ? entities.companies : [];
    const contacts = Array.isArray(entities.contacts) ? entities.contacts : [];
    const missingCompanies = companies.filter((c) => !c || typeof c !== 'object' || (c as Record<string, unknown>).matched_crm_id == null).length;
    const missingContacts = contacts.filter((c) => !c || typeof c !== 'object' || (c as Record<string, unknown>).matched_crm_id == null).length;

    const lines: string[] = [];
    lines.push(`Document analysis complete for **${filename}**.`);
    lines.push(`Type: ${docType}${confidence > 0 ? ` (${Math.round(confidence * 100)}%)` : ''}. Status: ${status || 'ready'}.`);
    if (summary) lines.push(summary);
    lines.push(
      `Entities: ${companies.length} companies (${missingCompanies} unmatched), ${contacts.length} contacts (${missingContacts} unmatched).`
    );
    return lines.join('\n');
  }, []);

  const createMissingRecordsForDocument = useCallback(async (documentId: string) => {
    const detail = await api.getDocument(documentId);
    const entitiesRaw = detail.document?.extracted_entities;
    const entities = (entitiesRaw && typeof entitiesRaw === 'object') ? entitiesRaw as Record<string, unknown> : {};
    const companies = Array.isArray(entities.companies) ? entities.companies : [];
    const contacts = Array.isArray(entities.contacts) ? entities.contacts : [];
    const createdCompanyIds: number[] = [];
    const createdContactIds: number[] = [];

    for (const item of companies) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (row.matched_crm_id != null) continue;
      const name = String(row.name || '').trim();
      if (!name) continue;
      try {
        const company = await api.addCompany({ company_name: name, status: 'pending' });
        if (typeof company.id === 'number') createdCompanyIds.push(company.id);
      } catch {
        // Ignore duplicates/failures and continue.
      }
    }

    let fallbackCompanyName = '';
    if (detail.document?.linked_company_name) fallbackCompanyName = String(detail.document.linked_company_name);
    if (!fallbackCompanyName && companies.length > 0 && companies[0] && typeof companies[0] === 'object') {
      fallbackCompanyName = String((companies[0] as Record<string, unknown>).name || '').trim();
    }

    for (const item of contacts) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (row.matched_crm_id != null) continue;
      const name = String(row.name || '').trim();
      if (!name) continue;
      try {
        const contact = await api.addContact({
          name,
          title: typeof row.title === 'string' ? row.title : undefined,
          company_name: typeof row.company === 'string' && row.company.trim() ? row.company : fallbackCompanyName || undefined,
        });
        if (typeof contact.id === 'number') createdContactIds.push(contact.id);
      } catch {
        // Ignore duplicates/failures and continue.
      }
    }

    return { createdCompanyIds, createdContactIds };
  }, []);

  const startDocumentProcessingPolling = useCallback((documentId: string, filename: string, statusMessageId?: string) => {
    if (documentPollersRef.current[documentId]) return;
    const seenStatuses = new Set<string>();
    const startedAt = Date.now();
    let readyAnnounced = false;

    const poll = async () => {
      try {
        const detail = await api.getDocument(documentId);
        const status = String(detail.document?.status || '').trim().toLowerCase();
        const statusLabel = status || 'pending';
        if (!seenStatuses.has(statusLabel)) {
          seenStatuses.add(statusLabel);
          if (statusMessageId) {
            updateMessage(statusMessageId, (message) =>
              message.type === 'status'
                ? {
                    ...message,
                    status: statusLabel === 'failed' ? 'error' : statusLabel === 'ready' ? 'success' : 'loading',
                    content:
                      statusLabel === 'ready'
                        ? `Processing complete: ${filename}`
                        : statusLabel === 'failed'
                          ? `Processing failed: ${filename}`
                          : `Processing ${filename}...`,
                    details: detail.document?.status_message || undefined,
                  }
                : message
            );
          }
        }

        if (statusLabel === 'ready' && !readyAnnounced) {
          readyAnnounced = true;
          appendMessages([
            {
              id: createId(),
              type: 'text',
              sender: 'bot',
              content: summarizeDocumentAnalysis(detail.document),
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'Are these assumptions correct?',
              timestamp: new Date(),
              buttons: [
                { label: 'Confirm & Link', value: `document_confirm_link:${documentId}`, variant: 'primary' },
                { label: 'Create Missing CRM Records', value: `document_create_missing:${documentId}`, variant: 'secondary' },
                { label: 'Edit Assumptions In Chat', value: `document_edit_assumptions:${documentId}`, variant: 'secondary' },
                { label: 'Save Without Linking', value: `document_save_without_link:${documentId}`, variant: 'secondary' },
              ],
            },
          ]);
          window.clearInterval(documentPollersRef.current[documentId]);
          delete documentPollersRef.current[documentId];
          return;
        }

        if (statusLabel === 'failed') {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Document processing failed for ${filename}.`,
              details: detail.document?.status_message || undefined,
              status: 'error',
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'Choose next step:',
              timestamp: new Date(),
              buttons: [
                { label: 'Retry Processing', value: `document_retry:${documentId}`, variant: 'primary' },
                { label: 'Open In Documents Page', value: `open_documents:${documentId}`, variant: 'secondary' },
              ],
            },
          ]);
          window.clearInterval(documentPollersRef.current[documentId]);
          delete documentPollersRef.current[documentId];
          return;
        }

        if (Date.now() - startedAt > 10 * 60 * 1000) {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Still processing ${filename}. You can continue working and come back later.`,
              status: 'info',
              timestamp: new Date(),
            },
          ]);
          window.clearInterval(documentPollersRef.current[documentId]);
          delete documentPollersRef.current[documentId];
        }
      } catch {
        // Best effort polling.
      }
    };

    documentPollersRef.current[documentId] = window.setInterval(poll, 2000);
    void poll();
  }, [appendMessages, summarizeDocumentAnalysis, updateMessage]);

  const uploadFiles = useCallback(async (files: File[]) => {
    return enqueuePrimary(async () => {
      const picked = (files || []).filter(Boolean);
      if (picked.length === 0) return;
      for (const file of picked) {
        appendMessages([
          {
            id: createId(),
            type: 'text',
            sender: 'user',
            content: `Uploaded file: ${file.name}`,
            timestamp: new Date(),
          },
        ]);
        const statusId = createId();
        appendMessages([
          {
            id: statusId,
            type: 'status',
            sender: 'bot',
            content: `Uploading ${file.name}...`,
            status: 'loading',
            timestamp: new Date(),
          },
        ]);
        try {
          const result = await api.uploadDocument(file);
          updateMessage(statusId, (message) =>
            message.type === 'status'
              ? {
                  ...message,
                  content: `Document uploaded: ${result.filename}. Starting analysis...`,
                  status: 'loading',
                }
              : message
          );
          startDocumentProcessingPolling(result.document_id, result.filename, statusId);
        } catch (error) {
          updateMessage(statusId, (message) =>
            message.type === 'status'
              ? {
                  ...message,
                  content: `Upload failed for ${file.name}`,
                  details: error instanceof Error ? error.message : 'Unknown error',
                  status: 'error',
                }
              : message
          );
        }
      }
    });
  }, [appendMessages, enqueuePrimary, startDocumentProcessingPolling, updateMessage]);

  const sendMessage = useCallback(
    async (
      text: string,
      requestOptions?: { requestText?: string }
    ) => {
      return enqueuePrimary(async () => {
      const trimmed = text.trim();
      if (!trimmed) return;
      resetAssistantStreaming();
      appendRunEvent({
        lane: 'primary',
        phase: 'input',
        message: trimmed,
      });
      const modelRequestText = (requestOptions?.requestText || trimmed).trim() || trimmed;

      const pendingDocEdit = pendingDocumentAssumptionEditRef.current;
      if (pendingDocEdit) {
        pendingDocumentAssumptionEditRef.current = null;
        const userMsgPending: ChatMessage = {
          id: createId(),
          type: 'text',
          sender: 'user',
          content: trimmed,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMsgPending]);
        beginTyping();
        try {
          const companyLine = (trimmed.match(/company\s*:\s*([^\n\r]+)/i)?.[1] || '').trim();
          const contactsLine = (trimmed.match(/contacts?\s*:\s*([^\n\r]+)/i)?.[1] || '').trim();
          const targetCompanyName = companyLine.toLowerCase() === 'none' ? '' : companyLine;
          const targetContactNames = contactsLine
            ? contactsLine.split(',').map((part) => part.trim()).filter(Boolean)
            : [];

          const [companies, contacts, detail] = await Promise.all([
            api.getCompanies(),
            api.getContacts(),
            api.getDocument(pendingDocEdit.documentId),
          ]);

          const resolveName = (needle: string, haystack: string[]) => {
            const low = needle.toLowerCase();
            const exact = haystack.findIndex((value) => value.toLowerCase() === low);
            if (exact >= 0) return exact;
            return haystack.findIndex((value) => value.toLowerCase().includes(low) || low.includes(value.toLowerCase()));
          };

          let companyId: number | undefined;
          if (targetCompanyName) {
            const idx = resolveName(targetCompanyName, companies.map((c) => c.company_name || ''));
            if (idx >= 0) companyId = companies[idx].id;
          } else if (detail.document?.linked_company_id != null) {
            companyId = Number(detail.document.linked_company_id);
          }

          const resolvedContactIds: number[] = [];
          for (const name of targetContactNames) {
            const idx = resolveName(name, contacts.map((c) => c.name || ''));
            if (idx >= 0 && typeof contacts[idx].id === 'number') {
              resolvedContactIds.push(contacts[idx].id);
            }
          }

          await api.linkDocumentToEntities({
            document_id: pendingDocEdit.documentId,
            company_id: companyId,
            contact_ids: resolvedContactIds,
          });

          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Updated assumptions saved for document ${pendingDocEdit.documentId}.`,
              details: `Linked company: ${companyId ?? 'none'} | Linked contacts: ${resolvedContactIds.length}`,
              status: 'success',
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'Anything else?',
              timestamp: new Date(),
              buttons: [
                { label: 'Ask This Document', value: `document_ask_prompt:${pendingDocEdit.documentId}`, variant: 'primary' },
                { label: 'Open Documents Page', value: `open_documents:${pendingDocEdit.documentId}`, variant: 'secondary' },
              ],
            },
          ]);
        } catch {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: 'Could not update document assumptions from that message.',
              details: 'Format example: company: Acme Corp\\ncontacts: Jane Doe, John Smith',
              status: 'error',
              timestamp: new Date(),
            },
          ]);
        } finally {
          await endTyping();
        }
        return;
      }

      const pendingQuestionDocId = pendingDocumentQuestionScopeRef.current;
      if (pendingQuestionDocId) {
        pendingDocumentQuestionScopeRef.current = null;
        const userMsgPending: ChatMessage = {
          id: createId(),
          type: 'text',
          sender: 'user',
          content: trimmed,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMsgPending]);
        beginTyping();
        try {
          const answer = await api.askDocuments({
            question: trimmed,
            document_ids: [pendingQuestionDocId],
          });
          const sources = (answer.sources || [])
            .map((source) => `${source.filename}${source.page ? ` (page ${source.page})` : ''}`)
            .slice(0, 5)
            .join(', ');
          appendMessages([
            {
              id: createId(),
              type: 'text',
              sender: 'bot',
              content: answer.answer || 'I could not find this information in the document.',
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: sources ? `Sources: ${sources}` : 'No source citations returned.',
              status: 'info',
              timestamp: new Date(),
            },
          ]);
        } catch {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Could not query document ${pendingQuestionDocId}.`,
              status: 'error',
              timestamp: new Date(),
            },
          ]);
        } finally {
          await endTyping();
        }
        return;
      }

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
          beginTyping();
          startThought('Refining plan', 'Updating the plan based on your feedback.');
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
                  appendPlannerStatusLog(message);
                },
                onAssistantToken: handleAssistantToken,
              }
            );
            const confirmation = replan.confirmation;
            if (confirmation?.required) {
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
                  content: confirmation.summary || 'Review and confirm the planned actions.',
                  timestamp: new Date(),
                  buttons: [
                    { label: 'Confirm', value: 'tool_plan_confirm', variant: 'primary' },
                    { label: 'Deny', value: 'tool_plan_deny', variant: 'danger' },
                  ],
                },
              ]);
              appendThoughtStep('Refined plan ready for confirmation');
            }
          } catch {
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
            completeThought();
            await endTyping();
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
      beginTyping();

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
          startThought('Analyzing request and preparing plan', 'Planning the best sequence of actions.');
          const result = await processLlmMessage(modelRequestText, {
            conversationHistory,
            sessionState: sessionStateRef.current,
            phase: 'planning',
            debug: true,
            requireToolConfirmation: true,
            onPlannerEvent: (message) => {
              appendPlannerStatusLog(message);
            },
            onAssistantToken: handleAssistantToken,
            onToolCall: (name) => {
              appendRunEvent({
                lane: 'primary',
                phase: 'tool_call',
                message: name,
              });
              updateThoughtTool(name, 'running');
              appendPlannerStatusLog(`Running ${name.replace(/_/g, ' ')}...`);
            },
          });
          setThoughtPhase('synthesizing', { summary: 'Synthesizing response from planned actions.' }, true);
          appendReasoningTrace(result.debugTrace, 'planning');
          const timingSummary = summarizeTraceTiming(result.debugTrace);
          if (timingSummary) {
            appendPlannerStatusLog(timingSummary);
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
            trackCompoundWorkflowRuns(result.debugTrace.executedCalls);
          }
          trackCompoundWorkflowRunsFromMessages(result.messages || [], result.response);
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
            const readOnlyConfirmation = areAllPlannedCallsReadOnly(result.confirmation.calls || []);
            if (readOnlyConfirmation) {
              pendingToolPlanRef.current = null;
              pendingFilterSelectionRef.current = null;
              appendMessages([
                {
                  id: createId(),
                  type: 'text',
                  sender: 'bot',
                  content: 'Running read-only plan now.',
                  timestamp: new Date(),
                },
              ]);
              await runConfirmedToolPlan({
                uiActions: result.confirmation.uiActions || [],
                calls: result.confirmation.calls,
                summary: result.confirmation.summary,
                sourceUserMessage: trimmed,
                reactTrace: result.confirmation.traceSnapshot || result.debugTrace?.reactTraceRaw || [],
                pendingTaskPlan: result.confirmation.pendingTaskPlan,
              });
              completeThought();
              return;
            }
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
                content: result.confirmation.summary || 'Review and confirm the planned actions.',
                timestamp: new Date(),
                buttons: [
                  { label: 'Confirm', value: 'tool_plan_confirm', variant: 'primary' },
                  { label: 'Deny', value: 'tool_plan_deny', variant: 'danger' },
                ],
              },
            ]);
            completeThought();
            return;
          }

          if (result.debugTrace) {
            const trace = result.debugTrace;
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

          await maybeStreamFallbackAssistantText(result.messages, result.response);
          setConversationHistory(result.updatedHistory);
          sessionStateRef.current = result.sessionState || sessionStateRef.current;
          appendMessages(result.messages);
          completeThought();
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
        completeThought();
      } finally {
        completeThought();
        await endTyping();
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
      appendReasoningTrace,
      appendThoughtStep,
      completeThought,
      deriveAppActionsFromExecutedCalls,
      extractPendingFilterSelection,
      autoRunFilterSelection,
      setThoughtPhase,
      startThought,
      trackCompoundWorkflowRuns,
      trackCompoundWorkflowRunsFromMessages,
      updateThoughtTool,
      handleAssistantToken,
      maybeStreamFallbackAssistantText,
      resetAssistantStreaming,
      beginTyping,
      endTyping,
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
      if (baseAction.startsWith('open_documents:')) {
        const documentId = baseAction.split(':')[1] || '';
        if (options?.onAppActions) {
          await options.onAppActions([{ type: 'navigate', to: `/documents?selectedDocumentId=${encodeURIComponent(documentId)}` }]);
        }
        return;
      }
      if (baseAction.startsWith('document_retry:')) {
        const documentId = baseAction.split(':')[1] || '';
        if (!documentId) return;
        await api.retryDocumentProcessing(documentId);
        startDocumentProcessingPolling(documentId, `document ${documentId}`);
        appendMessages([
          {
            id: createId(),
            type: 'status',
            sender: 'bot',
            content: `Retry started for document ${documentId}.`,
            status: 'info',
            timestamp: new Date(),
          },
        ]);
        return;
      }
      if (baseAction.startsWith('document_save_without_link:')) {
        const documentId = baseAction.split(':')[1] || '';
        if (!documentId) return;
        await api.linkDocumentToEntities({ document_id: documentId });
        appendMessages([
          {
            id: createId(),
            type: 'status',
            sender: 'bot',
            content: `Saved analysis for ${documentId} without explicit company/contact linking.`,
            status: 'success',
            timestamp: new Date(),
          },
        ]);
        return;
      }
      if (baseAction.startsWith('document_create_missing:')) {
        const documentId = baseAction.split(':')[1] || '';
        if (!documentId) return;
        setIsTyping(true);
        try {
          const { createdCompanyIds, createdContactIds } = await createMissingRecordsForDocument(documentId);
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Created missing CRM records for ${documentId}.`,
              details: `Companies: ${createdCompanyIds.length}, Contacts: ${createdContactIds.length}`,
              status: 'success',
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'Proceed with linking now?',
              timestamp: new Date(),
              buttons: [
                { label: 'Confirm & Link', value: `document_confirm_link:${documentId}`, variant: 'primary' },
                { label: 'Open Documents Page', value: `open_documents:${documentId}`, variant: 'secondary' },
              ],
            },
          ]);
        } catch {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Could not create missing CRM records for ${documentId}.`,
              status: 'error',
              timestamp: new Date(),
            },
          ]);
        } finally {
          setIsTyping(false);
        }
        return;
      }
      if (baseAction.startsWith('document_confirm_link:')) {
        const documentId = baseAction.split(':')[1] || '';
        if (!documentId) return;
        setIsTyping(true);
        try {
          const detail = await api.getDocument(documentId);
          const entitiesRaw = detail.document?.extracted_entities;
          const entities = (entitiesRaw && typeof entitiesRaw === 'object') ? entitiesRaw as Record<string, unknown> : {};
          const companies = Array.isArray(entities.companies) ? entities.companies : [];
          const contacts = Array.isArray(entities.contacts) ? entities.contacts : [];
          let companyId: number | undefined =
            typeof detail.document?.linked_company_id === 'number' ? Number(detail.document.linked_company_id) : undefined;
          const confidentCompanies = companies
            .filter((item) => item && typeof item === 'object')
            .map((item) => item as Record<string, unknown>)
            .filter((item) => typeof item.matched_crm_id === 'number' && Number(item.match_confidence || 0) >= 0.9)
            .map((item) => Number(item.matched_crm_id))
            .filter((value) => Number.isFinite(value));
          const uniqueConfidentCompanies = Array.from(new Set(confidentCompanies));
          if (!companyId && uniqueConfidentCompanies.length === 1) {
            companyId = uniqueConfidentCompanies[0];
          }
          const contactIds = contacts
            .filter((item) => item && typeof item === 'object')
            .map((item) => item as Record<string, unknown>)
            .filter((item) => typeof item.matched_crm_id === 'number' && Number(item.match_confidence || 0) >= 0.9)
            .map((item) => Number(item.matched_crm_id))
            .filter((value) => Number.isFinite(value));
          await api.linkDocumentToEntities({
            document_id: documentId,
            company_id: companyId,
            contact_ids: Array.from(new Set(contactIds)),
          });
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Document ${documentId} linked successfully.`,
              details: `Company: ${companyId ?? 'none'} | Contacts: ${Array.from(new Set(contactIds)).length} | Auto-link confidence threshold: 0.9`,
              status: 'success',
              timestamp: new Date(),
            },
            {
              id: createId(),
              type: 'action_buttons',
              sender: 'bot',
              content: 'Next action:',
              timestamp: new Date(),
              buttons: [
                { label: 'Ask This Document', value: `document_ask_prompt:${documentId}`, variant: 'primary' },
                { label: 'Open Documents Page', value: `open_documents:${documentId}`, variant: 'secondary' },
              ],
            },
          ]);
        } catch {
          appendMessages([
            {
              id: createId(),
              type: 'status',
              sender: 'bot',
              content: `Could not confirm links for ${documentId}.`,
              status: 'error',
              timestamp: new Date(),
            },
          ]);
        } finally {
          setIsTyping(false);
        }
        return;
      }
      if (baseAction.startsWith('document_edit_assumptions:')) {
        const documentId = baseAction.split(':')[1] || '';
        if (!documentId) return;
        pendingDocumentAssumptionEditRef.current = { documentId, promptMessageId: src };
        appendMessages([
          {
            id: createId(),
            type: 'text',
            sender: 'bot',
            content:
              `Tell me the corrected assumptions for document ${documentId} in this format:\n` +
              `company: Acme Corp (or "none")\n` +
              `contacts: Jane Doe, John Smith`,
            timestamp: new Date(),
          },
        ]);
        return;
      }
      if (baseAction.startsWith('document_ask_prompt:')) {
        const documentId = baseAction.split(':')[1] || '';
        pendingDocumentQuestionScopeRef.current = documentId || null;
        appendMessages([
          {
            id: createId(),
            type: 'text',
            sender: 'bot',
            content: `Ask your question and I will answer from document ${documentId} context.`,
            timestamp: new Date(),
          },
        ]);
        return;
      }
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
        appendMessages([
          {
            id: createId(),
            type: 'text',
            sender: 'bot',
            content: 'Plan confirmed.',
            timestamp: new Date(),
          },
        ]);
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
            content: 'Plan canceled.',
            timestamp: new Date(),
          },
          {
            id: createId(),
            type: 'text',
            sender: 'bot',
            content: 'Tell me how you want to adjust the task and I will re-plan.',
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
      createMissingRecordsForDocument,
      startDocumentProcessingPolling,
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

  const stopAssistantResponse = useCallback(() => {
    setIsTyping(false);
    resetAssistantStreaming();
    suppressThoughtForStreaming();
  }, [resetAssistantStreaming, suppressThoughtForStreaming]);

  return {
    messages,
    thoughtState,
    assistantStreamingText,
    isTyping,
    sendMessage,
    uploadFiles,
    stopAssistantResponse,
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
