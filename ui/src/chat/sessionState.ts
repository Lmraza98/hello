import type { ReActObservation } from './reactLoop';
import type { Task } from './taskState';
import type { ActiveWorkItem } from '../assistant-core/domain/types';

export type SessionEntity = {
  entityType: string;
  entityId: string;
  label?: string;
  sourceTool?: string;
  score?: number;
  updatedAt: number;
};

export type ChatSessionState = {
  entities: SessionEntity[];
  activeEntity?: SessionEntity;
  browser?: BrowserSessionState;
  browserTasks?: BrowserTasksState;
  activeTask?: Task;
  activeWorkItem?: ActiveWorkItem;
};

export type BrowserSessionState = {
  active: boolean;
  tabId?: string;
  url?: string;
  title?: string;
  updatedAt: number;
};

export type BrowserTaskSummary = {
  taskId: string;
  status: string;
  stage?: string;
  progressPct?: number;
  operation?: string;
  updatedAt: number;
};

export type BrowserTasksState = {
  running: BrowserTaskSummary[];
  latest?: BrowserTaskSummary;
  updatedAt: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeEntity(record: Record<string, unknown>, sourceTool: string): SessionEntity | null {
  const entityType = String(record.entity_type || record.entityType || '').trim().toLowerCase();
  const entityId = String(record.entity_id || record.entityId || '').trim();
  if (!entityType || !entityId) return null;
  const label =
    (typeof record.title === 'string' && record.title.trim()) ||
    (typeof record.name === 'string' && record.name.trim()) ||
    undefined;
  const rawScore = Number(record.score_total ?? record.scoreTotal ?? 0);
  const score = Number.isFinite(rawScore) ? rawScore : undefined;
  return {
    entityType,
    entityId,
    label,
    sourceTool,
    score,
    updatedAt: Date.now(),
  };
}

function extractRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result
      .map((row) => asObject(row))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }
  const obj = asObject(result);
  if (!obj) return [];
  const candidates = [obj.results, obj.items];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    return list
      .map((row) => asObject(row))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }
  return [];
}

export function extractEntitiesFromObservations(
  observations: Array<{ name: string; ok: boolean; result?: unknown }>
): SessionEntity[] {
  const out: SessionEntity[] = [];
  for (const obs of observations) {
    if (!obs.ok) continue;
    if (obs.name !== 'hybrid_search' && obs.name !== 'resolve_entity' && obs.name !== 'search_contacts' && obs.name !== 'search_companies') {
      continue;
    }
    const rows = extractRows(obs.result);
    for (const row of rows) {
      const normalized = normalizeEntity(row, obs.name);
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

export function extractBrowserSessionFromObservations(
  observations: Array<{ name: string; ok: boolean; result?: unknown }>
): BrowserSessionState | undefined {
  // Prefer the last successful browser-ish observation in the batch.
  for (const obs of [...observations].reverse()) {
    if (!obs.ok) continue;
    const obj = asObject(obs.result);
    if (!obj) continue;

    let tabId =
      (typeof obj.tab_id === 'string' && obj.tab_id) ||
      (typeof obj.tabId === 'string' && obj.tabId) ||
      (typeof obj.active_tab_id === 'string' && obj.active_tab_id) ||
      (typeof obj.activeTabId === 'string' && obj.activeTabId) ||
      undefined;

    let url = typeof obj.url === 'string' ? obj.url : undefined;
    let title = typeof obj.title === 'string' ? obj.title : undefined;

    // browser_tabs returns { tabs: [...], active_tab_id }
    const tabs = Array.isArray(obj.tabs) ? (obj.tabs as unknown[]) : null;
    if (tabs && tabId) {
      const active = tabs.find((t) => {
        const rec = asObject(t);
        return rec && String(rec.id || '').trim() === tabId;
      });
      const activeObj = active ? asObject(active) : null;
      if (activeObj) {
        if (!url && typeof activeObj.url === 'string') url = activeObj.url;
        if (!title && typeof activeObj.title === 'string') title = activeObj.title;
      }
    }

    if (!tabId && obs.name.startsWith('browser_')) {
      // Some browser tools may omit tab_id in certain failure modes; treat as non-update.
      continue;
    }

    if (!tabId) continue;
    return {
      active: true,
      tabId,
      url,
      title,
      updatedAt: Date.now(),
    };
  }
  return undefined;
}

function asTaskSummary(record: Record<string, unknown>): BrowserTaskSummary | null {
  const taskId = typeof record.task_id === 'string' ? record.task_id.trim() : '';
  const status = typeof record.status === 'string' ? record.status.trim() : '';
  if (!taskId || !status) return null;
  const stage = typeof record.stage === 'string' ? record.stage : undefined;
  const progressRaw = Number(record.progress_pct);
  const progressPct = Number.isFinite(progressRaw) ? progressRaw : undefined;
  const diagnostics = asObject(record.diagnostics);
  const operation = diagnostics && typeof diagnostics.operation === 'string' ? diagnostics.operation : undefined;
  return {
    taskId,
    status,
    stage,
    progressPct,
    operation,
    updatedAt: Date.now(),
  };
}

export function extractBrowserTasksFromObservations(
  observations: Array<{ name: string; ok: boolean; result?: unknown }>
): BrowserTasksState | undefined {
  const running: BrowserTaskSummary[] = [];
  let latest: BrowserTaskSummary | undefined;
  for (const obs of observations) {
    if (!obs.ok) continue;
    const obj = asObject(obs.result);
    if (!obj) continue;
    const rows = Array.isArray(obj.tasks) ? obj.tasks : [];
    if (rows.length > 0) {
      for (const row of rows) {
        const rec = asObject(row);
        if (!rec) continue;
        const summary = asTaskSummary(rec);
        if (!summary) continue;
        if (summary.status === 'pending' || summary.status === 'running') running.push(summary);
        latest = summary;
      }
      continue;
    }
    if (typeof obj.task_id === 'string' && typeof obj.status === 'string') {
      const summary = asTaskSummary(obj);
      if (summary) {
        if (summary.status === 'pending' || summary.status === 'running') running.push(summary);
        latest = summary;
      }
    }
  }
  if (running.length === 0 && !latest) return undefined;
  return {
    running,
    latest,
    updatedAt: Date.now(),
  };
}

export function mergeSessionState(
  prev: ChatSessionState | undefined,
  entities: SessionEntity[],
  browserUpdate?: BrowserSessionState,
  browserTasksUpdate?: BrowserTasksState
): ChatSessionState | undefined {
  if (!prev && entities.length === 0 && !browserUpdate && !browserTasksUpdate) return undefined;
  const merged = new Map<string, SessionEntity>();
  for (const entity of prev?.entities || []) {
    merged.set(`${entity.entityType}:${entity.entityId}`, entity);
  }
  for (const entity of entities) {
    const key = `${entity.entityType}:${entity.entityId}`;
    const existing = merged.get(key);
    if (!existing || entity.updatedAt >= existing.updatedAt) {
      merged.set(key, entity);
    }
  }
  const all = [...merged.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || (b.score || 0) - (a.score || 0))
    .slice(0, 40);
  const active = all[0];
  const browser =
    browserUpdate && (!prev?.browser || browserUpdate.updatedAt >= prev.browser.updatedAt)
      ? browserUpdate
      : prev?.browser;
  const browserTasks =
    browserTasksUpdate && (!prev?.browserTasks || browserTasksUpdate.updatedAt >= prev.browserTasks.updatedAt)
      ? browserTasksUpdate
      : prev?.browserTasks;
  return {
    entities: all,
    activeEntity: active,
    ...(browser ? { browser } : {}),
    ...(browserTasks ? { browserTasks } : {}),
  };
}

export function withSessionContext(userMessage: string, session: ChatSessionState | undefined): string {
  if (!session || (session.entities.length === 0 && !session.browser?.active && !(session.browserTasks?.running?.length))) return userMessage;
  const recent = session.entities.slice(0, 5).map((entity) => ({
    entity_type: entity.entityType,
    entity_id: entity.entityId,
    label: entity.label || null,
    score: entity.score ?? null,
  }));
  const browser = session.browser?.active
    ? {
        active: true,
        tab_id: session.browser.tabId || null,
        url: session.browser.url || null,
        title: session.browser.title || null,
        updated_at: session.browser.updatedAt,
      }
    : null;
  const entityBlock = `${userMessage}\n\n[SESSION_ENTITIES]\n${JSON.stringify({
    active: session.activeEntity
      ? {
          entity_type: session.activeEntity.entityType,
          entity_id: session.activeEntity.entityId,
          label: session.activeEntity.label || null,
        }
      : null,
    recent,
  })}\n[/SESSION_ENTITIES]`;
  if (!browser) return entityBlock;
  const browserBlock = `${entityBlock}\n\n[BROWSER_SESSION]\n${JSON.stringify(browser)}\n[/BROWSER_SESSION]`;
  const runningTasks = session.browserTasks?.running || [];
  if (runningTasks.length === 0) return browserBlock;
  return `${browserBlock}\n\n[BROWSER_TASKS]\n${JSON.stringify({
    running_tasks: runningTasks.slice(0, 10).map((task) => ({
      task_id: task.taskId,
      status: task.status,
      stage: task.stage || null,
      progress_pct: task.progressPct ?? null,
      operation: task.operation || null,
    })),
    updated_at: session.browserTasks?.updatedAt || Date.now(),
  })}\n[/BROWSER_TASKS]`;
}

export type { ReActObservation };
