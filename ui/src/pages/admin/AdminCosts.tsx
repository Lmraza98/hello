import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AdminCostsRange } from '../../api';
import { DollarSign, Cpu, Globe, TrendingUp, RefreshCw } from 'lucide-react';
import { useRegisterCapabilities } from '../../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../../capabilities/catalog';

function StatCard(props: { icon: any; label: string; value: string; sub?: string }) {
  const Icon = props.icon;
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-text-muted">{props.label}</div>
        <Icon className="w-4 h-4 text-text-muted" />
      </div>
      <div className="mt-2 text-xl font-semibold text-text">{props.value}</div>
      {props.sub && <div className="mt-1 text-xs text-text-muted">{props.sub}</div>}
    </div>
  );
}

function money(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export default function AdminCosts() {
  const [range, setRange] = useState<AdminCostsRange>('today');
  useRegisterCapabilities(getPageCapability('admin.costs'));

  const { data, isFetching, refetch, isError, error } = useQuery({
    queryKey: ['admin_costs', range],
    queryFn: () => api.admin.getCosts(range),
  });

  const summary = data?.summary ?? null;
  const byFeature = data?.by_feature ?? [];
  const byModel = data?.by_model ?? [];
  const topExpensive = data?.top_expensive ?? [];

  const blendedPerReq = useMemo(() => {
    if (!summary || summary.requests === 0) return 0;
    return summary.total_usd / summary.requests;
  }, [summary]);

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Costs</h2>
          <p className="text-sm text-text-muted">Monitor Tavily + OpenAI spend and outliers.</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as AdminCostsRange)}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text"
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
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
      {isError && (
        <div className="px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-sm text-red-700">
          Failed to load costs: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon={DollarSign} label="Total" value={summary ? money(summary.total_usd) : '-'} />
        <StatCard icon={Cpu} label="OpenAI" value={summary ? money(summary.openai_usd) : '-'} />
        <StatCard icon={Globe} label="Tavily" value={summary ? money(summary.tavily_usd) : '-'} />
        <StatCard
          icon={TrendingUp}
          label="Requests"
          value={summary ? summary.requests.toLocaleString() : '-'}
          sub={summary ? `Avg ${money(blendedPerReq)} / req` : undefined}
        />
        <StatCard
          icon={TrendingUp}
          label="Avg / req"
          value={summary ? money(summary.avg_cost_usd) : '-'}
          sub="Across all requests"
        />
        <StatCard
          icon={TrendingUp}
          label="p95 / req"
          value={summary ? money(summary.p95_cost_usd) : '-'}
          sub="Outlier detection"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col min-h-0">
          <div className="p-4 border-b border-border">
            <div className="text-sm font-medium text-text">By feature</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-hover/50">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Feature</th>
                  <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Req</th>
                  <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Total</th>
                  <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Avg</th>
                </tr>
              </thead>
              <tbody>
                {byFeature.map((r) => (
                  <tr key={r.key} className="border-b border-border-subtle">
                    <td className="px-4 py-2 text-sm text-text">{r.key}</td>
                    <td className="px-4 py-2 text-sm text-text text-right">{r.requests}</td>
                    <td className="px-4 py-2 text-sm text-text text-right">{money(r.total_usd)}</td>
                    <td className="px-4 py-2 text-sm text-text text-right">{money(r.avg_usd)}</td>
                  </tr>
                ))}
                {byFeature.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-sm text-text-muted" colSpan={4}>
                      No data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col min-h-0">
          <div className="p-4 border-b border-border">
            <div className="text-sm font-medium text-text">By provider / model</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-hover/50">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Key</th>
                  <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Req</th>
                  <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Total</th>
                  <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Avg</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((r) => (
                  <tr key={r.key} className="border-b border-border-subtle">
                    <td className="px-4 py-2 text-sm text-text">{r.key}</td>
                    <td className="px-4 py-2 text-sm text-text text-right">{r.requests}</td>
                    <td className="px-4 py-2 text-sm text-text text-right">{money(r.total_usd)}</td>
                    <td className="px-4 py-2 text-sm text-text text-right">{money(r.avg_usd)}</td>
                  </tr>
                ))}
                {byModel.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-sm text-text-muted" colSpan={4}>
                      No data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="text-sm font-medium text-text">Top expensive requests</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-surface-hover/50">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Correlation</th>
                <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Endpoint / Tool</th>
                <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Req</th>
                <th className="text-right px-4 py-2 text-xs text-text-muted uppercase">Total</th>
              </tr>
            </thead>
            <tbody>
              {topExpensive.map((r, idx) => (
                <tr key={`${r.correlation_id ?? idx}`} className="border-b border-border-subtle">
                  <td className="px-4 py-2 text-sm text-text-muted">{r.correlation_id ?? '-'}</td>
                  <td className="px-4 py-2 text-sm text-text">{r.endpoint ?? r.tool ?? '-'}</td>
                  <td className="px-4 py-2 text-sm text-text text-right">{r.requests}</td>
                  <td className="px-4 py-2 text-sm text-text text-right">{money(r.total_usd)}</td>
                </tr>
              ))}
              {topExpensive.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-sm text-text-muted" colSpan={4}>
                    No data.
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
