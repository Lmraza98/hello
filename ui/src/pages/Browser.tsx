import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock3, RefreshCw } from 'lucide-react';
import { api, type BrowserWorkflowTask, type CompoundWorkflowSummary } from '../api';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/shared/PageHeader';
import { usePageContext } from '../contexts/PageContextProvider';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

function resolveTaskTabId(task: BrowserWorkflowTask): string | undefined {
  const diagnostics = task.diagnostics || {};
  const result = task.result || {};
  const fromDiagnostics = typeof diagnostics.tab_id === 'string' ? diagnostics.tab_id : undefined;
  const fromResult = typeof result.tab_id === 'string' ? result.tab_id : undefined;
  return fromDiagnostics || fromResult;
}

function fmtTime(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts)) return 'n/a';
  return new Date(ts * 1000).toLocaleTimeString();
}

function fmtIsoTime(ts?: string | null): string {
  if (!ts) return 'n/a';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'n/a';
  return d.toLocaleTimeString();
}

type UnifiedTaskRow = {
  source: 'browser' | 'compound';
  id: string;
  status: string;
  stage: string;
  progress_pct: number;
  tab_id?: string;
  updated_label: string;
  operation: string;
  goal: string;
  heartbeat_age_ms?: number | null;
  error_text?: string;
};

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
      return JSON.stringify(rec);
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
  const query = typeof workflow.original_query === 'string' ? workflow.original_query.trim() : '';
  if (query) return query;
  const name = typeof workflow.name === 'string' ? workflow.name.trim() : '';
  if (name) return name;
  const description = typeof workflow.description === 'string' ? workflow.description.trim() : '';
  if (description) return description;
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

export default function TasksPage() {
  const { setPageContext } = usePageContext();
  const [showFinished, setShowFinished] = useState(true);
  const [openErrorFor, setOpenErrorFor] = useState<UnifiedTaskRow | null>(null);
  useRegisterCapabilities(getPageCapability('tasks'));

  useEffect(() => {
    setPageContext({ listContext: 'tasks' });
  }, [setPageContext]);

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
        progress_pct: Number(task.progress_pct || 0),
        tab_id: resolveTaskTabId(task),
        updated_label: fmtTime(task.updated_at),
        operation,
        goal: browserGoal(task),
        heartbeat_age_ms: typeof task.heartbeat_age_ms === 'number' ? task.heartbeat_age_ms : null,
        error_text: summarizeError(task.error),
      };
    });
    const compoundRows: UnifiedTaskRow[] = compoundTasks.map((workflow) => {
      const total = Number(workflow.total_phases || 0);
      const done = Number(workflow.completed_phases || 0);
      const pct = total > 0 ? Math.round((done / total) * 100) : (workflow.status === 'completed' ? 100 : 0);
      return {
        source: 'compound',
        id: workflow.id,
        status: workflow.status,
        stage: workflow.current_phase_id || workflow.status || 'running',
        progress_pct: pct,
        updated_label: fmtIsoTime(workflow.heartbeat_at || workflow.started_at || workflow.created_at || null),
        operation: 'compound_workflow',
        goal: compoundGoal(workflow),
        heartbeat_age_ms: typeof workflow.heartbeat_age_ms === 'number' ? workflow.heartbeat_age_ms : null,
        error_text: summarizeError(workflow.error),
      };
    });
    return [...compoundRows, ...browserRows];
  }, [browserTasks, compoundTasks]);

  const columns: ColumnDef<UnifiedTaskRow>[] = useMemo(
    () => [
      { key: 'id', label: 'Task ID', className: 'w-[20%]' },
      { key: 'goal', label: 'Goal', className: 'w-[26%]' },
      { key: 'status', label: 'Status', className: 'w-[10%]' },
      { key: 'stage', label: 'Stage', className: 'w-[14%]' },
      { key: 'progress', label: 'Progress', className: 'w-[10%]' },
      { key: 'tab', label: 'Tab', className: 'w-[8%]' },
      { key: 'updated', label: 'Updated', className: 'w-[12%]' },
      { key: 'operation', label: 'Operation', className: 'w-[8%]' },
      { key: 'details', label: 'Details', className: 'w-[8%]' },
    ],
    []
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="pt-5 px-4 md:pt-8 md:px-8 pb-4 md:pb-8">
      <PageHeader
        title="Tasks"
        subtitle="Browser and compound workflow task monitoring"
        desktopActions={(
          <button
            type="button"
            onClick={() => {
              void tasksQ.refetch();
              void compoundQ.refetch();
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        )}
      />

      <div className="mb-4 rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1 text-sm font-semibold text-text">
            <Activity className="h-4 w-4" /> Tasks
          </h2>
          <label className="inline-flex items-center gap-2 text-xs text-text-dim">
            <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} />
            Show finished
          </label>
        </div>
        <DataTable<UnifiedTaskRow>
          columns={columns}
          data={tasks}
          maxHeight="620px"
          minWidth="1200px"
          emptyState={<div className="text-xs text-text-dim">No tasks found.</div>}
          isLoading={tasksQ.isLoading || compoundQ.isLoading}
          renderRow={(task) => {
            const heartbeatText =
              typeof task.heartbeat_age_ms === 'number' && task.status === 'running'
                ? ` hb ${Math.max(0, Math.round(task.heartbeat_age_ms / 1000))}s`
                : '';
            return (
              <tr key={`${task.source}:${task.id}`} className="hover:bg-surface-hover/40 text-xs">
                <td className="px-4 py-2 font-medium text-text">{task.id}</td>
                <td className="max-w-[420px] truncate px-4 py-2 text-text" title={task.goal}>{task.goal}</td>
                <td className="px-4 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusPillClass(task.status)}`}>{task.status}</span>
                </td>
                <td className="px-4 py-2 text-text-dim">{task.stage}</td>
                <td className="px-4 py-2 text-text-dim">{task.progress_pct}%{heartbeatText}</td>
                <td className="px-4 py-2 text-text-dim">{task.tab_id || 'n/a'}</td>
                <td className="px-4 py-2 text-text-dim">{task.updated_label}</td>
                <td className="px-4 py-2 text-text-dim">{task.operation}</td>
                <td className="px-4 py-2 text-text-dim">
                  {task.status === 'failed' && task.error_text ? (
                    <button
                      type="button"
                      onClick={() => setOpenErrorFor(task)}
                      className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-100"
                    >
                      Open
                    </button>
                  ) : (
                    <span>n/a</span>
                  )}
                </td>
              </tr>
            );
          }}
        />
        {openErrorFor ? (
          <div className="mt-3 rounded border border-red-300 bg-red-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-red-800">
                Failure details: {openErrorFor.id}
              </p>
              <button
                type="button"
                onClick={() => setOpenErrorFor(null)}
                className="rounded border border-red-300 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-100"
              >
                Close
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words text-[11px] text-red-900">
              {openErrorFor.error_text || 'No error details available.'}
            </pre>
          </div>
        ) : null}
      </div>

      <div className="mb-3 rounded-lg border border-border bg-surface p-3">
        <h2 className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-text">
          <Clock3 className="h-4 w-4" /> Summary
        </h2>
        <div className="text-xs text-text-dim">
          Browser tasks: {browserTasks.length} | Compound workflows: {compoundTasks.length}
        </div>
      </div>
      </div>
    </div>
  );
}
