import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Company } from '../api';
import { 
  Upload, 
  Search,
  Building2,
  ExternalLink
} from 'lucide-react';

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  
  const colors: Record<string, string> = {
    A: 'bg-tier-a/10 text-tier-a border-tier-a/30',
    B: 'bg-tier-b/10 text-tier-b border-tier-b/30',
    C: 'bg-tier-c/10 text-tier-c border-tier-c/30',
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${colors[tier] || 'bg-surface-hover text-text-muted border-border'}`}>
      Tier {tier}
    </span>
  );
}

export default function Companies() {
  const [tierFilter, setTierFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies', tierFilter],
    queryFn: () => api.getCompanies(tierFilter || undefined),
  });

  const filteredCompanies = companies.filter(c => 
    !search || c.company_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await api.importCompanies(file);
      alert(`Imported ${result.imported} companies`);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } catch (err) {
      alert('Import failed');
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text mb-1">Target Companies</h1>
          <p className="text-text-muted">{companies.length} companies loaded</p>
        </div>
        
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            type="text"
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>

        {/* Tier Filter */}
        <div className="flex items-center gap-2">
          {['', 'A', 'B', 'C'].map((tier) => (
            <button
              key={tier}
              onClick={() => setTierFilter(tier)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tierFilter === tier
                  ? 'bg-accent text-white'
                  : 'bg-surface border border-border text-text-muted hover:text-text'
              }`}
            >
              {tier || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Company</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Tier</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Vertical</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Why Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filteredCompanies.map((company) => (
                <CompanyRow key={company.id} company={company} />
              ))}
              {filteredCompanies.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-text-muted">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No companies found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompanyRow({ company }: { company: Company }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr 
        className="hover:bg-surface-hover cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-hover flex items-center justify-center">
              <Building2 className="w-4 h-4 text-text-muted" />
            </div>
            <div>
              <p className="font-medium text-text">{company.company_name}</p>
              {company.domain && (
                <p className="text-xs text-text-dim">{company.domain}</p>
              )}
            </div>
          </div>
        </td>
        <td className="px-5 py-4">
          <TierBadge tier={company.tier} />
        </td>
        <td className="px-5 py-4 text-sm text-text-muted">
          {company.vertical || '—'}
        </td>
        <td className="px-5 py-4 text-sm text-text-muted max-w-md truncate">
          {company.target_reason || '—'}
        </td>
      </tr>
      {expanded && company.wedge && (
        <tr className="bg-surface-hover/50">
          <td colSpan={4} className="px-5 py-4">
            <div className="ml-12">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Zco Wedge</p>
              <p className="text-sm text-text">{company.wedge}</p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

