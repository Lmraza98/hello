import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Contact } from '../api';
import { 
  Search,
  Users,
  Mail,
  Download,
  Filter,
  CheckCircle,
  XCircle,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';

function EmailBadge({ email, pattern }: { email: string | null; pattern: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!email) {
    return (
      <span className="flex items-center gap-1 text-text-dim text-sm">
        <XCircle className="w-3.5 h-3.5" />
        No email
      </span>
    );
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-success text-sm">
        <CheckCircle className="w-3.5 h-3.5" />
        {email}
      </span>
      <button
        onClick={handleCopy}
        className="p-1 hover:bg-surface-hover rounded transition-colors"
        title="Copy email"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-success" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-text-dim" />
        )}
      </button>
      {pattern && (
        <span className="text-xs text-text-dim bg-surface-hover px-1.5 py-0.5 rounded">
          {pattern}
        </span>
      )}
    </div>
  );
}

export default function Contacts() {
  const [search, setSearch] = useState('');
  const [hasEmail, setHasEmail] = useState<boolean | undefined>(undefined);
  const [todayOnly, setTodayOnly] = useState(false);
  const queryClient = useQueryClient();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts', hasEmail, todayOnly],
    queryFn: () => api.getContacts({ has_email: hasEmail, today_only: todayOnly }),
  });

  const filteredContacts = contacts.filter(c => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.company_name.toLowerCase().includes(term) ||
      (c.title?.toLowerCase().includes(term) ?? false) ||
      (c.email?.toLowerCase().includes(term) ?? false)
    );
  });

  const handleExport = () => {
    api.exportContacts(todayOnly);
  };

  // Group by company
  const groupedContacts = filteredContacts.reduce((acc, contact) => {
    const company = contact.company_name || 'Unknown';
    if (!acc[company]) acc[company] = [];
    acc[company].push(contact);
    return acc;
  }, {} as Record<string, Contact[]>);

  const emailCount = contacts.filter(c => c.email).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text mb-1">Contacts</h1>
          <p className="text-text-muted">
            {contacts.length} contacts • {emailCount} with emails
          </p>
        </div>
        
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            type="text"
            placeholder="Search by name, company, title, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>

        {/* Email Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-dim" />
          {[
            { value: undefined, label: 'All' },
            { value: true, label: 'With Email' },
            { value: false, label: 'No Email' },
          ].map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => setHasEmail(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                hasEmail === opt.value
                  ? 'bg-accent text-white'
                  : 'bg-surface border border-border text-text-muted hover:text-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Today Only */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => setTodayOnly(e.target.checked)}
            className="w-4 h-4 rounded border-border bg-surface text-accent focus:ring-accent"
          />
          <span className="text-sm text-text-muted">Today only</span>
        </label>
      </div>

      {/* Contacts List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : Object.keys(groupedContacts).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-muted">
          <Users className="w-12 h-12 mb-4 opacity-50" />
          <p>No contacts found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedContacts).map(([company, companyContacts]) => (
            <div key={company} className="bg-surface border border-border rounded-xl overflow-hidden">
              {/* Company Header */}
              <div className="px-5 py-3 bg-surface-hover/50 border-b border-border flex items-center justify-between">
                <h3 className="font-medium text-text">{company}</h3>
                <span className="text-xs text-text-muted">{companyContacts.length} contacts</span>
              </div>
              
              {/* Contacts Table */}
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="text-left px-5 py-2 text-xs font-medium text-text-dim uppercase tracking-wider">Name</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-text-dim uppercase tracking-wider">Title</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-text-dim uppercase tracking-wider">Email</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-text-dim uppercase tracking-wider w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {companyContacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-surface-hover/30 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-text">{contact.name}</p>
                      </td>
                      <td className="px-5 py-3 text-sm text-text-muted">
                        {contact.title || '—'}
                      </td>
                      <td className="px-5 py-3">
                        <EmailBadge email={contact.email} pattern={contact.email_pattern} />
                      </td>
                      <td className="px-5 py-3">
                        {contact.linkedin_url && (
                          <a
                            href={contact.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 hover:bg-surface-hover rounded transition-colors inline-flex"
                            title="View on LinkedIn"
                          >
                            <ExternalLink className="w-4 h-4 text-text-dim" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

