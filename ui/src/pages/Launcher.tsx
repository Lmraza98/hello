import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, MoreVertical, Square, X, XCircle } from 'lucide-react';
import { api, type LauncherCaseStatus, type LauncherRunRecord, type LauncherStartupState, type LauncherTestCase } from '../api';

type SuiteRow = {
  suiteId: string;
  suiteName: string;
  cases: LauncherTestCase[];
};

type StopMode = 'run' | 'after_current' | 'terminate_workers';

type PywebviewLauncherApi = {
  get_logs: () => Promise<string> | string;
  get_startup_state: () => Promise<LauncherStartupState> | LauncherStartupState;
  get_tests: () => Promise<LauncherTestCase[]> | LauncherTestCase[];
  get_test_status: () => Promise<Record<string, { status: LauncherCaseStatus; duration?: number | null }>> | Record<string, { status: LauncherCaseStatus; duration?: number | null }>;
  preview_plan: (testIds: string[], tags: string[]) => Promise<Array<{ order: number; id: string; name: string }>> | Array<{ order: number; id: string; name: string }>;
  run_plan: (testIds: string[], tags: string[]) => Promise<{ ok: boolean; run_id?: string; error?: string }> | { ok: boolean; run_id?: string; error?: string };
  stop: (mode: StopMode) => Promise<{ ok: boolean; mode: StopMode; error?: string }> | { ok: boolean; mode: StopMode; error?: string };
  cancel_current_test: () => Promise<void> | void;
  cancel_run: () => Promise<void> | void;
  get_runs: () => Promise<LauncherRunRecord[]> | LauncherRunRecord[];
  open_run_dir: (runId: string) => Promise<void> | void;
  get_diagnostics_summary: () => Promise<string> | string;
  open_app: () => Promise<void> | void;
};

function getPywebviewApi(): PywebviewLauncherApi | null {
  const holder = window as unknown as { pywebview?: { api?: PywebviewLauncherApi } };
  return holder.pywebview?.api ?? null;
}

async function resolve<T>(value: Promise<T> | T): Promise<T> {
  return await value;
}

function statusOrder(status: LauncherCaseStatus): number {
  if (status === 'running') return 0;
  if (status === 'queued') return 1;
  if (status === 'failed' || status === 'timed_out') return 2;
  if (status === 'passed') return 3;
  if (status === 'canceled') return 4;
  return 5;
}

function badgeForStatus(status: LauncherCaseStatus, done?: number, total?: number) {
  if (status === 'running') {
    const pct = total && total > 0 ? Math.max(2, Math.round((Math.max(0, done ?? 0) / total) * 100)) : 2;
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        RUNNING ({done ?? 0}/{total ?? 0})
        <span className="h-1 w-14 overflow-hidden rounded-full bg-cyan-900/80">
          <span className="block h-full bg-cyan-400" style={{ width: `${pct}%` }} />
        </span>
      </span>
    );
  }
  if (status === 'passed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-950/40 px-2 py-0.5 text-[10px] font-semibold text-green-300">
        <CheckCircle2 className="h-3 w-3" />
        PASSED
      </span>
    );
  }
  if (status === 'failed' || status === 'timed_out') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-950/40 px-2 py-0.5 text-[10px] font-semibold text-red-300">
        <XCircle className="h-3 w-3" />
        FAILED
      </span>
    );
  }
  if (status === 'queued') return <span className="rounded-full border border-violet-500/40 bg-violet-950/40 px-2 py-0.5 text-[10px] font-semibold text-violet-300">QUEUED</span>;
  if (status === 'canceled') return <span className="rounded-full border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300">CANCELED</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/40 bg-slate-900/40 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
      <Circle className="h-2.5 w-2.5" />
      IDLE
    </span>
  );
}

export default function LauncherPage() {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [startup, setStartup] = useState<LauncherStartupState | null>(null);
  const [tests, setTests] = useState<LauncherTestCase[]>([]);
  const [statusById, setStatusById] = useState<Record<string, { status: LauncherCaseStatus; duration?: number | null }>>({});
  const [runs, setRuns] = useState<LauncherRunRecord[]>([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>('');
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [collapsedSuites, setCollapsedSuites] = useState<Record<string, boolean>>({});
  const [tag, setTag] = useState('');
  const [kind, setKind] = useState('');
  const [outcome, setOutcome] = useState('');
  const [search, setSearch] = useState('');
  const [previewLine, setPreviewLine] = useState('');
  const [runMode, setRunMode] = useState<'headless' | 'headed'>('headless');
  const [workers, setWorkers] = useState<number>(1);
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [showStopMenu, setShowStopMenu] = useState(false);
  const [showIssuesDrawer, setShowIssuesDrawer] = useState(false);
  const [showArtifactsPopoverFor, setShowArtifactsPopoverFor] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);

  const suites = useMemo<SuiteRow[]>(() => {
    const grouped = new Map<string, SuiteRow>();
    tests.forEach((row) => {
      const key = row.suite_id;
      const existing = grouped.get(key);
      if (existing) existing.cases.push(row);
      else grouped.set(key, { suiteId: key, suiteName: row.suite_name || row.suite_id, cases: [row] });
    });
    return Array.from(grouped.values()).sort((a, b) => a.suiteName.localeCompare(b.suiteName));
  }, [tests]);

  const activeFilterCount = Number(Boolean(tag)) + Number(Boolean(kind)) + Number(Boolean(outcome)) + Number(Boolean(selectedSuiteId));

  const filteredSuites = useMemo(() => {
    return suites
      .map((suite) => ({
        ...suite,
        cases: suite.cases.filter((row) => {
          const st = statusById[row.id]?.status || 'idle';
          if (selectedSuiteId && row.suite_id !== selectedSuiteId) return false;
          if (tag && !row.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()))) return false;
          if (kind && row.kind !== kind) return false;
          if (outcome && st !== outcome) return false;
          return true;
        }),
      }))
      .filter((suite) => suite.cases.length > 0 || !selectedSuiteId);
  }, [suites, statusById, selectedSuiteId, tag, kind, outcome]);

  const visibleCases = useMemo(() => {
    const suite = filteredSuites.find((s) => s.suiteId === selectedSuiteId) || filteredSuites[0];
    if (!suite) return [];
    return suite.cases
      .filter((c) => `${c.name} ${c.file_path || ''}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const sa = statusById[a.id]?.status || 'idle';
        const sb = statusById[b.id]?.status || 'idle';
        return statusOrder(sa) - statusOrder(sb);
      });
  }, [filteredSuites, selectedSuiteId, search, statusById]);

  const selectedCase = useMemo(() => visibleCases.find((row) => row.id === selectedCaseId) || visibleCases[0] || null, [visibleCases, selectedCaseId]);
  const activeRun = runs.find((r) => r.status === 'running' || r.status === 'queued');
  const latestRun = runs[0] || null;

  const latestRunCounts = useMemo(() => {
    if (!latestRun?.tests) return { passed: 0, failed: 0, durationLabel: '0m00s' };
    const passed = latestRun.tests.filter((t) => t.status === 'passed').length;
    const failed = latestRun.tests.filter((t) => t.status === 'failed' || t.status === 'timed_out').length;
    const durationSec = Math.floor(Number(latestRun.duration_sec || 0));
    return { passed, failed, durationLabel: `${Math.floor(durationSec / 60)}m${String(durationSec % 60).padStart(2, '0')}s` };
  }, [latestRun]);

  const refreshAll = async () => {
    const bridge = getPywebviewApi();
    const [startupState, testRows, statusRows, runRows] = bridge
      ? await Promise.all([
          resolve(bridge.get_startup_state()),
          resolve(bridge.get_tests()),
          resolve(bridge.get_test_status()),
          resolve(bridge.get_runs()),
        ])
      : await Promise.all([
          api.admin.launcher.getStartupState(),
          api.admin.launcher.getTests(),
          api.admin.launcher.getStatus(),
          api.admin.launcher.listRuns(),
        ]);
    setStartup(startupState);
    setTests(testRows);
    setStatusById(statusRows);
    setRuns(runRows);
    if (!selectedSuiteId && testRows[0]) setSelectedSuiteId(testRows[0].suite_id);
    if (!selectedCaseId && testRows[0]) setSelectedCaseId(testRows[0].id);
  };

  useEffect(() => {
    void refreshAll();
    const id = window.setInterval(() => void refreshAll(), 1200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (selectedCase && selectedCase.id !== selectedCaseId) setSelectedCaseId(selectedCase.id);
  }, [selectedCase, selectedCaseId]);

  const clearFilters = () => {
    setTag('');
    setKind('');
    setOutcome('');
    setSelectedSuiteId('');
  };

  const idsForRun = () => (selectedCaseIds.size > 0 ? Array.from(selectedCaseIds) : visibleCases.map((c) => c.id));

  const handlePreview = async () => {
    const bridge = getPywebviewApi();
    const plan = bridge
      ? await resolve(bridge.preview_plan(idsForRun(), []))
      : await api.admin.launcher.previewPlan({ test_ids: idsForRun(), tags: [] });
    setPreviewLine(plan.map((row) => `${row.order}:${row.id}`).join(' -> ') || 'No plan');
  };

  const handleRun = async (ids?: string[]) => {
    if (loadingRun) return;
    setLoadingRun(true);
    try {
      const bridge = getPywebviewApi();
      if (bridge) await resolve(bridge.run_plan(ids || idsForRun(), []));
      else await api.admin.launcher.run({ test_ids: ids || idsForRun(), tags: [] });
      await refreshAll();
    } finally {
      setLoadingRun(false);
    }
  };

  const handleStop = async (mode: StopMode) => {
    setShowStopMenu(false);
    const bridge = getPywebviewApi();
    if (bridge) {
      if (bridge.stop) {
        await resolve(bridge.stop(mode));
      } else if (mode === 'after_current') {
        await resolve(bridge.cancel_current_test());
      } else {
        await resolve(bridge.cancel_run());
      }
    } else {
      await api.admin.launcher.stop(mode);
    }
    await refreshAll();
  };

  const copyLogs = async () => {
    const bridge = getPywebviewApi();
    const text = bridge ? await resolve(bridge.get_logs()) : JSON.stringify({ runs, statusById }, null, 2);
    await navigator.clipboard.writeText(text);
    setShowUtilityMenu(false);
  };

  const copyDiagnostics = async () => {
    const bridge = getPywebviewApi();
    const text = bridge
      ? await resolve(bridge.get_diagnostics_summary())
      : JSON.stringify({ startup, runMode, workers, selectedCaseId }, null, 2);
    await navigator.clipboard.writeText(text);
    setShowUtilityMenu(false);
  };

  const openArtifact = async (runId: string, kind: 'json' | 'junit' | 'events' | 'stdout') => {
    const bridge = getPywebviewApi();
    if (bridge) {
      const run = runs.find((row) => row.run_id === runId);
      const path = run?.artifacts?.[kind];
      if (path) await navigator.clipboard.writeText(path);
      return;
    }
    const out = await api.admin.launcher.getRunArtifact(runId, kind);
    if (out.path) await navigator.clipboard.writeText(out.path);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <div className="text-base font-semibold text-text">Launcher Test Orchestration</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="rounded-full border border-border px-2 py-0.5">Backend</span>
          <span className="rounded-full border border-border px-2 py-0.5">Bridge</span>
          <button type="button" onClick={() => setShowIssuesDrawer(true)} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${startup?.issues?.length ? 'border-red-500/50 bg-red-900/20 text-red-300' : 'border-border'}`}>
            <AlertTriangle className="h-3 w-3" />
            startup issues: {startup?.issues?.length ?? 0}
          </button>
        </div>
      </div>

      <div className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const bridge = getPywebviewApi();
              if (bridge) await resolve(bridge.open_app());
              else window.open('/', '_blank');
            }}
            className="rounded-md border border-border px-2.5 py-1 text-xs"
          >
            Open App
          </button>
          <button type="button" disabled={loadingRun} onClick={() => void handleRun()} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Run Selected</button>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button type="button" onClick={() => setShowUtilityMenu((v) => !v)} className="rounded-md border border-border p-1.5"><MoreVertical className="h-4 w-4 text-text-muted" /></button>
              {showUtilityMenu ? (
                <div className="absolute right-0 top-9 z-20 w-40 rounded-md border border-border bg-bg p-1 shadow-xl">
                  <button type="button" onClick={copyLogs} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-surface-hover">Copy Logs</button>
                  <button type="button" onClick={copyDiagnostics} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-surface-hover">Copy Diagnostics</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg/30 p-2">
          <button type="button" onClick={() => void refreshAll()} className="rounded border border-border px-2 py-1 text-xs">Refresh</button>
          <button type="button" onClick={() => void handlePreview()} className="rounded border border-border px-2 py-1 text-xs">Preview Run Plan</button>
          <button type="button" onClick={() => void handleRun(Array.from(selectedCaseIds))} className="rounded border border-border px-2 py-1 text-xs">Run Selected/Filtered</button>
          <div className="relative">
            <button type="button" onClick={() => setShowStopMenu((v) => !v)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"><Square className="h-3 w-3" />Stop</button>
            {showStopMenu ? (
              <div className="absolute left-0 top-8 z-20 w-48 rounded-md border border-border bg-bg p-1 shadow-xl">
                <button type="button" onClick={() => void handleStop('run')} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-surface-hover">Stop run</button>
                <button type="button" onClick={() => void handleStop('after_current')} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-surface-hover">Stop after current test</button>
                <button type="button" onClick={() => void handleStop('terminate_workers')} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-surface-hover">Terminate workers</button>
              </div>
            ) : null}
          </div>
          <label className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs">Run
            <select value={runMode} onChange={(e) => setRunMode(e.target.value as 'headless' | 'headed')} className="bg-transparent text-xs outline-none">
              <option value="headless">Headless</option><option value="headed">Headed</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs">Workers
            <input type="number" min={1} max={32} value={workers} onChange={(e) => setWorkers(Math.max(1, Number(e.target.value) || 1))} className="w-10 bg-transparent text-xs outline-none" />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg/30 p-2">
          <label className={`inline-flex min-w-[230px] items-center gap-1 rounded-full border px-2 py-1 text-xs ${search ? 'border-blue-500 ring-1 ring-blue-500' : 'border-border'}`}>
            <span>/</span>
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search cases or files" className="min-w-0 flex-1 bg-transparent outline-none" />
            {search ? <button type="button" onClick={() => setSearch('')} className="rounded border border-border p-0.5"><X className="h-3 w-3" /></button> : null}
          </label>
          <label className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs">tag <input value={tag} onChange={(e) => setTag(e.target.value)} className="w-16 bg-transparent outline-none" /></label>
          <label className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs">suite <select value={selectedSuiteId} onChange={(e) => setSelectedSuiteId(e.target.value)} className="bg-transparent text-xs"><option value="">all</option>{suites.map((s) => <option key={s.suiteId} value={s.suiteId}>{s.suiteName}</option>)}</select></label>
          <label className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs">kind <select value={kind} onChange={(e) => setKind(e.target.value)} className="bg-transparent text-xs"><option value="">all</option><option value="unit">unit</option><option value="integration">integration</option><option value="live">live</option><option value="smoke">smoke</option><option value="custom">custom</option></select></label>
          <label className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs">outcome <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="bg-transparent text-xs"><option value="">all</option><option value="idle">idle</option><option value="queued">queued</option><option value="running">running</option><option value="passed">passed</option><option value="failed">failed</option><option value="canceled">canceled</option><option value="timed_out">timed_out</option></select></label>
          {activeFilterCount > 0 ? <button type="button" onClick={clearFilters} className="rounded border border-border px-2 py-1 text-xs">Clear all</button> : null}
        </div>

        {latestRun ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg/20 px-2 py-1 text-xs text-text-muted">
            <span>Last run: {latestRun.status}</span>
            <button type="button" onClick={() => setOutcome('failed')} className="rounded-full border border-border px-2 py-0.5">failed ({latestRunCounts.failed})</button>
            <button type="button" onClick={() => setOutcome('passed')} className="rounded-full border border-border px-2 py-0.5">passed ({latestRunCounts.passed})</button>
            <span>duration {latestRunCounts.durationLabel}</span>
          </div>
        ) : null}
        {previewLine ? <div className="mt-1 text-xs text-text-muted">{previewLine}</div> : null}
      </div>

      <div className="scrollbar-native flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="scrollbar-native rounded-md border border-border bg-bg/30 p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Suites / Files</div>
            <div className="space-y-2">
              {filteredSuites.map((suite) => {
                const collapsed = collapsedSuites[suite.suiteId] ?? false;
                const statuses = suite.cases.map((c) => statusById[c.id]?.status || 'idle');
                const done = statuses.filter((s) => ['passed', 'failed', 'canceled', 'timed_out'].includes(s)).length;
                const running = statuses.some((s) => s === 'running' || s === 'queued');
                const state: LauncherCaseStatus = running ? 'running' : statuses.includes('failed') ? 'failed' : statuses.every((s) => s === 'passed') && statuses.length > 0 ? 'passed' : 'idle';
                return (
                  <div key={suite.suiteId} className="rounded-md border border-border bg-surface">
                    <div className="flex items-center justify-between gap-2 px-2 py-2">
                      <button type="button" onClick={() => setCollapsedSuites((prev) => ({ ...prev, [suite.suiteId]: !collapsed }))} className="min-w-0 text-left">
                        <div className="truncate text-sm font-medium text-text">{suite.suiteName}</div>
                        <div className="text-[11px] text-text-muted">{suite.cases.length} match(es)</div>
                      </button>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => void handleRun(suite.cases.map((c) => c.id))} className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white">Run</button>
                        {badgeForStatus(state, done, suite.cases.length)}
                      </div>
                    </div>
                    {!collapsed ? (
                      <div className="space-y-1 border-t border-border p-2">
                        {suite.cases.map((row) => {
                          const rowStatus = statusById[row.id]?.status || 'idle';
                          const isSelected = selectedCaseId === row.id;
                          const checked = selectedCaseIds.has(row.id);
                          return (
                            <div key={row.id} className={`group flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs ${isSelected ? 'border-l-4 border-blue-500 bg-blue-900/20' : 'hover:bg-surface-hover'}`}>
                              <button type="button" onClick={() => { setSelectedCaseId(row.id); setSelectedSuiteId(row.suite_id); }} className="min-w-0 flex-1 text-left">
                                <div className="truncate text-text">{row.name}</div>
                                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted">
                                  <span className="rounded border border-border px-1.5 py-0.5">{row.marker || row.kind}</span>
                                  <span className="truncate" title={row.file_path || ''}>{row.file_path?.split('/').slice(-1)[0] || row.id}</span>
                                </div>
                              </button>
                              <div className="flex items-center gap-1">
                                <input type="checkbox" checked={checked} onChange={(e) => setSelectedCaseIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(row.id);
                                  else next.delete(row.id);
                                  return next;
                                })} />
                                {badgeForStatus(rowStatus)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="scrollbar-native rounded-md border border-border bg-bg/30 p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Cases</div>
            <div className="space-y-1">
              {visibleCases.map((row) => {
                const rowStatus = statusById[row.id]?.status || 'idle';
                const isSelected = selectedCase?.id === row.id;
                return (
                  <div key={row.id} className={`group flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs ${isSelected ? 'border-l-4 border-blue-500 bg-blue-900/25' : 'hover:bg-surface-hover'}`}>
                    <button type="button" onClick={() => setSelectedCaseId(row.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-text">{row.name}</div>
                      <div className="truncate text-[10px] text-text-muted">{row.id}</div>
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px]">{row.marker || row.kind}</span>
                      {badgeForStatus(rowStatus)}
                      <button type="button" title={row.file_path || ''} onClick={async () => { if (row.file_path) await navigator.clipboard.writeText(row.file_path); }} className="invisible rounded border border-border px-1 py-0.5 text-[10px] group-hover:visible">copy</button>
                    </div>
                  </div>
                );
              })}
              {visibleCases.length === 0 ? <div className="text-xs text-text-muted">No cases match current filters.</div> : null}
            </div>
          </section>
        </div>

        <section className="mt-3 rounded-md border border-border bg-bg/30 p-2">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Artifacts</div>
          <div className="space-y-1">
            {runs.map((run) => (
              <div key={run.run_id} className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1 text-xs">
                <div className="flex min-w-0 items-center gap-2 text-text-muted">
                  <span className={`h-2 w-2 rounded-full ${run.status === 'passed' ? 'bg-green-500' : run.status === 'failed' ? 'bg-red-500' : run.status === 'running' ? 'bg-cyan-500' : 'bg-amber-500'}`} />
                  <span>{run.finished_at || run.started_at || 'n/a'}</span>
                  <span className="truncate">{run.selected_test_ids?.length || 0} tests</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={async () => {
                      const bridge = getPywebviewApi();
                      if (bridge) await resolve(bridge.open_run_dir(run.run_id));
                      else await api.admin.launcher.openRunDir(run.run_id);
                    }}
                    className="rounded border border-border px-2 py-0.5"
                  >
                    Artifacts
                  </button>
                  <div className="relative">
                    <button type="button" onClick={() => setShowArtifactsPopoverFor((v) => (v === run.run_id ? null : run.run_id))} className="rounded border border-border px-1.5 py-0.5 text-[10px]">JSON/JUnit</button>
                    {showArtifactsPopoverFor === run.run_id ? (
                      <div className="absolute right-0 top-7 z-20 w-28 rounded border border-border bg-bg p-1">
                        <button type="button" onClick={() => void openArtifact(run.run_id, 'json')} className="w-full rounded px-2 py-1 text-left text-[10px] hover:bg-surface-hover">JSON</button>
                        <button type="button" onClick={() => void openArtifact(run.run_id, 'junit')} className="w-full rounded px-2 py-1 text-left text-[10px] hover:bg-surface-hover">JUnit</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {runs.length === 0 ? <div className="text-xs text-text-muted">No runs yet.</div> : null}
          </div>
        </section>
      </div>

      {showIssuesDrawer ? (
        <aside className="fixed inset-y-0 right-0 z-30 w-[360px] border-l border-border bg-bg shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-sm font-semibold text-text">Startup Issues</div>
            <button type="button" onClick={() => setShowIssuesDrawer(false)} className="rounded border border-border px-2 py-1 text-xs">Close</button>
          </div>
          <div className="space-y-2 p-3">
            {startup?.issues?.map((issue) => (
              <div key={issue.code} className="rounded border border-border bg-surface p-2 text-xs">
                <div className="font-semibold text-red-300">{issue.code}</div>
                <div className="mt-1 text-text-muted">{issue.message}</div>
                <div className="mt-1 text-text">Fix: {issue.remediation}</div>
              </div>
            ))}
            {!startup?.issues?.length ? <div className="text-xs text-text-muted">No startup issues.</div> : null}
          </div>
        </aside>
      ) : null}

      {activeRun ? <div className="border-t border-border px-3 py-1 text-[11px] text-text-muted">Active run: <span className="font-mono">{activeRun.run_id}</span></div> : null}
    </div>
  );
}
