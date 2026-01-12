import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Company } from '../api';
import { 
  Upload, 
  Search,
  Building2,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  RotateCcw
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
      {tier}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const statusColors: Record<string, string> = {
    pending: 'bg-warning/10 text-warning border-warning/30',
    processing: 'bg-accent/10 text-accent border-accent/30',
    completed: 'bg-success/10 text-success border-success/30',
  };

  const s = status || 'pending';
  
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${statusColors[s] || statusColors.pending}`}>
      {s}
    </span>
  );
}

function AddCompanyRow({ onAdd, onCancel }: { onAdd: (company: Partial<Company>) => void; onCancel: () => void }) {
  const [data, setData] = useState({
    company_name: '',
    tier: 'A',
    vertical: '',
    target_reason: '',
    wedge: ''
  });

  return (
    <tr className="bg-accent/5">
      <td className="px-4 py-2">
        <input
          type="text"
          placeholder="Company name..."
          value={data.company_name}
          onChange={(e) => setData({ ...data, company_name: e.target.value })}
          className="w-full px-2 py-1 bg-surface border border-border rounded text-sm text-text"
          autoFocus
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={data.tier}
          onChange={(e) => setData({ ...data, tier: e.target.value })}
          className="px-2 py-1 bg-surface border border-border rounded text-sm text-text"
        >
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
      </td>
      <td className="px-4 py-2 text-xs text-text-muted">
        New
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          placeholder="Vertical..."
          value={data.vertical}
          onChange={(e) => setData({ ...data, vertical: e.target.value })}
          className="w-full px-2 py-1 bg-surface border border-border rounded text-sm text-text"
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => data.company_name && onAdd(data)}
            className="p-1.5 bg-success/10 text-success rounded hover:bg-success/20"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 bg-error/10 text-error rounded hover:bg-error/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function EditableRow({ 
  company, 
  onSave, 
  onDelete,
}: { 
  company: Company; 
  onSave: (company: Company) => void;
  onDelete: (id: number) => void;
}) {
  const [data, setData] = useState(company);
  const [isEditing, setIsEditing] = useState(false);

  if (!isEditing) {
    return (
      <tr className={`hover:bg-surface-hover transition-colors group ${company.status === 'completed' ? 'opacity-60' : ''}`}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-hover flex items-center justify-center">
              <Building2 className="w-4 h-4 text-text-muted" />
            </div>
            <span className="font-medium text-text">{company.company_name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <TierBadge tier={company.tier} />
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={company.status} />
        </td>
        <td className="px-4 py-3 text-sm text-text-muted max-w-[200px] truncate">
          {company.vertical || '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 hover:bg-surface-hover rounded text-text-muted hover:text-text"
              title="Edit"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => company.id && onDelete(company.id)}
              className="p-1.5 hover:bg-error/10 rounded text-text-muted hover:text-error"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-accent/5">
      <td className="px-4 py-2">
        <input
          type="text"
          value={data.company_name}
          onChange={(e) => setData({ ...data, company_name: e.target.value })}
          className="w-full px-2 py-1 bg-surface border border-border rounded text-sm text-text"
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={data.tier || 'A'}
          onChange={(e) => setData({ ...data, tier: e.target.value })}
          className="px-2 py-1 bg-surface border border-border rounded text-sm text-text"
        >
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={data.status} />
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          value={data.vertical || ''}
          onChange={(e) => setData({ ...data, vertical: e.target.value })}
          className="w-full px-2 py-1 bg-surface border border-border rounded text-sm text-text"
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { onSave(data); setIsEditing(false); }}
            className="p-1.5 bg-success/10 text-success rounded hover:bg-success/20"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setData(company); setIsEditing(false); }}
            className="p-1.5 bg-error/10 text-error rounded hover:bg-error/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function Companies() {
  const [tierFilter, setTierFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies', tierFilter],
    queryFn: () => api.getCompanies(tierFilter || undefined),
  });

  const addMutation = useMutation({
    mutationFn: api.addCompany,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setIsAdding(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: api.updateCompany,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteCompany,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });

  const resetMutation = useMutation({
    mutationFn: api.resetCompanies,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    }
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
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (confirm('Reset all companies to pending status?')) {
                resetMutation.mutate();
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border text-text-muted rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset All
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border text-text rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
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
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Company</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider w-20">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider w-28">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Vertical</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {isAdding && (
                <AddCompanyRow 
                  onAdd={(data) => addMutation.mutate(data)}
                  onCancel={() => setIsAdding(false)}
                />
              )}
              {filteredCompanies.map((company) => (
                <EditableRow 
                  key={company.id} 
                  company={company}
                  onSave={(data) => updateMutation.mutate(data)}
                  onDelete={(id) => {
                    if (confirm(`Delete ${company.company_name}?`)) {
                      deleteMutation.mutate(id);
                    }
                  }}
                />
              ))}
              {filteredCompanies.length === 0 && !isAdding && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-text-muted">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No companies found</p>
                    <button 
                      onClick={() => setIsAdding(true)}
                      className="mt-2 text-accent hover:underline text-sm"
                    >
                      Add your first company
                    </button>
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
