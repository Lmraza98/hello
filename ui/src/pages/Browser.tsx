import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, X } from 'lucide-react';
import { api, type BrowserWorkflowTask, type CompoundWorkflowStatusResponse, type CompoundWorkflowSummary } from '../api';
import { HeaderActionButton } from '../components/shared/HeaderActionButton';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import { EmailTabs } from '../components/email/EmailTabs';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { usePageContext } from '../contexts/PageContextProvider';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';
import { useIsMobile } from '../hooks/useIsMobile';

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
  const view = useMemo(() => parseTasksView(searchParams?.get('view') ?? null), [searchParams]);
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
    const q = search.trim().toLowerCase();
    const viewFiltered = tasks.filter((task) => {
      if (view === 'browser') return task.source === 'browser';
      if (view === 'compound') return task.source === 'compound';
      return true;
    });
    if (!q) return viewFiltered;
    return viewFiltered.filter((task) =>
      [task.id, task.goal, task.status, task.stage, task.operation, task.tabId || '', task.errorText || '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [search, tasks, view]);

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
      preHeaderClassName="-mt-3 md:-mt-4 h-14 flex items-end"
      toolbar={(
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <PageSearchInput value={search} onChange={setSearch} placeholder="Search tasks..." />
          </div>
          <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-xs text-text-dim">
            <input type="checkbox" checked={showFinished} onChange={(event) => setShowFinished(event.target.checked)} />
            Show finished
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
            <span className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3">Running {runningCount}</span>
            <span className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3">Browser {browserCount}</span>
            <span className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3">Compound {compoundCount}</span>
          </div>
          <HeaderActionButton
            onClick={() => {
              void tasksQ.refetch();
              void compoundQ.refetch();
              if (selectedTask?.source === 'browser') void browserDetailQ.refetch();
              if (selectedTask?.source === 'compound') void compoundDetailQ.refetch();
            }}
            variant="secondary"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh
          </HeaderActionButton>
        </div>
      )}
      contentClassName="overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-hidden pt-2">
        <div className="flex h-full min-h-0 overflow-hidden bg-surface">
        <div className="min-w-0 flex-1 overflow-auto">
          {(tasksQ.isLoading || compoundQ.isLoading) && tasks.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-text-dim">
              No tasks found.
            </div>
          ) : (
            <table className="w-full min-w-[1120px] table-fixed">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="h-9 border-b border-border-subtle bg-surface-hover/30">
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[20%]">Goal</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[11%]">Status</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[14%]">Stage</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[10%]">Progress</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[12%]">Updated</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[13%]">Operation</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[12%]">Task ID</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted w-[8%]">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredTasks.map((task) => {
                  const isActive = selectedTask?.id === task.id;
                  const heartbeatText = task.status.toLowerCase() === 'running' && typeof task.heartbeatAgeMs === 'number'
                    ? ` | hb ${Math.max(0, Math.round(task.heartbeatAgeMs / 1000))}s`
                    : '';
                  return (
                    <tr
                      key={`${task.source}:${task.id}`}
                      className={`group h-[42px] cursor-pointer text-sm transition-colors ${isActive ? 'bg-accent/10' : 'hover:bg-surface-hover/60'}`}
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
                      <td className="h-[42px] px-3 py-0 align-middle leading-tight">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text" title={task.goal}>{task.goal}</p>
                          {task.errorText ? (
                            <p className="mt-0.5 truncate text-xs text-red-600">{task.errorText}</p>
                          ) : (
                            <p className="mt-0.5 truncate text-xs text-text-dim">{task.tabId ? `Tab ${task.tabId}` : 'No tab binding'}</p>
                          )}
                        </div>
                      </td>
                      <td className="h-[42px] px-3 py-0 align-middle leading-tight">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusPillClass(task.status)}`}>{task.status}</span>
                      </td>
                      <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{task.stage}</td>
                      <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{task.progressPct}%{heartbeatText}</td>
                      <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{task.updatedLabel}</td>
                      <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{task.operation}</td>
                      <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">
                        <span className="block truncate" title={task.id}>{task.id}</span>
                      </td>
                      <td className="h-[42px] px-3 py-0 align-middle text-xs leading-tight text-text-dim">{task.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
