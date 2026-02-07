import { useState, useMemo } from 'react';
import { api } from '../api';
import { useDashboard } from '../hooks/useDashboard';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { ConnectionStatus } from '../components/dashboard/ConnectionStatus';
import { StatCard } from '../components/dashboard/StatCard';
import { MiniMetric } from '../components/dashboard/MiniMetric';
import { MiniLineChart, type DailyPoint } from '../components/dashboard/MiniLineChart';
import { TerminalOutput } from '../components/dashboard/TerminalOutput';
import { LiveContacts } from '../components/dashboard/LiveContacts';
import { RecentActivity } from '../components/dashboard/RecentActivity';
import {
  Building2,
  Users,
  Mail,
  Download,
  Trash2,
  Terminal,
  ChevronDown,
  ChevronRight,
  Send,
  Eye,
  MessageSquare,
  TrendingUp,
} from 'lucide-react';

/* ── Main Dashboard ────────────────────────────────────── */

export default function Dashboard() {
  const [showLogs, setShowLogs] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const { stats, pipelineStatus, emailStats, todaysContacts, clearTodaysContacts } = useDashboard();

  // Derive email totals + daily data
  const sent = emailStats?.sent ?? 0;
  const viewed = emailStats?.viewed ?? 0;
  const responded = emailStats?.responded ?? 0;
  const daily: DailyPoint[] = emailStats?.daily ?? [];

  // Compute week-over-week delta for sent (if we have enough data)
  const sentDelta = useMemo(() => {
    if (daily.length < 14) return undefined;
    const thisWeek = daily.slice(-7).reduce((s, d) => s + d.sent, 0);
    const lastWeek = daily.slice(-14, -7).reduce((s, d) => s + d.sent, 0);
    if (lastWeek === 0) return undefined;
    return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  }, [daily]);

  return (
    <div className="p-4 md:p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-4 md:mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-text mb-0.5">Dashboard</h1>
          <p className="text-xs md:text-sm text-text-muted">Overview</p>
        </div>
        <ConnectionStatus />
      </div>

      {/* Top Stats — just Companies + Contacts */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
        <StatCard label="Companies" value={stats?.total_companies ?? 0} icon={Building2} />
        <StatCard label="Contacts" value={stats?.total_contacts ?? 0} icon={Users} />
      </div>

      {/* Email Performance */}
      <div className="bg-surface border border-border rounded-lg p-4 md:p-6 mb-4 md:mb-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-accent" />
          <h2 className="text-sm md:text-base font-semibold text-text">Email Performance</h2>
        </div>

        {/* Metric row */}
        <div className="grid grid-cols-3 gap-4 md:gap-6 mb-5">
          <MiniMetric label="Sent" value={sent} delta={sentDelta} icon={Send} color="bg-indigo-50 text-indigo-600" />
          <MiniMetric label="Viewed" value={viewed} icon={Eye} color="bg-green-50 text-green-600" />
          <MiniMetric label="Responded" value={responded} icon={MessageSquare} color="bg-amber-50 text-amber-600" />
        </div>

        {/* Chart */}
        {daily.length > 1 ? (
          <MiniLineChart data={daily} />
        ) : (
          <div className="flex flex-col items-center justify-center py-8 md:py-10 text-text-dim">
            <Mail className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">Send your first campaign to see trends</p>
          </div>
        )}
      </div>

      {/* Today's Contacts + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2">
          <div className="bg-surface border border-border rounded-lg p-4 md:p-6">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h2 className="text-sm md:text-base font-semibold text-text">Today's Contacts</h2>
              <div className="flex gap-1.5">
                <button
                  onClick={() => api.exportContacts(true)}
                  className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-xs border border-border rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export</span>
                </button>
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              </div>
            </div>
            <LiveContacts contacts={todaysContacts} />
          </div>
        </div>

        <div>
          <div className="bg-surface border border-border rounded-lg p-4 md:p-6">
            <h2 className="text-sm md:text-base font-semibold text-text mb-3">Recent Activity</h2>
            <RecentActivity lines={pipelineStatus?.output || []} />
          </div>
        </div>
      </div>

      {/* Collapsible Logs */}
      <div className="mt-4 md:mt-6">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-text transition-colors py-2"
        >
          <Terminal className="w-4 h-4" />
          Logs
          {showLogs ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          {(pipelineStatus?.output?.length ?? 0) > 0 && (
            <span className="text-[10px] text-text-dim">({pipelineStatus?.output.length})</span>
          )}
        </button>
        {showLogs && <TerminalOutput lines={pipelineStatus?.output || []} />}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear today's contacts?"
        message="All contacts scraped today will be permanently deleted."
        confirmLabel="Clear"
        variant="danger"
        onConfirm={async () => {
          await clearTodaysContacts();
          setShowClearConfirm(false);
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
}