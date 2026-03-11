import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, type ColumnDef, type RowSelectionState, useReactTable } from '@tanstack/react-table';
import { ChevronRight, MoreHorizontal, SlidersHorizontal, X } from 'lucide-react';
import { api, type BrowserWorkflowTask, type CompoundWorkflowStatusResponse, type CompoundWorkflowSummary } from '../api';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import { EmailTabs } from '../components/email/EmailTabs';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ColumnVisibilityMenu } from '../components/shared/ColumnVisibilityMenu';
import { TableHeaderFilter } from '../components/shared/TableHeaderFilter';
import { usePageContext } from '../contexts/PageContextProvider';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  FILTERABLE_VIEWPORT_CONTROL_WIDTH,
  SHARED_SELECTION_COLUMN_WIDTH,
  SHARED_TABLE_ROW_HEIGHT_CLASS,
  SharedTableColGroupWithWidths,
  SharedTableHeader,
  filterCellsByIds,
  sharedCellClassName,
  useFittedTableLayout,
  usePersistentColumnSizing,
} from '../components/shared/resizableDataTable';
import { usePersistentColumnPreferences } from '../components/shared/usePersistentColumnPreferences';

type TasksView = 'all' | 'browser' | 'compound';

type UnifiedTaskRow = {
  source: 'browser' | 'compound';
  id: string;
  status: string;
  stage: string;
  progressPct: number;
  tabId?: string;
  updatedLabel: string;
  sortTs: number;
  operation: string;
  goal: string;
  heartbeatAgeMs?: number | null;
  errorText?: string;
};

type BrowserTaskDetail = Record<string, unknown>;

type KeyValueItem = {
  label: string;
  value: string;
};

type BrowserResultCard = {
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
  primaryHref?: string;
  actions: Array<{ label: string; href: string }>;
};

const TASKS_ACTIONS_COLUMN_WIDTH = 56;

function parseTasksView(value: string | null): TasksView {
  if (value === 'browser' || value === 'compound' || value === 'all') return value;
  return 'all';
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function looksLikeInternalPlannerPrompt(value: string): boolean {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return (
    text.includes('you are a sales crm assistant using a react loop') ||
    text.includes('return only strict json tool calls') ||
    text.includes('ambient page context') ||
    text.includes('allowed tools for this request') ||
    text.includes('reasoning trace:') ||
    text.includes('state summary:') ||
    text.length > 280
  );
}

function truncateLabel(value: string, limit = 96): string {
  const text = cleanText(value);
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;
}

function humanizePhaseId(value: string): string {
  const text = cleanText(value);
  if (!text) return '';
  return text
    .replace(/^phase_\d+_?/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function safeWorkflowLabel(
  value: unknown,
  fallback = '',
  options?: { maxLength?: number; preferFallbackOnPrompt?: boolean }
): string {
  const text = cleanText(value);
  if (!text) return truncateLabel(fallback, options?.maxLength);
  if (looksLikeInternalPlannerPrompt(text) && options?.preferFallbackOnPrompt !== false) {
    return truncateLabel(fallback, options?.maxLength);
  }
  return truncateLabel(text, options?.maxLength);
}

function resolveTaskTabId(task: BrowserWorkflowTask): string | undefined {
  const diagnostics = task.diagnostics || {};
  const result = task.result || {};
  const fromDiagnostics = typeof diagnostics.tab_id === 'string' ? diagnostics.tab_id : undefined;
  const fromResult = typeof result.tab_id === 'string' ? result.tab_id : undefined;
  return fromDiagnostics || fromResult;
}

function fmtUnixTime(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts)) return 'n/a';
  return new Date(ts * 1000).toLocaleString();
}

function fmtIsoTime(ts?: string | null): string {
  if (!ts) return 'n/a';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'n/a';
  return d.toLocaleString();
}

function isoToMs(ts?: string | null): number {
  if (!ts) return 0;
  const d = new Date(ts);
  const value = d.getTime();
  return Number.isFinite(value) ? value : 0;
}

function fmtHeartbeat(ms?: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${sec}s ago`;
}

function summarizeError(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const text = value.trim();
    return text || undefined;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const msg = typeof rec.message === 'string' ? rec.message.trim() : '';
    const code = typeof rec.code === 'string' ? rec.code.trim() : '';
    if (msg && code) return `${code}: ${msg}`;
    if (msg) return msg;
    if (code) return code;
    try {
      return JSON.stringify(rec, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function browserGoal(task: BrowserWorkflowTask): string {
  const d = task.diagnostics || {};
  const goal = typeof d.goal === 'string' ? d.goal.trim() : '';
  if (goal) return goal;
  const query = typeof d.query === 'string' ? d.query.trim() : '';
  if (query) return query;
  const taskName = typeof d.task === 'string' ? d.task.trim() : '';
  if (taskName) return taskName;
  const operation = typeof d.operation === 'string' ? d.operation.trim() : '';
  if (operation) return operation;
  return 'Browser task';
}

function compoundGoal(workflow: CompoundWorkflowSummary): string {
  const phaseLabel = humanizePhaseId(String(workflow.current_phase_id || ''));
  const name = safeWorkflowLabel(workflow.name, phaseLabel, { maxLength: 84 });
  if (name) return name;
  const description = safeWorkflowLabel(workflow.description, phaseLabel, { maxLength: 84 });
  if (description) return description;
  const query = safeWorkflowLabel(workflow.original_query, phaseLabel, { maxLength: 84 });
  if (query) return query;
  if (phaseLabel) return phaseLabel;
  return workflow.id;
}

function statusPillClass(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'failed' || s === 'cancelled') return 'bg-red-100 text-red-700';
  if (s === 'completed' || s === 'finished') return 'bg-green-100 text-green-700';
  if (s === 'paused') return 'bg-amber-100 text-amber-700';
  if (s === 'running' || s === 'pending') return 'bg-blue-100 text-blue-700';
  return 'bg-accent/10 text-accent';
}

function TasksHeaderActionsMenu({
  onRefresh,
  showFinished,
  onToggleShowFinished,
}: {
  onRefresh: () => void;
  showFinished: boolean;
  onToggleShowFinished: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({ top: rect.top + rect.height / 2, left: rect.left - 4 });
    };
    updatePosition();
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onScrollOrResize = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  return (
    <>
      <div className="relative flex h-full w-full items-center justify-center">
        <button
          ref={buttonRef}
          type="button"
          aria-label="Open task table actions"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={ref}
              className="fixed z-[120] w-44 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  onToggleShowFinished();
                  setOpen(false);
                }}
                className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
              >
                {showFinished ? 'Hide finished' : 'Show finished'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                  setOpen(false);
                }}
                className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
              >
                Refresh
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function TaskRowActionsMenu({
  task,
  onOpen,
}: {
  task: UnifiedTaskRow;
  onOpen: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({ top: rect.top + rect.height / 2, left: rect.left - 4 });
    };
    updatePosition();
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onScrollOrResize = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  return (
    <>
      <div className="relative flex h-full w-full items-center justify-center">
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Open actions for ${task.goal}`}
          data-row-control
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={ref}
              className="fixed z-[120] w-44 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  onOpen(task.id);
                  setOpen(false);
                }}
                className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
              >
                Open details
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function toPrettyJson(value: unknown): string {
  if (value == null) return 'n/a';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function itemCount(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.count === 'number' && Number.isFinite(rec.count)) return rec.count;
  if (Array.isArray(rec.items)) return rec.items.length;
  if (Array.isArray(rec.events)) return rec.events.length;
  return null;
}

function browserResultSummary(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'No result captured.';
  const rec = result as Record<string, unknown>;
  const count = itemCount(rec);
  if (count && count > 0) return `${count} item${count === 1 ? '' : 's'} returned`;
  if (typeof rec.url === 'string' && rec.url.trim()) return rec.url.trim();
  if (typeof rec.note === 'string' && rec.note.trim()) return rec.note.trim();
  return 'Result available';
}

function absoluteLinkedInUrl(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  if (text.startsWith('http://') || text.startsWith('https://')) return text;
  if (text.startsWith('/')) return `https://www.linkedin.com${text}`;
  return text;
}

function buildBrowserResultSummary(result: unknown): KeyValueItem[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  const rec = result as Record<string, unknown>;
  const summary: KeyValueItem[] = [];
  const items = Array.isArray(rec.items) ? rec.items : [];
  const publicUrlCount = items.filter((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    const publicUrl = absoluteLinkedInUrl(row.public_url || row.linkedin_url);
    return row.has_public_url === true || publicUrl.includes('/in/');
  }).length;
  const pairs: Array<[string, unknown]> = [
    ['status', rec.ok === true ? 'ok' : rec.ok === false ? 'failed' : 'unknown'],
    ['count', itemCount(rec)],
    ['public_urls', publicUrlCount > 0 ? publicUrlCount : ''],
    ['url', rec.url],
    ['tab_id', rec.tab_id],
    ['skill_id', rec.skill_id],
    ['task', rec.task],
    ['opened_new_tab', typeof rec.opened_new_tab === 'boolean' ? String(rec.opened_new_tab) : ''],
  ];
  for (const [label, raw] of pairs) {
    const value = cleanText(raw);
    if (!value || value === 'unknown') continue;
    summary.push({ label: label.replace(/_/g, ' '), value });
  }
  return summary;
}

function uniqueLinks(links: Array<{ label: string; href: string }>): Array<{ label: string; href: string }> {
  const seen = new Set<string>();
  return links.filter((link) => {
    const href = cleanText(link.href);
    if (!href || seen.has(href)) return false;
    seen.add(href);
    return true;
  });
}

function buildBrowserResultCards(result: unknown, limit = 12): BrowserResultCard[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  const rec = result as Record<string, unknown>;
  const items = Array.isArray(rec.items) ? rec.items : [];
  return items
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, limit)
    .map((item) => {
      const row = item as Record<string, unknown>;
      const rawPublicUrl = absoluteLinkedInUrl(row.public_url);
      const rawLinkedinUrl = absoluteLinkedInUrl(row.linkedin_url);
      const hasPublicUrl = row.has_public_url === true || rawPublicUrl.includes('/in/');
      const linkedinUrl = hasPublicUrl
        ? (rawPublicUrl || (rawLinkedinUrl.includes('/in/') ? rawLinkedinUrl : ''))
        : '';
      const salesNavUrl = absoluteLinkedInUrl(row.sales_nav_url);
      const sourceUrl = absoluteLinkedInUrl(row.source_url);
      const actions = uniqueLinks([
        ...(linkedinUrl ? [{ label: 'LinkedIn', href: linkedinUrl }] : []),
        ...(salesNavUrl ? [{ label: 'SalesNav', href: salesNavUrl }] : []),
        ...(sourceUrl ? [{ label: 'Source', href: sourceUrl }] : []),
      ]);
      return {
        name: cleanText(row.contact_name || row.name),
        title: cleanText(row.contact_title || row.title),
        company: cleanText(row.company_name || row.company),
        email: cleanText(row.contact_email || row.email),
        phone: cleanText(row.phone || row.phone_number),
        primaryHref: linkedinUrl || salesNavUrl || sourceUrl || undefined,
        actions,
      };
    })
    .filter((card) => Boolean(card.name || card.title || card.company || card.email || card.phone || card.actions.length));
}

function buildBrowserMeta(detail: BrowserTaskDetail | null, fallback: UnifiedTaskRow): KeyValueItem[] {
  const diagnostics = detail?.diagnostics;
  const result = detail?.result;
  const diagnosticsObj = diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)
    ? diagnostics as Record<string, unknown>
    : {};
  const resultObj = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : {};

  return [
    { label: 'Source', value: 'Browser workflow' },
    { label: 'Task ID', value: fallback.id },
    { label: 'Status', value: String(detail?.status || fallback.status || 'n/a') },
    { label: 'Stage', value: String(detail?.stage || fallback.stage || 'n/a') },
    { label: 'Operation', value: String(diagnosticsObj.operation || fallback.operation || 'n/a') },
    { label: 'Goal', value: String(diagnosticsObj.goal || diagnosticsObj.query || fallback.goal || 'n/a') },
    { label: 'Progress', value: `${Number(detail?.progress_pct || fallback.progressPct || 0)}%` },
    { label: 'Tab', value: String(diagnosticsObj.tab_id || resultObj.tab_id || fallback.tabId || 'n/a') },
    { label: 'Updated', value: fmtUnixTime(typeof detail?.updated_at === 'number' ? detail.updated_at : null) },
    { label: 'Started', value: fmtUnixTime(typeof detail?.started_at === 'number' ? detail.started_at : null) },
    { label: 'Finished', value: fmtUnixTime(typeof detail?.finished_at === 'number' ? detail.finished_at : null) },
    { label: 'Heartbeat', value: fmtHeartbeat(typeof detail?.heartbeat_age_ms === 'number' ? detail.heartbeat_age_ms : fallback.heartbeatAgeMs) },
  ];
}

function buildCompoundMeta(detail: CompoundWorkflowStatusResponse | null, fallback: UnifiedTaskRow): KeyValueItem[] {
  const phaseLabel = humanizePhaseId(String(detail?.current_phase_id || fallback.stage || ''));
  const friendlyName = safeWorkflowLabel(detail?.name, phaseLabel || fallback.goal);
  const friendlyQuery = safeWorkflowLabel(detail?.original_query, phaseLabel || fallback.goal);
  return [
    { label: 'Source', value: 'Compound workflow' },
    { label: 'Workflow ID', value: fallback.id },
    { label: 'Status', value: String(detail?.status || fallback.status || 'n/a') },
    { label: 'Phase', value: phaseLabel || String(detail?.current_phase_id || fallback.stage || 'n/a') },
    { label: 'Name', value: friendlyName || 'n/a' },
    { label: 'Original query', value: friendlyQuery || fallback.goal || 'n/a' },
    { label: 'Progress', value: `${Number(detail?.completed_phases || 0)}/${Number(detail?.total_phases || 0)} phases` },
    { label: 'Browser calls', value: String(detail?.browser_calls_used || 0) },
    { label: 'Created', value: fmtIsoTime(detail?.created_at || null) },
    { label: 'Started', value: fmtIsoTime(detail?.started_at || null) },
    { label: 'Completed', value: fmtIsoTime(detail?.completed_at || null) },
    { label: 'Heartbeat', value: fmtHeartbeat(detail?.heartbeat_age_ms ?? fallback.heartbeatAgeMs) },
  ];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-bg/40 p-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">{title}</p>
      {children}
    </section>
  );
}

function taskSourceLabel(source: UnifiedTaskRow['source']) {
  return source === 'compound' ? 'Compound' : 'Browser';
}

function parseInternalPromptSections(value: string): Array<{ label: string; content: string }> {
  const text = cleanText(value);
  if (!text) return [];
  const markers = [
    { label: 'System', marker: 'You are a sales CRM assistant using a ReAct loop.' },
    { label: 'Page Context', marker: 'Ambient page context (metadata only, not user intent):' },
    { label: 'Allowed Tools', marker: 'Allowed tools for this request:' },
    { label: 'Conversation Context', marker: 'Conversation context:' },
    { label: 'Reasoning Trace', marker: 'Reasoning trace:' },
    { label: 'State Summary', marker: 'State summary:' },
    { label: 'Output Contract', marker: 'Return ONLY strict JSON tool calls.' },
  ];

  const found = markers
    .map((entry) => ({ ...entry, index: text.indexOf(entry.marker) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (found.length === 0) return [{ label: 'Prompt', content: text }];

  return found.map((entry, index) => {
    const start = entry.index;
    const end = index + 1 < found.length ? found[index + 1].index : text.length;
    return {
      label: entry.label,
      content: text.slice(start, end).trim(),
    };
  });
}

function buildPayloadSummary(value: unknown): KeyValueItem[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const rec = value as Record<string, unknown>;
  const keys = [
    'id',
    'status',
    'current_phase_id',
    'total_phases',
    'completed_phases',
    'browser_calls_used',
    'created_at',
    'started_at',
    'completed_at',
    'heartbeat_at',
    'heartbeat_seq',
  ];
  return keys
    .filter((key) => rec[key] != null && rec[key] !== '')
    .map((key) => ({
      label: key.replace(/_/g, ' '),
      value: cleanText(typeof rec[key] === 'string' ? rec[key] : String(rec[key])),
    }));
}

function TaskDetailContent({
  task,
  browserDetail,
  compoundDetail,
  onClose,
}: {
  task: UnifiedTaskRow;
  browserDetail: BrowserTaskDetail | null;
  compoundDetail: CompoundWorkflowStatusResponse | null;
  onClose: () => void;
}) {
  const isBrowser = task.source === 'browser';
  const meta = isBrowser ? buildBrowserMeta(browserDetail, task) : buildCompoundMeta(compoundDetail, task);
  const browserDiagnostics = browserDetail?.diagnostics ?? null;
  const browserResult = browserDetail?.result ?? null;
  const browserError = summarizeError(browserDetail?.error) || task.errorText;
  const compoundError = summarizeError(compoundDetail?.error) || task.errorText;
  const eventPreview = compoundDetail?.events?.slice(-10).reverse() || [];
  const browserResultSummaryItems = buildBrowserResultSummary(browserResult);
  const browserResultCards = buildBrowserResultCards(browserResult);
  const compoundDescription = safeWorkflowLabel(compoundDetail?.description, humanizePhaseId(String(compoundDetail?.current_phase_id || task.stage || '')), {
    maxLength: 220,
  });
  const compoundName = safeWorkflowLabel(compoundDetail?.name, '', { maxLength: 140, preferFallbackOnPrompt: false });
  const rawInternalPrompt = [
    cleanText(compoundDetail?.original_query),
    cleanText(compoundDetail?.description),
    cleanText(compoundDetail?.name),
  ].find((value) => looksLikeInternalPlannerPrompt(value)) || '';
  const internalPromptSections = parseInternalPromptSections(rawInternalPrompt);
  const payloadSummary = buildPayloadSummary(compoundDetail);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{task.goal}</h3>
            <p className="truncate text-xs text-text-dim">{task.operation} | {task.stage}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${statusPillClass(task.status)}`}>{task.status}</span>
          <span className="inline-flex rounded-full bg-accent/10 px-2 py-0.5 font-medium text-accent">{task.source}</span>
          <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-text-dim">{task.progressPct}%</span>
          {task.tabId ? <span className="inline-flex rounded-full border border-border bg-bg px-2 py-0.5 text-text-dim">tab {task.tabId}</span> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        <div className="space-y-4">
          <Section title="Overview">
            <dl className="grid grid-cols-1 gap-x-3 gap-y-2 text-xs text-text md:grid-cols-2">
              {meta.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wide text-text-muted">{item.label}</dt>
                  <dd className="mt-0.5 break-words text-text">{item.value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {isBrowser ? (
            <>
                <Section title="Result">
                  <div className="space-y-2 text-xs text-text">
                    <p>{browserResultSummary(browserResult)}</p>
                    {browserResultSummaryItems.length > 0 ? (
                      <dl className="grid grid-cols-1 gap-x-3 gap-y-2 text-xs text-text md:grid-cols-2">
                      {browserResultSummaryItems.map((item) => (
                        <div key={item.label} className="min-w-0">
                          <dt className="text-[11px] uppercase tracking-wide text-text-muted">{item.label}</dt>
                          <dd className="mt-0.5 break-words text-text">{item.value}</dd>
                        </div>
                        ))}
                      </dl>
                    ) : null}
                    {browserResultCards.length > 0 ? (
                      <div className="space-y-2">
                        {browserResultCards.map((card, index) => (
                          <article key={`browser-result-card-${index}`} className="rounded-lg border border-border bg-surface p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                {card.primaryHref ? (
                                  <a
                                    href={card.primaryHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="truncate text-sm font-semibold text-accent hover:underline"
                                  >
                                    {card.name || card.title || 'Open profile'}
                                  </a>
                                ) : (
                                  <p className="truncate text-sm font-semibold text-text">{card.name || card.title || 'Result item'}</p>
                                )}
                                {(card.title || card.company) ? (
                                  <p className="mt-1 truncate text-xs text-text-dim">
                                    {[card.title, card.company].filter(Boolean).join(' at ')}
                                  </p>
                                ) : null}
                              </div>
                              {card.actions.length > 0 ? (
                                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                  {card.actions.map((action) => (
                                    <a
                                      key={`${index}-${action.label}-${action.href}`}
                                      href={action.href}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] font-medium text-accent hover:underline"
                                    >
                                      {action.label}
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {(card.email || card.phone) ? (
                              <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-text md:grid-cols-2">
                                {card.email ? (
                                  <div className="min-w-0 rounded-md border border-border/70 bg-bg px-2 py-1.5">
                                    <dt className="uppercase tracking-wide text-text-muted">Email</dt>
                                    <dd className="mt-0.5 truncate text-text">{card.email}</dd>
                                  </div>
                                ) : null}
                                {card.phone ? (
                                  <div className="min-w-0 rounded-md border border-border/70 bg-bg px-2 py-1.5">
                                    <dt className="uppercase tracking-wide text-text-muted">Phone</dt>
                                    <dd className="mt-0.5 truncate text-text">{card.phone}</dd>
                                  </div>
                                ) : null}
                              </dl>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : null}
                    <details className="rounded-md border border-border bg-surface p-2">
                    <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-text-muted">
                      View Raw JSON
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] text-text-dim">
                      {toPrettyJson(browserResult)}
                    </pre>
                  </details>
                </div>
              </Section>
              <Section title="Diagnostics">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-2 text-[11px] text-text-dim">
                  {toPrettyJson(browserDiagnostics)}
                </pre>
              </Section>
              {browserError ? (
                <Section title="Error">
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
                    {browserError}
                  </pre>
                </Section>
              ) : null}
            </>
          ) : (
            <>
              <Section title="Workflow">
                <div className="space-y-2 text-xs text-text">
                  <p>{compoundDescription || 'No workflow description available.'}</p>
                  {compoundName && !looksLikeInternalPlannerPrompt(compoundName) ? (
                    <p className="text-text-dim">{compoundName}</p>
                  ) : null}
                </div>
              </Section>
              {rawInternalPrompt ? (
                <Section title="Internal Prompt">
                  <div className="space-y-2">
                    {internalPromptSections.map((section) => (
                      <div key={section.label} className="rounded-md border border-border bg-surface p-2">
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">{section.label}</p>
                        <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-text-dim">{section.content}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}
              <Section title="Raw Workflow Payload">
                <div className="space-y-2">
                  {payloadSummary.length > 0 ? (
                    <dl className="grid grid-cols-1 gap-x-3 gap-y-2 text-xs text-text md:grid-cols-2">
                      {payloadSummary.map((item) => (
                        <div key={item.label} className="min-w-0">
                          <dt className="text-[11px] uppercase tracking-wide text-text-muted">{item.label}</dt>
                          <dd className="mt-0.5 break-words text-text">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <details className="rounded-md border border-border bg-surface p-2">
                    <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-text-muted">
                      View Raw JSON
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] text-text-dim">
                      {toPrettyJson(compoundDetail)}
                    </pre>
                  </details>
                </div>
              </Section>
              <Section title="Recent Events">
                {eventPreview.length === 0 ? (
                  <p className="text-xs text-text-dim">No workflow events recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {eventPreview.map((event) => (
                      <div key={`${event.type}-${event.timestamp}`} className="rounded-md border border-border bg-surface p-2">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                          <span className="font-medium text-text">{event.type}</span>
                          <span>{fmtIsoTime(event.timestamp)}</span>
                        </div>
                        <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] text-text-dim">{toPrettyJson(event.payload)}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
              {compoundError ? (
                <Section title="Error">
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
                    {compoundError}
                  </pre>
                </Section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setPageContext } = usePageContext();
  const isPhone = useIsMobile(640);
  const detailsPanelRef = useRef<HTMLDivElement>(null);
  const [showFinished, setShowFinished] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const [viewportControlsTarget, setViewportControlsTarget] = useState<HTMLDivElement | null>(null);
  const view = useMemo(() => parseTasksView(searchParams?.get('view') ?? null), [searchParams]);
  const filtersMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<any>(null);
  const canShiftLeftRef = useRef(false);
  const canShiftRightRef = useRef(false);
  const shiftLeftRef = useRef<() => void>(() => {});
  const shiftRightRef = useRef<() => void>(() => {});
  const refreshTasksRef = useRef<() => void>(() => {});
  useRegisterCapabilities(getPageCapability('tasks'));

  useEffect(() => {
    setPageContext({ listContext: 'tasks' });
  }, [setPageContext]);

  const selectedTaskId = searchParams?.get('taskId')?.trim() || '';

  const updateTasksRoute = useCallback((mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    mutate(params);
    const nextUrl = `/tasks${params.toString() ? `?${params.toString()}` : ''}`;
    if (options?.replace ?? false) {
      router.replace(nextUrl, { scroll: false });
    } else {
      router.push(nextUrl, { scroll: false });
    }
  }, [router, searchParams]);

  const openTask = useCallback((taskId: string) => {
    updateTasksRoute((params) => {
      params.set('taskId', taskId);
    });
  }, [updateTasksRoute]);

  const closeTask = useCallback(() => {
    updateTasksRoute((params) => {
      params.delete('taskId');
    }, { replace: true });
  }, [updateTasksRoute]);

  const setTasksView = useCallback((nextView: TasksView) => {
    updateTasksRoute((params) => {
      params.set('view', nextView);
      params.delete('taskId');
    });
  }, [updateTasksRoute]);

  const tasksQ = useQuery({
    queryKey: ['browser', 'workflowTasks', showFinished],
    queryFn: () => api.getBrowserWorkflowTasks({ includeFinished: showFinished, limit: 200 }),
    refetchInterval: 2000,
  });

  const compoundQ = useQuery({
    queryKey: ['compound', 'workflowTasks', showFinished],
    queryFn: () => api.getCompoundWorkflows({ limit: 200 }),
    refetchInterval: 2000,
  });

  const browserTasks = useMemo(() => {
    const rows = tasksQ.data?.tasks || [];
    return rows.filter((task) => {
      const operation = typeof task.diagnostics?.operation === 'string' ? task.diagnostics.operation : '';
      const taskType = typeof task.diagnostics?.task_type === 'string' ? task.diagnostics.task_type : '';
      if (taskType !== 'browser_workflow_async') return false;
      return operation !== 'browser_screenshot';
    });
  }, [tasksQ.data?.tasks]);

  const compoundTasks = useMemo(() => {
    const rows = compoundQ.data?.workflows || [];
    if (showFinished) return rows;
    return rows.filter((row) => ['pending', 'running', 'paused'].includes(String(row.status || '').toLowerCase()));
  }, [compoundQ.data?.workflows, showFinished]);

  const tasks = useMemo<UnifiedTaskRow[]>(() => {
    const browserRows: UnifiedTaskRow[] = browserTasks.map((task) => {
      const operation = typeof task.diagnostics?.operation === 'string' ? task.diagnostics.operation : 'workflow';
      return {
        source: 'browser',
        id: task.task_id,
        status: task.status,
        stage: task.stage,
        progressPct: Number(task.progress_pct || 0),
        tabId: resolveTaskTabId(task),
        updatedLabel: fmtUnixTime(task.updated_at),
        sortTs: typeof task.updated_at === 'number' && Number.isFinite(task.updated_at) ? task.updated_at * 1000 : 0,
        operation,
        goal: browserGoal(task),
        heartbeatAgeMs: typeof task.heartbeat_age_ms === 'number' ? task.heartbeat_age_ms : null,
        errorText: summarizeError(task.error),
      };
    });

    const compoundRows: UnifiedTaskRow[] = compoundTasks.map((workflow) => {
      const total = Number(workflow.total_phases || 0);
      const done = Number(workflow.completed_phases || 0);
      const progressPct = total > 0 ? Math.round((done / total) * 100) : (workflow.status === 'completed' ? 100 : 0);
      return {
        source: 'compound',
        id: workflow.id,
        status: workflow.status,
        stage: workflow.current_phase_id || workflow.status || 'running',
        progressPct,
        updatedLabel: fmtIsoTime(workflow.heartbeat_at || workflow.started_at || workflow.created_at || null),
        sortTs: isoToMs(workflow.heartbeat_at || workflow.started_at || workflow.created_at || null),
        operation: 'compound_workflow',
        goal: compoundGoal(workflow),
        heartbeatAgeMs: typeof workflow.heartbeat_age_ms === 'number' ? workflow.heartbeat_age_ms : null,
        errorText: summarizeError(workflow.error),
      };
    });

    return [...compoundRows, ...browserRows].sort((a, b) => b.sortTs - a.sortTs);
  }, [browserTasks, compoundTasks]);

  const filteredTasks = useMemo(() => {
    const viewFiltered = tasks.filter((task) => {
      if (view === 'browser') return task.source === 'browser';
      if (view === 'compound') return task.source === 'compound';
      return true;
    });
    const headerFiltered = viewFiltered.filter((task) => {
      if (statusFilter && task.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (sourceFilter && task.source.toLowerCase() !== sourceFilter.toLowerCase()) return false;
      return true;
    });
    const q = search.trim().toLowerCase();
    if (!q) return headerFiltered;
    return headerFiltered.filter((task) =>
      [task.id, task.goal, task.status, task.stage, task.operation, task.tabId || '', task.errorText || '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [search, sourceFilter, statusFilter, tasks, view]);

  const statusOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => String(task.status || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks],
  );

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (filtersMenuRef.current && !filtersMenuRef.current.contains(event.target as Node)) setShowFiltersMenu(false);
    }
    if (showFiltersMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFiltersMenu]);

  const columnLabelMap: Record<string, string> = {
    goal: 'Goal',
    status: 'Status',
    stage: 'Stage',
    progress: 'Progress',
    updated: 'Updated',
    operation: 'Operation',
    task_id: 'Task ID',
    source: 'Source',
  };
  const managedColumnIds = useMemo(() => ['goal', 'status', 'stage', 'progress', 'updated', 'operation', 'task_id', 'source'], []);
  const { columnOrder: managedColumnOrder, setColumnOrder: setManagedColumnOrder, columnVisibility, setColumnVisibility } = usePersistentColumnPreferences({
    storageKey: 'tasks-table',
    columnIds: managedColumnIds,
    initialVisibility: { goal: true },
  });

  const moveManagedColumn = useCallback((columnId: string, delta: -1 | 1) => {
    setManagedColumnOrder((prev) => {
      const index = prev.indexOf(columnId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }, [setManagedColumnOrder]);

  const viewportControls = useMemo(() => (
    <div className="relative flex h-full w-full items-center justify-center gap-0.5 bg-surface" ref={filtersMenuRef}>
      <button
        type="button"
        onClick={() => setShowFiltersMenu((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        title="Columns"
        aria-label="Open visible columns menu"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => shiftLeftRef.current()}
        disabled={!canShiftLeftRef.current}
        aria-label="Show previous columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
      </button>
      <button
        type="button"
        onClick={() => shiftRightRef.current()}
        disabled={!canShiftRightRef.current}
        aria-label="Show more columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {showFiltersMenu ? (
        <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
          <ColumnVisibilityMenu
            items={managedColumnOrder.map((columnId, index) => ({
              id: columnId,
              label: columnLabelMap[columnId] ?? columnId,
              visible: tableRef.current?.getColumn(columnId)?.getIsVisible() ?? true,
              canHide: columnId !== 'goal',
              canMoveUp: index > 0,
              canMoveDown: index < managedColumnOrder.length - 1,
            }))}
            onToggle={(columnId, visible) => {
              if (columnId === 'goal') return;
              tableRef.current?.getColumn(columnId)?.toggleVisibility(visible);
            }}
            onMoveUp={(columnId) => moveManagedColumn(columnId, -1)}
            onMoveDown={(columnId) => moveManagedColumn(columnId, 1)}
          />
        </div>
      ) : null}
    </div>
  ), [columnLabelMap, managedColumnOrder, moveManagedColumn, showFiltersMenu]);

  const actionsHeader = useMemo(
    () => (
      <TasksHeaderActionsMenu
        onRefresh={() => refreshTasksRef.current()}
        showFinished={showFinished}
        onToggleShowFinished={() => setShowFinished((value) => !value)}
      />
    ),
    [showFinished],
  );

  const taskColumns = useMemo<ColumnDef<UnifiedTaskRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <button
            type="button"
            aria-label="Select all visible tasks"
            aria-pressed={table.getIsAllRowsSelected()}
            onClick={() => table.toggleAllRowsSelected(!table.getIsAllRowsSelected())}
            className="block h-full w-full"
            data-row-control
          />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Select task ${row.original.id}`}
            aria-pressed={row.getIsSelected()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              row.toggleSelected();
            }}
            className="block h-full w-full"
            data-row-control
          />
        ),
        size: SHARED_SELECTION_COLUMN_WIDTH,
        minSize: SHARED_SELECTION_COLUMN_WIDTH,
        maxSize: SHARED_SELECTION_COLUMN_WIDTH,
        enableResizing: false,
        meta: {
          label: 'Select',
          minWidth: SHARED_SELECTION_COLUMN_WIDTH,
          defaultWidth: SHARED_SELECTION_COLUMN_WIDTH,
          maxWidth: SHARED_SELECTION_COLUMN_WIDTH,
          resizable: false,
          align: 'center',
        },
      },
      {
        id: 'goal',
        header: 'Goal',
        accessorFn: (row) => row.goal,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-text" title={row.original.goal}>{row.original.goal}</p>
            {row.original.errorText ? (
              <p className="mt-0.5 truncate text-xs text-red-600">{row.original.errorText}</p>
            ) : (
              <p className="mt-0.5 truncate text-xs text-text-dim">{row.original.tabId ? `Tab ${row.original.tabId}` : 'No tab binding'}</p>
            )}
          </div>
        ),
        size: 300,
        minSize: 240,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Goal',
          minWidth: 240,
          defaultWidth: 300,
          maxWidth: 520,
          resizable: true,
          align: 'left',
          measureValue: (row: UnifiedTaskRow) => row.goal,
        },
      },
      {
        id: 'status',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Status</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'status'}
              active={Boolean(statusFilter)}
              label="Status"
              onToggle={() => setOpenHeaderFilterId((value) => (value === 'status' ? null : 'status'))}
            >
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              >
                <option value="">All</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => row.status,
        cell: ({ row }) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusPillClass(row.original.status)}`}>{row.original.status}</span>,
        size: 120,
        minSize: 96,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Status',
          minWidth: 96,
          defaultWidth: 120,
          maxWidth: 150,
          resizable: true,
          align: 'left',
          measureValue: (row: UnifiedTaskRow) => row.status,
        },
      },
      {
        id: 'stage',
        header: 'Stage',
        accessorFn: (row) => row.stage,
        cell: ({ row }) => <span className="block truncate text-xs leading-tight text-text-dim">{row.original.stage}</span>,
        size: 170,
        minSize: 130,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Stage',
          minWidth: 130,
          defaultWidth: 170,
          maxWidth: 260,
          resizable: true,
          align: 'left',
          measureValue: (row: UnifiedTaskRow) => row.stage,
        },
      },
      {
        id: 'progress',
        header: 'Progress',
        accessorFn: (row) => row.progressPct,
        cell: ({ row }) => {
          const heartbeatText = row.original.status.toLowerCase() === 'running' && typeof row.original.heartbeatAgeMs === 'number'
            ? ` | hb ${Math.max(0, Math.round(row.original.heartbeatAgeMs / 1000))}s`
            : '';
          return <span className="block truncate text-xs leading-tight text-text-dim">{row.original.progressPct}%{heartbeatText}</span>;
        },
        size: 130,
        minSize: 110,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Progress',
          minWidth: 110,
          defaultWidth: 130,
          maxWidth: 170,
          resizable: true,
          align: 'right',
          measureValue: (row: UnifiedTaskRow) => `${row.progressPct}%`,
        },
      },
      {
        id: 'updated',
        header: 'Updated',
        accessorFn: (row) => row.updatedLabel,
        cell: ({ row }) => <span className="block truncate text-xs leading-tight text-text-dim">{row.original.updatedLabel}</span>,
        size: 160,
        minSize: 130,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Updated',
          minWidth: 130,
          defaultWidth: 160,
          maxWidth: 220,
          resizable: true,
          align: 'left',
          measureValue: (row: UnifiedTaskRow) => row.updatedLabel,
        },
      },
      {
        id: 'operation',
        header: 'Operation',
        accessorFn: (row) => row.operation,
        cell: ({ row }) => <span className="block truncate text-xs leading-tight text-text-dim">{row.original.operation}</span>,
        size: 150,
        minSize: 120,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Operation',
          minWidth: 120,
          defaultWidth: 150,
          maxWidth: 220,
          resizable: true,
          align: 'left',
          measureValue: (row: UnifiedTaskRow) => row.operation,
        },
      },
      {
        id: 'task_id',
        header: 'Task ID',
        accessorFn: (row) => row.id,
        cell: ({ row }) => <span className="block truncate text-xs leading-tight text-text-dim" title={row.original.id}>{row.original.id}</span>,
        size: 170,
        minSize: 140,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Task ID',
          minWidth: 140,
          defaultWidth: 170,
          maxWidth: 260,
          resizable: true,
          align: 'left',
          measureValue: (row: UnifiedTaskRow) => row.id,
        },
      },
      {
        id: 'source',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Source</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'source'}
              active={Boolean(sourceFilter)}
              label="Source"
              onToggle={() => setOpenHeaderFilterId((value) => (value === 'source' ? null : 'source'))}
            >
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              >
                <option value="">All</option>
                <option value="browser">Browser</option>
                <option value="compound">Compound</option>
              </select>
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => row.source,
        cell: ({ row }) => <span className="block truncate text-xs leading-tight text-text-dim">{taskSourceLabel(row.original.source)}</span>,
        size: 100,
        minSize: 90,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Source',
          minWidth: 90,
          defaultWidth: 100,
          maxWidth: 130,
          resizable: true,
          align: 'left',
          measureValue: (row: UnifiedTaskRow) => taskSourceLabel(row.source),
        },
      },
      {
        id: 'actions',
        header: () => actionsHeader,
        cell: ({ row }) => <TaskRowActionsMenu task={row.original} onOpen={openTask} />,
        size: TASKS_ACTIONS_COLUMN_WIDTH,
        minSize: TASKS_ACTIONS_COLUMN_WIDTH,
        maxSize: TASKS_ACTIONS_COLUMN_WIDTH,
        enableResizing: false,
        meta: {
          label: 'Actions',
          minWidth: TASKS_ACTIONS_COLUMN_WIDTH,
          defaultWidth: TASKS_ACTIONS_COLUMN_WIDTH,
          maxWidth: TASKS_ACTIONS_COLUMN_WIDTH,
          resizable: false,
          align: 'right',
          headerClassName: 'sticky right-0 z-20 bg-surface px-0',
          cellClassName: 'sticky right-0 z-40 overflow-visible bg-surface px-0 text-center',
        },
      },
    ],
    [actionsHeader, openHeaderFilterId, openTask, sourceFilter, statusFilter, statusOptions]
  );

  const { columnSizing, setColumnSizing, autoFitColumn } = usePersistentColumnSizing({
    columns: taskColumns,
    rows: filteredTasks,
    storageKey: 'tasks-table',
  });

  const tasksTable = useReactTable({
    data: filteredTasks,
    columns: taskColumns,
    state: { columnSizing, rowSelection, columnVisibility, columnOrder: ['select', ...managedColumnOrder, 'actions'] },
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: (updater) => {
      setManagedColumnOrder((prev) => {
        const current = ['select', ...prev, 'actions'];
        const next = typeof updater === 'function' ? updater(current) : updater;
        const orderedManaged = next.filter((id) => managedColumnIds.includes(id));
        managedColumnIds.forEach((id) => {
          if (!orderedManaged.includes(id)) orderedManaged.push(id);
        });
        return orderedManaged;
      });
    },
    getRowId: (row) => `${row.source}:${row.id}`,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });
  const {
    containerRef: tasksTableRef,
    columnWidths: tasksColumnWidths,
    visibleColumnIds: tasksVisibleColumnIds,
    tableStyle: tasksTableStyle,
    fillWidth: tasksFillWidth,
    canShiftLeft: canShiftTasksLeft,
    canShiftRight: canShiftTasksRight,
    shiftLeft: shiftTasksLeft,
    shiftRight: shiftTasksRight,
  } = useFittedTableLayout(tasksTable, { controlWidth: FILTERABLE_VIEWPORT_CONTROL_WIDTH });
  tableRef.current = tasksTable;
  canShiftLeftRef.current = canShiftTasksLeft;
  canShiftRightRef.current = canShiftTasksRight;
  shiftLeftRef.current = shiftTasksLeft;
  shiftRightRef.current = shiftTasksRight;

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks]
  );

  useEffect(() => {
    if (!selectedTaskId) return;
    if (tasksQ.isLoading || compoundQ.isLoading) return;
    if (!selectedTask) closeTask();
  }, [closeTask, compoundQ.isLoading, selectedTask, selectedTaskId, tasksQ.isLoading]);

  useEffect(() => {
    if (!selectedTask || isPhone) return;
    const id = window.requestAnimationFrame(() => detailsPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [isPhone, selectedTask]);

  const browserDetailQ = useQuery({
    queryKey: ['browser', 'workflowTask', selectedTask?.source === 'browser' ? selectedTask.id : null],
    enabled: selectedTask?.source === 'browser',
    queryFn: () => api.getBrowserWorkflowStatus(selectedTask!.id),
    refetchInterval: (query) => {
      const cached = query.state.data;
      const cachedStatus = cached && typeof cached === 'object'
        ? String((cached as Record<string, unknown>).status || '').toLowerCase()
        : '';
      if (
        selectedTask?.status === 'running' ||
        selectedTask?.status === 'pending' ||
        cachedStatus === 'running' ||
        cachedStatus === 'pending'
      ) {
        return 2000;
      }
      return false;
    },
  });

  const compoundDetailQ = useQuery({
    queryKey: ['compound', 'workflowTask', selectedTask?.source === 'compound' ? selectedTask.id : null],
    enabled: selectedTask?.source === 'compound',
    queryFn: () => api.getCompoundWorkflowStatus(selectedTask!.id),
    refetchInterval: (query) => {
      const cached = query.state.data;
      const cachedStatus = cached && typeof cached === 'object'
        ? String((cached as Record<string, unknown>).status || '').toLowerCase()
        : '';
      if (
        selectedTask?.status === 'running' ||
        selectedTask?.status === 'pending' ||
        selectedTask?.status === 'paused' ||
        cachedStatus === 'running' ||
        cachedStatus === 'pending' ||
        cachedStatus === 'paused'
      ) {
        return 2000;
      }
      return false;
    },
  });

  useEffect(() => {
    if (selectedTask?.source === 'browser' && selectedTask.id) {
      void browserDetailQ.refetch();
    }
  }, [browserDetailQ, selectedTask?.id, selectedTask?.progressPct, selectedTask?.source, selectedTask?.status]);

  useEffect(() => {
    if (selectedTask?.source === 'compound' && selectedTask.id) {
      void compoundDetailQ.refetch();
    }
  }, [compoundDetailQ, selectedTask?.id, selectedTask?.progressPct, selectedTask?.source, selectedTask?.status]);

  refreshTasksRef.current = () => {
    void tasksQ.refetch();
    void compoundQ.refetch();
    if (selectedTask?.source === 'browser') void browserDetailQ.refetch();
    if (selectedTask?.source === 'compound') void compoundDetailQ.refetch();
  };

  const browserCount = browserTasks.length;
  const compoundCount = compoundTasks.length;
  const totalCount = tasks.length;
  const runningCount = tasks.filter((task) => ['pending', 'running', 'paused'].includes(task.status.toLowerCase())).length;
  const detailLoading = (selectedTask?.source === 'browser' && browserDetailQ.isLoading) || (selectedTask?.source === 'compound' && compoundDetailQ.isLoading);
  const pageSubtitle = `${totalCount} tasks · ${runningCount} running`;
  const tabs = [
    { id: 'all', label: 'All Tasks', count: totalCount },
    { id: 'browser', label: 'Browser', count: browserCount },
    { id: 'compound', label: 'Compound', count: compoundCount },
  ] as const;

  const detailPane = selectedTask ? (
    detailLoading ? (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner />
      </div>
    ) : (
      <TaskDetailContent
        task={selectedTask}
        browserDetail={selectedTask.source === 'browser' ? (browserDetailQ.data as BrowserTaskDetail | null) : null}
        compoundDetail={selectedTask.source === 'compound' ? (compoundDetailQ.data as CompoundWorkflowStatusResponse | null) : null}
        onClose={closeTask}
      />
    )
  ) : (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-dim">
      Select a task to inspect progress, result payloads, diagnostics, and workflow events.
    </div>
  );

  return (
    <WorkspacePageShell
      title="Tasks"
      subtitle={pageSubtitle}
      hideHeader
      preHeader={(
        <EmailTabs
          tabs={tabs.map((tab) => ({ ...tab }))}
          activeTab={view}
          onSelectTab={(tabId) => {
            if (tabId === 'all' || tabId === 'browser' || tabId === 'compound') setTasksView(tabId);
          }}
        />
      )}
      preHeaderAffectsLayout
      preHeaderClassName="h-14 flex items-end"
      toolbar={(
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <PageSearchInput value={search} onChange={setSearch} placeholder="Search tasks..." />
          </div>
          <div ref={setViewportControlsTarget} className="ml-auto flex h-8 w-14 shrink-0 items-center justify-center" />
        </div>
      )}
      contentClassName=""
  >
      {viewportControlsTarget && typeof document !== 'undefined'
        ? createPortal(
            <div className="flex h-full w-full items-center justify-center">
              {viewportControls}
            </div>,
            viewportControlsTarget,
          )
        : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 overflow-hidden bg-surface">
        <div ref={tasksTableRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {(tasksQ.isLoading || compoundQ.isLoading) && tasks.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-text-dim">
              No tasks found.
            </div>
          ) : (
            <>
              <div className="sticky top-0 z-10 bg-surface relative">
                <table className="w-full border-collapse" style={tasksTableStyle}>
                  <SharedTableColGroupWithWidths table={tasksTable} columnWidths={tasksColumnWidths} visibleColumnIds={tasksVisibleColumnIds} fillerWidth={tasksFillWidth} controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH} />
                  <SharedTableHeader
                    table={tasksTable}
                    onAutoFitColumn={autoFitColumn}
                    visibleColumnIds={tasksVisibleColumnIds}
                    columnWidths={tasksColumnWidths}
                    fillerWidth={tasksFillWidth}
                    controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                  />
                </table>
              </div>
              <table className="w-full border-collapse" style={tasksTableStyle}>
                <SharedTableColGroupWithWidths table={tasksTable} columnWidths={tasksColumnWidths} visibleColumnIds={tasksVisibleColumnIds} fillerWidth={tasksFillWidth} controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH} />
                <tbody>
                  {tasksTable.getRowModel().rows.map((row) => {
                    const task = row.original;
                    const isActive = selectedTask?.id === task.id;
                    return (
                      <tr
                        key={row.id}
                        className={`group ${SHARED_TABLE_ROW_HEIGHT_CLASS} cursor-pointer text-sm transition-colors ${isActive ? 'bg-accent/10' : row.getIsSelected() ? 'bg-accent/8' : 'hover:bg-surface-hover/60'}`}
                        onClick={() => openTask(task.id)}
                        aria-selected={isActive}
                        tabIndex={0}
                        aria-label={`Open task details for ${task.goal}`}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          openTask(task.id);
                        }}
                      >
                        {(() => {
                          const cells = filterCellsByIds(row.getVisibleCells(), tasksVisibleColumnIds);
                          const trailingActionsCell = cells.length > 0 && cells[cells.length - 1]?.column.id === 'actions'
                            ? cells[cells.length - 1]
                            : null;
                          const leadingCells = trailingActionsCell ? cells.slice(0, -1) : cells;
                          return (
                            <>
                              {leadingCells.map((cell, index) => (
                                <td key={cell.id} className={sharedCellClassName(cell, `${SHARED_TABLE_ROW_HEIGHT_CLASS} px-3 py-0 ${index === leadingCells.length - 1 && !trailingActionsCell ? '__shared-last__' : ''}`)}>
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                              {tasksFillWidth > 0 && !trailingActionsCell ? <td aria-hidden="true" className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} px-0 py-0`} /> : null}
                              {trailingActionsCell ? (
                                <td key={trailingActionsCell.id} className={sharedCellClassName(trailingActionsCell, `${SHARED_TABLE_ROW_HEIGHT_CLASS} __shared-last__`)}>
                                  {flexRender(trailingActionsCell.column.columnDef.cell, trailingActionsCell.getContext())}
                                </td>
                              ) : null}
                            </>
                          );
                        })()}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        {!isPhone && selectedTask ? (
          <SidePanelContainer ref={detailsPanelRef} ariaLabel="Task details panel">
            <div id="task-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
              {detailPane}
            </div>
          </SidePanelContainer>
        ) : null}
        </div>
      </div>

      {isPhone && selectedTask ? (
        <BottomDrawerContainer onClose={closeTask} ariaLabel="Task details drawer">
          {detailPane}
        </BottomDrawerContainer>
      ) : null}
    </WorkspacePageShell>
  );
}
