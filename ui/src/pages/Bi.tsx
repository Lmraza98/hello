import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BiCoverageCompany, type BiRun, type BiSourceRun } from '../api';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

type TabKey = 'overview' | 'sources' | 'runs' | 'companies' | 'events' | 'errors';

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function relTime(value: string | null | undefined): string {
  if (!value) return '-';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '-';
  const diff = Date.now() - ts;
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusClass(status: string): string {
  if (status === 'ok' || status === 'healthy') return 'text-green-700 bg-green-50 border-green-200';
  if (status === 'degraded') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (status === 'failed' || status === 'down') return 'text-red-700 bg-red-50 border-red-200';
  return 'text-text-muted bg-bg border-border';
}

export default function Bi() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('overview');
  const [runsStatusFilter, setRunsStatusFilter] = useState('');
  const [companyQuery, setCompanyQuery] = useState('');
  const [eventsSourceFilter, setEventsSourceFilter] = useState('');
  const [eventsOkFilter, setEventsOkFilter] = useState<'all' | 'ok' | 'failed'>('all');
  const [selectedCompany, setSelectedCompany] = useState<BiCoverageCompany | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  useRegisterCapabilities(getPageCapability(`bi.${tab}`));

  const overviewQuery = useQuery({ queryKey: ['bi-overview'], queryFn: api.getBiOverview, refetchInterval: 15000 });
  const sourcesQuery = useQuery({ queryKey: ['bi-sources'], queryFn: api.getBiSources, refetchInterval: 15000 });
  const runsQuery = useQuery({
    queryKey: ['bi-runs', runsStatusFilter],
    queryFn: () => api.getBiRuns({ limit: 100, status: runsStatusFilter || undefined }),
    refetchInterval: 15000,
  });
  const companiesQuery = useQuery({
    queryKey: ['bi-companies', companyQuery],
    queryFn: () => api.getBiCompaniesCoverage({ q: companyQuery || undefined, limit: 300 }),
    refetchInterval: 20000,
  });
  const companyDetailQuery = useQuery({
    queryKey: ['bi-company-detail', selectedCompany?.id],
    queryFn: () => api.getBiCompanyDetail(selectedCompany!.id),
    enabled: Boolean(selectedCompany?.id),
  });
  const eventsQuery = useQuery({
    queryKey: ['bi-events', eventsSourceFilter, eventsOkFilter],
    queryFn: () =>
      api.getBiEvents({
        source: eventsSourceFilter || undefined,
        ok: eventsOkFilter === 'all' ? undefined : eventsOkFilter === 'ok',
        limit: 500,
      }),
    refetchInterval: 15000,
  });
  const errorsQuery = useQuery({
    queryKey: ['bi-errors'],
    queryFn: () => api.getBiErrors({ hours: 24 }),
    refetchInterval: 15000,
  });
  const sourceConfigQuery = useQuery({
    queryKey: ['bi-source-config'],
    queryFn: api.getBiSourceConfig,
    refetchInterval: 30000,
  });

  const saveConfigMutation = useMutation({
    mutationFn: (values: Record<string, string>) => api.updateBiSourceConfig(values),
    onSuccess: (res) => {
      setDraftValues(res.values);
      void queryClient.invalidateQueries({ queryKey: ['bi-source-config'] });
      void queryClient.invalidateQueries({ queryKey: ['bi-sources'] });
    },
  });

  const baseValues = sourceConfigQuery.data?.values || {};
  const values = Object.keys(draftValues).length > 0 ? draftValues : baseValues;
  const hasUnsaved = useMemo(() => {
    const keys = new Set([...Object.keys(baseValues), ...Object.keys(values)]);
    for (const key of keys) {
      if ((baseValues[key] || '') !== (values[key] || '')) return true;
    }
    return false;
  }, [baseValues, values]);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'sources', label: 'Sources' },
    { key: 'runs', label: 'Runs' },
    { key: 'companies', label: 'Companies' },
    { key: 'events', label: 'Events' },
    { key: 'errors', label: 'Errors' },
  ];

  const toggleKeys = [
    'SALESNAV_ENABLED',
    'SALESNAV_SAFE_MODE',
    'APPSTORE_ENABLED',
    'PLAYSTORE_ENABLED',
    'GOOGLE_NEWS_ENABLED',
    'CRUNCHBASE_ENABLED',
    'WEBSITE_SIGNALS_ENABLED',
    'JOB_POSTINGS_ENABLED',
  ];

  const numericKeys = [
    'COLLECTOR_INTERVAL_MINUTES',
    'BI_SOURCE_COMPANY_POOL_LIMIT',
    'SALESNAV_MIN_INTERVAL_MINUTES',
    'SALESNAV_DAILY_MAX_REQUESTS',
    'SALESNAV_MAX_QUERIES_PER_CYCLE',
    'SALESNAV_MAX_COMPANIES',
    'APPSTORE_MAX_COMPANIES_PER_CYCLE',
    'PLAYSTORE_MAX_COMPANIES_PER_CYCLE',
    'GOOGLE_NEWS_MAX_COMPANIES_PER_CYCLE',
    'CRUNCHBASE_MAX_COMPANIES_PER_CYCLE',
    'WEBSITE_SIGNALS_MAX_COMPANIES_PER_CYCLE',
    'JOB_POSTINGS_MAX_COMPANIES_PER_CYCLE',
    'JOB_POSTINGS_MAX_RESULTS',
  ];

  const textKeys = ['SALESNAV_QUERIES', 'JOB_POSTINGS_COLLECT_URL'];
  const setValue = (key: string, value: string) => setDraftValues((prev) => ({ ...baseValues, ...prev, [key]: value }));

  return (
    <div className="h-full overflow-hidden p-4 md:p-6 flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-semibold text-text">BI Data Layer Console</h1>
        <div className="text-xs text-text-muted">{overviewQuery.isFetching ? 'Refreshing...' : 'Live'}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`rounded border px-3 py-1 text-xs ${tab === item.key ? 'bg-surface border-text' : 'bg-bg border-border'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1 min-h-0 overflow-hidden">
      {tab === 'overview' && (
        <div className="h-full overflow-hidden space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className={`rounded-lg border p-3 ${statusClass(overviewQuery.data?.ingestion_status || 'idle')}`}>
              <div className="text-xs">Ingestion Status</div>
              <div className="font-semibold capitalize">{overviewQuery.data?.ingestion_status || '-'}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-text-muted">Median Age</div>
              <div className="font-semibold">{overviewQuery.data?.freshness.median_age_minutes ?? '-'} min</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-text-muted">P95 Age</div>
              <div className="font-semibold">{overviewQuery.data?.freshness.p95_age_minutes ?? '-'} min</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-text-muted">Events (1h)</div>
              <div className="font-semibold tabular-nums">{overviewQuery.data?.events_1h.collected ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-text-muted">Saved/Normalized (1h)</div>
              <div className="font-semibold tabular-nums">
                {(overviewQuery.data?.events_1h.saved ?? 0)} / {(overviewQuery.data?.events_1h.normalized ?? 0)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-text-muted">Error Rate (24h)</div>
              <div className="font-semibold">{overviewQuery.data?.error_rate_24h ?? 0}%</div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-sm font-medium mb-2">Last Successful Source Run</div>
              <div className="text-xs">{fmtDate(overviewQuery.data?.last_successful_source_run)}</div>
              <div className="text-xs text-text-muted">{relTime(overviewQuery.data?.last_successful_source_run)}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="text-sm font-medium mb-2">Top Failing Source (24h)</div>
              <div className="text-xs">{overviewQuery.data?.top_failing_source_24h || '-'}</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'sources' && (
        <div className="h-full overflow-hidden space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            {(sourcesQuery.data?.sources || []).map((s) => (
              <div key={s.source} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">{s.source}</div>
                  <span className={`rounded border px-2 py-0.5 text-[10px] capitalize ${statusClass(s.status)}`}>{s.status}</span>
                </div>
                <div className="text-xs text-text-muted">Last run: {relTime(s.last_run_at)} ({fmtDate(s.last_run_at)})</div>
                <div className="text-xs text-text-muted">Success: {s.success_rate_24h}%</div>
                <div className="text-xs text-text-muted">Collected/Saved: {s.collected_24h}/{s.saved_24h}</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-sm font-medium mb-2">Rate Limits</div>
            <div className="text-xs text-text-muted mb-1">
              SalesNav daily: {sourcesQuery.data?.salesnav_daily_requests_used ?? 0} / {sourcesQuery.data?.salesnav_daily_requests_max ?? 0}
            </div>
            <div className="h-2 w-full rounded bg-bg border border-border overflow-hidden mb-2">
              <div
                className="h-full bg-blue-500"
                style={{
                  width: `${Math.min(
                    100,
                    ((sourcesQuery.data?.salesnav_daily_requests_used ?? 0) / Math.max(1, sourcesQuery.data?.salesnav_daily_requests_max ?? 1)) * 100
                  )}%`,
                }}
              />
            </div>
            <div className="text-xs text-text-muted">Next run every ~{sourcesQuery.data?.collector_interval_minutes ?? 15} min</div>
          </div>

          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Source Controls</div>
              <button className="text-xs underline" onClick={() => setAdvanced((v) => !v)}>
                {advanced ? 'Hide Advanced' : 'Show Advanced'}
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                {toggleKeys.map((key) => (
                  <label key={key} className="flex items-center justify-between py-1">
                    <span className="text-xs">{key}</span>
                    <input
                      type="checkbox"
                      checked={(values[key] || '').toLowerCase() === 'true'}
                      onChange={(e) => setValue(key, e.target.checked ? 'true' : 'false')}
                    />
                  </label>
                ))}
              </div>
              {advanced && (
                <div>
                  {numericKeys.map((key) => (
                    <label key={key} className="flex items-center justify-between py-1 gap-2">
                      <span className="text-xs">{key}</span>
                      <input
                        type="number"
                        value={values[key] || ''}
                        onChange={(e) => setValue(key, e.target.value)}
                        className="w-24 rounded border border-border bg-bg px-2 py-1 text-xs"
                      />
                    </label>
                  ))}
                  {textKeys.map((key) => (
                    <label key={key} className="block py-1">
                      <div className="text-xs mb-1">{key}</div>
                      <input
                        type="text"
                        value={values[key] || ''}
                        onChange={(e) => setValue(key, e.target.value)}
                        className="w-full rounded border border-border bg-bg px-2 py-1 text-xs"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'runs' && (
        <div className="h-full min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col">
          <div className="mb-2 flex items-center gap-2">
            <label className="text-xs">Status</label>
            <select
              value={runsStatusFilter}
              onChange={(e) => setRunsStatusFilter(e.target.value)}
              className="rounded border border-border bg-bg px-2 py-1 text-xs"
            >
              <option value="">all</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
              <option value="running">running</option>
            </select>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[920px] text-left">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-xs">Run</th>
                  <th className="px-3 py-2 text-xs">Status</th>
                  <th className="px-3 py-2 text-xs text-right">Processed</th>
                  <th className="px-3 py-2 text-xs text-right">Inserted</th>
                  <th className="px-3 py-2 text-xs text-right">Updated</th>
                  <th className="px-3 py-2 text-xs text-right">Unchanged</th>
                  <th className="px-3 py-2 text-xs text-right">Signals</th>
                  <th className="px-3 py-2 text-xs">Started</th>
                  <th className="px-3 py-2 text-xs">Completed</th>
                </tr>
              </thead>
              <tbody>
                {(runsQuery.data?.results || []).map((row: BiRun) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="px-3 py-2 text-xs">{row.id}</td>
                    <td className="px-3 py-2 text-xs">{row.status}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.processed}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.inserted}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.updated}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.unchanged ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.signals_added ?? 0}</td>
                    <td className="px-3 py-2 text-xs" title={fmtDate(row.started_at)}>{relTime(row.started_at)}</td>
                    <td className="px-3 py-2 text-xs" title={fmtDate(row.completed_at)}>{relTime(row.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'companies' && (
        <div
          className={`h-full min-h-0 grid gap-3 ${
            selectedCompany
              ? 'grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)]'
              : 'grid-rows-[auto_minmax(0,1fr)]'
          }`}
        >
          <div className="flex items-center gap-2">
            <input
              value={companyQuery}
              onChange={(e) => setCompanyQuery(e.target.value)}
              placeholder="Search company/domain..."
              className="w-full max-w-md rounded border border-border bg-bg px-2 py-1 text-xs"
            />
          </div>
          <div className="min-h-0 rounded-lg border border-border bg-surface p-3 overflow-hidden">
            <div className="h-full min-h-0 overflow-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-xs">Company</th>
                    <th className="px-3 py-2 text-xs">Coverage</th>
                    <th className="px-3 py-2 text-xs">Freshness</th>
                    <th className="px-3 py-2 text-xs text-right">Signals</th>
                    <th className="px-3 py-2 text-xs text-right">Issues</th>
                    <th className="px-3 py-2 text-xs">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(companiesQuery.data?.results || []).map((row) => (
                    <tr key={row.id} className="border-b border-border/60 cursor-pointer hover:bg-bg/30" onClick={() => setSelectedCompany(row)}>
                      <td className="px-3 py-2 text-xs">
                        <div>{row.name}</div>
                        <div className="text-text-muted">{row.domain || '-'}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(row.coverage || {}).map(([source, present]) => (
                            <span key={source} className={`rounded border px-1.5 py-0.5 text-[10px] ${present ? 'bg-green-50 border-green-200 text-green-700' : 'bg-bg border-border text-text-muted'}`}>
                              {source}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div title={fmtDate(row.last_collected_at)}>{relTime(row.last_collected_at)}</div>
                        <div className="text-text-muted" title={fmtDate(row.last_normalized_at)}>{relTime(row.last_normalized_at)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums">{row.signal_count}</td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums">{row.failing_sources_count}</td>
                      <td className="px-3 py-2 text-xs">{row.status || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {selectedCompany && (
            <div className="min-h-0 rounded-lg border border-border bg-surface p-3 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <div className="text-sm font-medium">{selectedCompany.name} Detail</div>
                <button className="text-xs underline" onClick={() => setSelectedCompany(null)}>Close</button>
              </div>
              <div className="grid md:grid-cols-2 gap-3 flex-1 min-h-0">
                <div className="min-h-0 flex flex-col">
                  <div className="text-xs font-medium mb-1">Signals</div>
                  <div className="flex-1 min-h-0 overflow-auto border border-border rounded">
                    <table className="w-full min-w-[380px] text-left">
                      <thead className="sticky top-0 bg-surface z-10">
                        <tr className="border-b border-border">
                          <th className="px-2 py-1 text-[10px]">Type</th>
                          <th className="px-2 py-1 text-[10px]">Strength</th>
                          <th className="px-2 py-1 text-[10px]">Detected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(companyDetailQuery.data?.signals || []).map((s, idx) => (
                          <tr key={idx} className="border-b border-border/50">
                            <td className="px-2 py-1 text-[10px]">{String(s.signal_type || '-')}</td>
                            <td className="px-2 py-1 text-[10px]">{String(s.signal_strength || '-')}</td>
                            <td className="px-2 py-1 text-[10px]">{relTime(String(s.detected_at || ''))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="min-h-0 flex flex-col">
                  <div className="text-xs font-medium mb-1">Collection Logs</div>
                  <div className="flex-1 min-h-0 overflow-auto border border-border rounded">
                    <table className="w-full min-w-[380px] text-left">
                      <thead className="sticky top-0 bg-surface z-10">
                        <tr className="border-b border-border">
                          <th className="px-2 py-1 text-[10px]">Source</th>
                          <th className="px-2 py-1 text-[10px]">Result</th>
                          <th className="px-2 py-1 text-[10px]">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(companyDetailQuery.data?.collection_logs || []).map((r: BiSourceRun, idx: number) => (
                          <tr key={idx} className="border-b border-border/50">
                            <td className="px-2 py-1 text-[10px]">{r.source}</td>
                            <td className="px-2 py-1 text-[10px]">{r.ok ? 'ok' : 'failed'}</td>
                            <td className="px-2 py-1 text-[10px]">{relTime(r.started_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'events' && (
        <div className="h-full min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              value={eventsSourceFilter}
              onChange={(e) => setEventsSourceFilter(e.target.value)}
              placeholder="Source filter..."
              className="rounded border border-border bg-bg px-2 py-1 text-xs"
            />
            <select
              value={eventsOkFilter}
              onChange={(e) => setEventsOkFilter(e.target.value as 'all' | 'ok' | 'failed')}
              className="rounded border border-border bg-bg px-2 py-1 text-xs"
            >
              <option value="all">all</option>
              <option value="ok">ok</option>
              <option value="failed">failed</option>
            </select>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-xs">Source</th>
                  <th className="px-3 py-2 text-xs">Query</th>
                  <th className="px-3 py-2 text-xs">Result</th>
                  <th className="px-3 py-2 text-xs text-right">Collected</th>
                  <th className="px-3 py-2 text-xs text-right">Saved</th>
                  <th className="px-3 py-2 text-xs">When</th>
                  <th className="px-3 py-2 text-xs">Message</th>
                </tr>
              </thead>
              <tbody>
                {(eventsQuery.data?.results || []).map((row, idx) => (
                  <tr key={`${row.source}-${row.started_at || idx}`} className="border-b border-border/60">
                    <td className="px-3 py-2 text-xs">{row.source}</td>
                    <td className="px-3 py-2 text-xs max-w-[260px] truncate" title={row.query || ''}>{row.query || '-'}</td>
                    <td className="px-3 py-2 text-xs">{row.ok ? 'ok' : 'failed'}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.collected ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.saved ?? 0}</td>
                    <td className="px-3 py-2 text-xs" title={fmtDate(row.started_at)}>{relTime(row.started_at)}</td>
                    <td className="px-3 py-2 text-xs max-w-[360px] truncate" title={row.message || ''}>{row.message || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'errors' && (
        <div className="h-full min-h-0 rounded-lg border border-border bg-surface p-3">
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[920px] text-left">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-xs">Source</th>
                  <th className="px-3 py-2 text-xs">Type</th>
                  <th className="px-3 py-2 text-xs text-right">Count (24h)</th>
                  <th className="px-3 py-2 text-xs">Last Occurrence</th>
                  <th className="px-3 py-2 text-xs">Example</th>
                </tr>
              </thead>
              <tbody>
                {(errorsQuery.data?.results || []).map((row, idx) => (
                  <tr key={`${row.source}-${row.error_type}-${idx}`} className="border-b border-border/60">
                    <td className="px-3 py-2 text-xs">{row.source}</td>
                    <td className="px-3 py-2 text-xs">{row.error_type}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{row.count}</td>
                    <td className="px-3 py-2 text-xs" title={fmtDate(row.last_occurrence)}>{relTime(row.last_occurrence)}</td>
                    <td className="px-3 py-2 text-xs max-w-[420px] truncate" title={row.example_message}>{row.example_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {hasUnsaved && tab === 'sources' && (
        <div className="fixed bottom-3 right-3 left-3 md:left-auto md:w-[520px] rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs">Unsaved source configuration changes</div>
            <div className="flex gap-2">
              <button
                className="rounded border border-border px-3 py-1 text-xs"
                onClick={() => setDraftValues(baseValues)}
              >
                Discard
              </button>
              <button
                className="rounded border border-border bg-bg px-3 py-1 text-xs"
                onClick={() => saveConfigMutation.mutate(values)}
                disabled={saveConfigMutation.isPending}
              >
                {saveConfigMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
