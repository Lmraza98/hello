import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, RefreshCw, Search } from 'lucide-react';
import { api, type AdminLogLevel } from '../../api';
import { useRegisterCapabilities } from '../../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../../capabilities/catalog';

type TimeRange = '15m' | '1h' | '24h' | '7d';

const levelClasses: Record<AdminLogLevel, string> = {
  debug: 'bg-zinc-500/10 text-zinc-300',
  info: 'bg-blue-500/10 text-blue-300',
  warn: 'bg-amber-500/10 text-amber-300',
  error: 'bg-red-500/10 text-red-300',
};

export default function AdminLogs() {
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<AdminLogLevel | 'all'>('all');
  const [feature, setFeature] = useState<string>('all');
  const [source, setSource] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useRegisterCapabilities(getPageCapability('admin.logs'));

  const params = useMemo(
    () => ({
      q: q || undefined,
      level: level === 'all' ? undefined : level,
      feature: feature === 'all' ? undefined : feature,
      source: source === 'all' ? undefined : source,
      time_range: timeRange,
    }),
    [q, level, feature, source, timeRange]
  );

  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: ['admin_logs', params],
    queryFn: () => api.admin.getLogs(params),
  });

  const copyCorrelation = async (value?: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedId(value);
    window.setTimeout(() => setCopiedId(null), 1200);
  };

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <div className="relative w-full md:w-[420px]">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search logs..."
              className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-lg text-sm"
            />
          </div>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as AdminLogLevel | 'all')}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text"
          >
            <option value="all">All levels</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <select
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text"
          >
            <option value="all">All features</option>
            <option value="chat_trace">chat_trace</option>
            <option value="http">http</option>
            <option value="chat">chat</option>
            <option value="research">research</option>
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text"
          >
            <option value="all">All sources</option>
            <option value="chat_ui">chat_ui</option>
            <option value="middleware">middleware</option>
          </select>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text"
          >
            <option value="15m">Last 15m</option>
            <option value="1h">Last 1h</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
          </select>
          <button
            onClick={() => void refetch()}
            className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm text-text-muted hover:bg-surface-hover"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead className="bg-surface-hover/50">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Time</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Level</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Feature</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Model</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Route</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Tools</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Message</th>
                <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Status</th>
                <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">ms</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border-subtle">
                  <td className="px-4 py-2 text-xs text-text-muted whitespace-nowrap">
                    {new Date(row.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${levelClasses[row.level]}`}>
                      {row.level}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-text">{row.feature ?? '-'}</td>
                  <td className="px-4 py-2 text-xs text-text-muted whitespace-nowrap">
                    {typeof row.meta_json?.tool_brain_model === 'string'
                      ? row.meta_json.tool_brain_model
                      : typeof row.meta_json?.model_used === 'string'
                        ? row.meta_json.model_used
                        : '-'}
                  </td>
                  <td className="px-4 py-2 text-xs text-text-muted whitespace-nowrap">
                    {typeof row.meta_json?.route === 'string'
                      ? `${row.meta_json.route}${typeof row.meta_json?.route_reason === 'string' ? ` (${row.meta_json.route_reason})` : ''}`
                      : '-'}
                  </td>
                  <td className="px-4 py-2 text-xs text-text-muted max-w-[240px] truncate" title={Array.isArray(row.meta_json?.tools_used) ? row.meta_json.tools_used.join(', ') : ''}>
                    {Array.isArray(row.meta_json?.tools_used) && row.meta_json.tools_used.length > 0
                      ? row.meta_json.tools_used.join(', ')
                      : '-'}
                  </td>
                  <td className="px-4 py-2 text-sm text-text max-w-[420px] truncate" title={row.message}>
                    {row.message}
                  </td>
                  <td className="px-4 py-2 text-sm text-text text-right">{row.status_code ?? '-'}</td>
                  <td className="px-4 py-2 text-sm text-text text-right">{row.duration_ms ?? '-'}</td>
                  <td className="px-4 py-2 text-xs text-text-muted">
                    <div className="inline-flex items-center gap-2">
                      <span>{row.correlation_id ?? '-'}</span>
                      {row.correlation_id && (
                        <button
                          onClick={() => void copyCorrelation(row.correlation_id)}
                          className="p-1 rounded border border-border hover:bg-surface-hover"
                          title="Copy correlation id"
                        >
                          {copiedId === row.correlation_id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-5 text-sm text-text-muted" colSpan={10}>
                    No logs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
