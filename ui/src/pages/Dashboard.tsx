import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { 
  Building2, 
  Users, 
  Mail, 
  CalendarDays,
  Play,
  Sparkles,
  Download,
  Trash2,
  Terminal
} from 'lucide-react';

function StatCard({ 
  label, 
  value, 
  icon: Icon, 
  color = 'accent' 
}: { 
  label: string; 
  value: number | string; 
  icon: React.ElementType;
  color?: 'accent' | 'success' | 'warning';
}) {
  const colorClasses = {
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
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  title,
  description,
  icon: Icon,
  buttonLabel,
  onClick,
  variant = 'default'
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  buttonLabel: string;
  onClick: () => void;
  variant?: 'default' | 'primary';
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-surface-hover flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-text-muted" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-text mb-1">{title}</h3>
          <p className="text-sm text-text-muted mb-4">{description}</p>
          <button
            onClick={onClick}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              variant === 'primary'
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-surface-hover text-text hover:bg-border'
            }`}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 5000,
  });

  const handleExport = () => {
    api.exportContacts(true);
  };

  const handleClear = async () => {
    if (confirm('Clear all contacts scraped today?')) {
      await api.clearContacts(true);
      window.location.reload();
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text mb-1">Dashboard</h1>
        <p className="text-text-muted">Overview of your LinkedIn scraping pipeline</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Target Companies"
          value={stats?.total_companies ?? 0}
          icon={Building2}
        />
        <StatCard
          label="Total Contacts"
          value={stats?.total_contacts ?? 0}
          icon={Users}
        />
        <StatCard
          label="With Emails"
          value={stats?.contacts_with_email ?? 0}
          icon={Mail}
          color="success"
        />
        <StatCard
          label="Scraped Today"
          value={stats?.contacts_today ?? 0}
          icon={CalendarDays}
          color="warning"
        />
      </div>

      {/* Actions */}
      <h2 className="text-lg font-medium text-text mb-4">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-4 mb-8">
        <ActionCard
          title="Run Full Pipeline"
          description="Scrape LinkedIn + discover email patterns. Run from terminal."
          icon={Play}
          buttonLabel="Copy Command"
          variant="primary"
          onClick={() => {
            navigator.clipboard.writeText('python main.py scrape-and-enrich');
            alert('Command copied: python main.py scrape-and-enrich');
          }}
        />
        <ActionCard
          title="Discover Emails Only"
          description="Find email patterns for existing contacts."
          icon={Sparkles}
          buttonLabel="Copy Command"
          onClick={() => {
            navigator.clipboard.writeText('python main.py discover-emails');
            alert('Command copied: python main.py discover-emails');
          }}
        />
        <ActionCard
          title="Export Today's Contacts"
          description="Download CSV with contacts scraped today."
          icon={Download}
          buttonLabel="Export CSV"
          onClick={handleExport}
        />
        <ActionCard
          title="Clear Today's Data"
          description="Remove all contacts scraped today from database."
          icon={Trash2}
          buttonLabel="Clear"
          onClick={handleClear}
        />
      </div>

      {/* Terminal Commands Reference */}
      <h2 className="text-lg font-medium text-text mb-4">Terminal Commands</h2>
      <div className="bg-surface border border-border rounded-xl p-5 font-mono text-sm">
        <div className="flex items-center gap-2 mb-3 text-text-muted">
          <Terminal className="w-4 h-4" />
          <span className="font-sans">Available commands</span>
        </div>
        <div className="space-y-2 text-text-dim">
          <p><span className="text-accent">python main.py scrape-and-enrich</span> <span className="text-text-muted">— Full pipeline (scrape + emails)</span></p>
          <p><span className="text-accent">python main.py linkedin-batch</span> <span className="text-text-muted">— LinkedIn scraping only</span></p>
          <p><span className="text-accent">python main.py discover-emails</span> <span className="text-text-muted">— Email discovery only</span></p>
          <p><span className="text-accent">python main.py export-contacts</span> <span className="text-text-muted">— Export to CSV</span></p>
        </div>
      </div>
    </div>
  );
}

