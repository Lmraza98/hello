import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Contact } from '../api';
import { 
  Building2, 
  Users, 
  Mail, 
  CalendarDays,
  Download,
  Trash2,
  Play,
  Square,
  Terminal,
  Loader2,
  Phone
} from 'lucide-react';

function ConnectionStatus() {
  const { isError, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 3000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 text-warning text-sm">
        <Loader2 className="w-3 h-3 animate-spin" />
        Connecting...
      </div>
    );
  }
  
  if (isError) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-error/10 text-error text-sm">
        <span className="w-2 h-2 rounded-full bg-error" />
        Backend Offline
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success text-sm">
      <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
      Connected
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color = 'accent' }: { 
  label: string; value: number; icon: React.ElementType; color?: string;
}) {
  const colors: Record<string, string> = {
    accent: 'bg-accent/10 text-accent',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-muted mb-1">{label}</p>
          <p className="text-3xl font-semibold text-text">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function TerminalOutput({ lines }: { lines: { time: string; text: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new lines added
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div 
      ref={containerRef}
      className="bg-[#0d1117] rounded-lg p-4 font-mono text-sm h-96 overflow-y-auto scrollbar-thin"
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#374151 #0d1117'
      }}
    >
      {lines.length === 0 ? (
        <p className="text-gray-500">Waiting for output...</p>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="py-0.5 leading-relaxed">
            <span className="text-gray-600 text-xs mr-2 tabular-nums">
              {new Date(line.time).toLocaleTimeString()}
            </span>
            <span className={
              line.text.includes('ERROR') || line.text.includes('error') || line.text.includes('failed') ? 'text-red-400' :
              line.text.includes('contacts') || line.text.includes('Success') ? 'text-green-400' :
              line.text.includes('Worker') ? 'text-blue-400' :
              line.text.includes('Authenticated') ? 'text-emerald-400' :
              'text-gray-300'
            }>
              {line.text}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function LiveContacts() {
  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts', 'today'],
    queryFn: () => api.getContacts({ today_only: true }),
    refetchInterval: 3000,
  });

  const grouped = contacts.reduce((acc, c) => {
    const company = c.company_name || 'Unknown';
    if (!acc[company]) acc[company] = [];
    acc[company].push(c);
    return acc;
  }, {} as Record<string, Contact[]>);

  if (contacts.length === 0) {
    return <p className="text-text-muted text-center py-8">No contacts scraped today</p>;
  }

  return (
    <div className="space-y-3 max-h-80 overflow-y-auto">
      {Object.entries(grouped).map(([company, list]) => (
        <div key={company} className="border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-surface-hover flex justify-between items-center">
            <span className="font-medium text-text text-sm">{company}</span>
            <span className="text-xs text-text-muted">{list.length}</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {list.slice(0, 5).map((c) => (
              <div key={c.id} className="px-3 py-1.5 flex justify-between items-center">
                <span className="text-sm text-text truncate flex-1">{c.name}</span>
                {c.email && <span className="text-xs text-success ml-2">{c.email}</span>}
              </div>
            ))}
            {list.length > 5 && (
              <div className="px-3 py-1.5 text-xs text-text-muted">+{list.length - 5} more</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [tier, setTier] = useState<string>('');
  const [maxContacts, setMaxContacts] = useState(25);
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 3000,
  });

  const { data: pendingCount } = useQuery({
    queryKey: ['pending-count'],
    queryFn: api.getPendingCount,
    refetchInterval: 3000,
  });

  const { data: pipelineStatus } = useQuery({
    queryKey: ['pipeline-status'],
    queryFn: api.getPipelineStatus,
    refetchInterval: 1000,
  });

  const startMutation = useMutation({
    mutationFn: () => api.startPipeline(tier || undefined, maxContacts),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline-status'] })
  });

  const stopMutation = useMutation({
    mutationFn: api.stopPipeline,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline-status'] })
  });

  const skipPendingMutation = useMutation({
    mutationFn: api.skipPendingCompanies,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });

  const clearPendingMutation = useMutation({
    mutationFn: api.clearPendingCompanies,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });

  const emailDiscoveryMutation = useMutation({
    mutationFn: api.runEmailDiscovery,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline-status'] })
  });

  const phoneDiscoveryMutation = useMutation({
    mutationFn: () => api.runPhoneDiscovery(10, false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline-status'] })
  });

  const isRunning = pipelineStatus?.running || false;
  const pending = pendingCount?.pending ?? 0;

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text mb-1">Dashboard</h1>
          <p className="text-text-muted">Run LinkedIn scraping and email discovery</p>
        </div>
        <ConnectionStatus />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Companies" value={stats?.total_companies ?? 0} icon={Building2} />
        <StatCard label="Contacts" value={stats?.total_contacts ?? 0} icon={Users} />
        <StatCard label="With Emails" value={stats?.contacts_with_email ?? 0} icon={Mail} color="success" />
        <StatCard label="Today" value={stats?.contacts_today ?? 0} icon={CalendarDays} color="warning" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Pipeline Control */}
        <div>
          <div className="bg-surface border border-border rounded-xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Terminal className="w-5 h-5 text-accent" />
              <h2 className="font-semibold text-text">Pipeline Control</h2>
              {isRunning && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-warning">
                  <Loader2 className="w-3 h-3 animate-spin" /> Running
                </span>
              )}
            </div>

            {!isRunning ? (
              <div className="space-y-4">
                {/* Queue status */}
                {pending > 0 && (
                  <div className="flex items-center justify-between p-3 bg-warning/10 border border-warning/20 rounded-lg">
                    <span className="text-sm text-warning">
                      <strong>{pending}</strong> companies pending from previous batch
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (confirm(`Skip ${pending} pending companies? They won't be processed.`)) {
                            skipPendingMutation.mutate();
                          }
                        }}
                        disabled={skipPendingMutation.isPending}
                        className="px-2 py-1 text-xs bg-warning/20 text-warning rounded hover:bg-warning/30"
                      >
                        Skip All
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${pending} pending companies? This cannot be undone.`)) {
                            clearPendingMutation.mutate();
                          }
                        }}
                        disabled={clearPendingMutation.isPending}
                        className="px-2 py-1 text-xs bg-error/20 text-error rounded hover:bg-error/30"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-text-muted mb-1 block">Tier Filter</label>
                    <select
                      value={tier}
                      onChange={(e) => setTier(e.target.value)}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm"
                    >
                      <option value="">All Tiers</option>
                      <option value="A">Tier A</option>
                      <option value="B">Tier B</option>
                      <option value="C">Tier C</option>
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="text-xs text-text-muted mb-1 block">Max Contacts</label>
                    <input
                      type="number"
                      value={maxContacts}
                      onChange={(e) => setMaxContacts(parseInt(e.target.value) || 25)}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm"
                    />
                  </div>
                </div>
                <button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending || pending === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent-hover disabled:opacity-50"
                >
                  {startMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Start Pipeline {pending > 0 && `(${pending} companies)`}
                </button>
              </div>
            ) : (
              <button
                onClick={() => stopMutation.mutate()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-error text-white rounded-lg font-medium hover:bg-error/80"
              >
                <Square className="w-4 h-4" /> Stop Pipeline
              </button>
            )}
          </div>

          {/* Terminal Output */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="text-sm font-medium text-text mb-3">Output</h3>
            <TerminalOutput lines={pipelineStatus?.output || []} />
          </div>
        </div>

        {/* Right: Live Contacts */}
        <div>
          <div className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-text">Today's Contacts</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => api.exportContacts(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-surface-hover rounded-lg hover:bg-border"
                >
                  <Download className="w-4 h-4" /> Export
                </button>
                <button
                  onClick={async () => {
                    if (confirm('Clear today\'s contacts?')) {
                      await api.clearContacts(true);
                      queryClient.invalidateQueries({ queryKey: ['contacts'] });
                      queryClient.invalidateQueries({ queryKey: ['stats'] });
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-error bg-error/10 rounded-lg hover:bg-error/20"
                >
                  <Trash2 className="w-4 h-4" /> Clear
                </button>
              </div>
            </div>
            <LiveContacts />
          </div>

          {/* Discovery Actions */}
          <div className="bg-surface border border-border rounded-xl p-5 mt-4">
            <h2 className="font-semibold text-text mb-4">Discovery Tools</h2>
            <div className="flex gap-3">
              <button
                onClick={() => emailDiscoveryMutation.mutate()}
                disabled={emailDiscoveryMutation.isPending || isRunning}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-accent/10 text-accent border border-accent/20 rounded-lg font-medium hover:bg-accent/20 disabled:opacity-50"
              >
                {emailDiscoveryMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Discover Emails
              </button>
              <button
                onClick={() => phoneDiscoveryMutation.mutate()}
                disabled={phoneDiscoveryMutation.isPending || isRunning}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-accent/10 text-accent border border-accent/20 rounded-lg font-medium hover:bg-accent/20 disabled:opacity-50"
              >
                {phoneDiscoveryMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                Discover Phones
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
