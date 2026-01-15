import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Contact, EmailCampaign } from '../api';
import { useNotificationContext } from '../contexts/NotificationContext';
import { 
  Search,
  Users,
  Download,
  CheckCircle,
  XCircle,
  ExternalLink,
  Copy,
  Check,
  Building2,
  Upload,
  Send,
  Phone,
  UserPlus,
  Loader2,
  ChevronDown,
  ChevronRight,
  Mail,
  Calendar,
  Globe,
  Target
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
    <div className="flex items-center gap-2 min-w-0">
      <span className="flex items-center gap-1 text-success text-sm truncate min-w-0">
        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate" title={email}>{email}</span>
      </span>
      <button
        onClick={handleCopy}
        className="p-1 hover:bg-surface-hover rounded transition-colors flex-shrink-0"
        title="Copy email"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-success" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-text-dim" />
        )}
      </button>
      {pattern && (
        <span className="text-xs text-text-dim bg-surface-hover px-1.5 py-0.5 rounded flex-shrink-0">
          {pattern}
        </span>
      )}
    </div>
  );
}

function PhoneBadge({ phone, source, confidence }: { phone: string | null; source: string | null; confidence: number | null }) {
  const [copied, setCopied] = useState(false);

  if (!phone) {
    return (
      <span className="flex items-center gap-1 text-text-dim text-sm">
        <XCircle className="w-3.5 h-3.5" />
        No phone
      </span>
    );
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const confidenceColor = confidence && confidence >= 70 ? 'text-success' : confidence && confidence >= 50 ? 'text-yellow-500' : 'text-text-dim';

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`flex items-center gap-1 text-sm ${confidenceColor} truncate min-w-0`}>
        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate" title={phone}>{phone}</span>
      </span>
      <button
        onClick={handleCopy}
        className="p-1 hover:bg-surface-hover rounded transition-colors flex-shrink-0"
        title="Copy phone"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-success" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-text-dim" />
        )}
      </button>
      {source && (
        <span className="text-xs text-text-dim bg-surface-hover px-1.5 py-0.5 rounded flex-shrink-0" title={`Confidence: ${confidence}%`}>
          {source}
        </span>
      )}
    </div>
  );
}

function SalesforceStatusBadge({ status, uploadedAt }: { status: string | null; uploadedAt?: string | null }) {
  const statusColors = {
    'pending': 'bg-yellow-500/20 text-yellow-500',
    'uploaded': 'bg-blue-500/20 text-blue-500',
    'completed': 'bg-success/20 text-success',
    'denied': 'bg-red-500/20 text-red-500',
  };
  
  const color = statusColors[status as keyof typeof statusColors] || statusColors.pending;
  const displayStatus = status || 'pending';
  
  const title = uploadedAt 
    ? `Uploaded: ${new Date(uploadedAt).toLocaleString()}` 
    : undefined;

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${color}`} title={title}>
      {displayStatus}
    </span>
  );
}

export default function Contacts() {
  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<number>>(new Set());
  const [expandedContacts, setExpandedContacts] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useState({
    name: '',
    title: '',
    email: '',
    phone: '',
    linkedin: '',
    salesforce: '',
    vertical: '',
    campaign: '',
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const queryClient = useQueryClient();
  const { addNotification, updateNotification } = useNotificationContext();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => api.getContacts(),
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ['emailCampaigns'],
    queryFn: () => api.getEmailCampaigns(),
  });

  // Fetch campaign contacts when a campaign filter is selected
  const { data: campaignContacts = [] } = useQuery({
    queryKey: ['campaignContacts', filters.campaign],
    queryFn: () => api.getCampaignContacts(Number(filters.campaign)),
    enabled: !!filters.campaign,
  });

  // Get contact IDs enrolled in the selected campaign
  const campaignContactIds = useMemo(() => {
    if (!filters.campaign || !campaignContacts.length) return new Set<number>();
    return new Set(campaignContacts.map(cc => cc.contact_id));
  }, [filters.campaign, campaignContacts]);

  const filteredContacts = contacts.filter(c => {
    // Global search
    if (search) {
      const term = search.toLowerCase();
      const matchesSearch = (
        c.name.toLowerCase().includes(term) ||
        c.company_name.toLowerCase().includes(term) ||
        (c.title?.toLowerCase().includes(term) ?? false) ||
        (c.email?.toLowerCase().includes(term) ?? false) ||
        (c.phone?.toLowerCase().includes(term) ?? false)
      );
      if (!matchesSearch) return false;
    }
    
    // Column filters
    if (filters.name && !c.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.title && !(c.title?.toLowerCase().includes(filters.title.toLowerCase()) ?? false)) return false;
    if (filters.email && !(c.email?.toLowerCase().includes(filters.email.toLowerCase()) ?? false)) return false;
    if (filters.phone && !(c.phone?.toLowerCase().includes(filters.phone.toLowerCase()) ?? false)) return false;
    if (filters.linkedin && !(c.linkedin_url?.toLowerCase().includes(filters.linkedin.toLowerCase()) ?? false)) return false;
    if (filters.salesforce && c.salesforce_status?.toLowerCase() !== filters.salesforce.toLowerCase()) return false;
    if (filters.vertical && c.vertical !== filters.vertical) return false;
    
    // Campaign filter - only show contacts enrolled in the selected campaign
    if (filters.campaign && !campaignContactIds.has(c.id)) return false;
    
    return true;
  });

  // Get unique verticals from all contacts
  const uniqueVerticals = useMemo(() => {
    const verticals = new Set<string>();
    contacts.forEach(c => {
      if (c.vertical) verticals.add(c.vertical);
    });
    return Array.from(verticals).sort();
  }, [contacts]);

  // Group by company
  const groupedContacts = useMemo(() => {
    return filteredContacts.reduce((acc, contact) => {
      const company = contact.company_name || 'Unknown';
      if (!acc[company]) acc[company] = [];
      acc[company].push(contact);
      return acc;
    }, {} as Record<string, Contact[]>);
  }, [filteredContacts]);

  // Check if all contacts are selected
  const allSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedContacts.has(c.id));
  const someSelected = filteredContacts.some(c => selectedContacts.has(c.id));

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(filteredContacts.map(c => c.id)));
    }
  };

  const handleSelectCompany = (companyContacts: Contact[]) => {
    const companyIds = new Set(companyContacts.map(c => c.id));
    const allCompanySelected = companyContacts.every(c => selectedContacts.has(c.id));
    
    if (allCompanySelected) {
      // Deselect all in company
      setSelectedContacts(prev => {
        const next = new Set(prev);
        companyIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all in company
      setSelectedContacts(prev => {
        const next = new Set(prev);
        companyIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleSelectContact = (contactId: number) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const handleToggleExpand = (contactId: number) => {
    setExpandedContacts(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const handleExport = () => {
    api.exportContacts(false);
  };
  
  const handleFilterChange = (column: string, value: string) => {
    setFilters(prev => ({ ...prev, [column]: value }));
  };

  const bulkActionMutation = useMutation({
    mutationFn: async ({ action, contactIds, campaignId }: { action: string; contactIds: number[]; campaignId?: number; notificationId?: string }) => {
      const res = await fetch(`/api/contacts/bulk-actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: contactIds, campaign_id: campaignId }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Action failed: ${res.status} - ${errorText}`);
      }
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setActionLoading(null);
      
      const actionNames: Record<string, string> = {
        'salesforce-upload': 'Salesforce Upload',
        'linkedin-request': 'LinkedIn Request',
        'send-email': 'Send Email',
        'collect-phone': 'Phone Data Collection',
      };
      
      const actionName = actionNames[variables.action] || variables.action;
      
      if (variables.notificationId) {
        updateNotification(variables.notificationId, {
          type: 'success',
          title: `${actionName} completed`,
          message: data.message || `Processed ${data.processed || data.sent || 0} of ${data.total || variables.contactIds.length} contacts`,
        });
      } else {
        addNotification({
          type: 'success',
          title: `${actionName} completed`,
          message: data.message || `Processed ${data.processed || data.sent || 0} of ${data.total || variables.contactIds.length} contacts`,
        });
      }
    },
    onError: (error: Error, variables) => {
      setActionLoading(null);
      
      const actionNames: Record<string, string> = {
        'salesforce-upload': 'Salesforce Upload',
        'linkedin-request': 'LinkedIn Request',
        'send-email': 'Send Email',
        'collect-phone': 'Phone Data Collection',
      };
      
      const actionName = actionNames[variables.action] || variables.action;
      
      if (variables.notificationId) {
        updateNotification(variables.notificationId, {
          type: 'error',
          title: `${actionName} failed`,
          message: error.message || 'An error occurred',
        });
      } else {
        addNotification({
          type: 'error',
          title: `${actionName} failed`,
          message: error.message || 'An error occurred',
        });
      }
    },
  });

  const enrollMutation = useMutation({
    mutationFn: async ({ campaignId, contactIds }: { campaignId: number; contactIds: number[] }) => {
      return api.enrollInCampaign(campaignId, contactIds);
    },
    onSuccess: (data) => {
      setShowCampaignModal(false);
      addNotification({
        type: 'success',
        title: 'Contacts enrolled',
        message: `${data.enrolled} contacts enrolled in campaign${data.skipped > 0 ? ` (${data.skipped} already enrolled)` : ''}`
      });
    },
    onError: (error: Error) => {
      addNotification({
        type: 'error',
        title: 'Enrollment failed',
        message: error.message
      });
    }
  });

  const handleBulkSalesforceUpload = async () => {
    if (selectedContacts.size === 0) return;
    setActionLoading('salesforce');
    const notificationId = addNotification({
      type: 'loading',
      title: 'Preparing Salesforce upload...',
      message: `Creating CSV for ${selectedContacts.size} contacts`,
      duration: 0,
    });
    
    try {
      const res = await fetch('/api/contacts/bulk-actions/salesforce-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: Array.from(selectedContacts) }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        // Download the CSV file
        const csvUrl = `/api/contacts/salesforce-csv/${data.csv_filename}`;
        const link = document.createElement('a');
        link.href = csvUrl;
        link.download = data.csv_filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        updateNotification(notificationId, {
          type: 'success',
          title: 'Ready for Salesforce',
          message: `CSV downloaded with ${data.exported} contacts. Salesforce opened - upload the CSV file.`,
          duration: 10000,
        });
        
        // Refresh contacts list
        queryClient.invalidateQueries({ queryKey: ['contacts'] });
      } else {
        updateNotification(notificationId, {
          type: 'error',
          title: 'Upload Failed',
          message: data.error || 'Failed to create CSV',
        });
      }
    } catch (error) {
      updateNotification(notificationId, {
        type: 'error',
        title: 'Upload Failed',
        message: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkLinkedInRequest = () => {
    if (selectedContacts.size === 0) return;
    setActionLoading('linkedin');
    const notificationId = addNotification({
      type: 'loading',
      title: 'Sending LinkedIn requests...',
      message: `Processing ${selectedContacts.size} contacts`,
      duration: 0,
    });
    bulkActionMutation.mutate({
      action: 'linkedin-request',
      contactIds: Array.from(selectedContacts),
      notificationId,
    });
  };

  const handleBulkSendEmail = () => {
    if (selectedContacts.size === 0) return;
    setActionLoading('email');
    const notificationId = addNotification({
      type: 'loading',
      title: 'Sending emails...',
      message: `Processing ${selectedContacts.size} contacts`,
      duration: 0,
    });
    bulkActionMutation.mutate({
      action: 'send-email',
      contactIds: Array.from(selectedContacts),
      notificationId,
    });
  };

  const handleBulkCollectPhone = () => {
    if (selectedContacts.size === 0) return;
    setActionLoading('phone');
    const notificationId = addNotification({
      type: 'loading',
      title: 'Collecting phone data...',
      message: `Processing ${selectedContacts.size} contacts with PhoneInfoga`,
      duration: 0,
    });
    bulkActionMutation.mutate({
      action: 'collect-phone',
      contactIds: Array.from(selectedContacts),
      notificationId,
    });
  };

  const emailCount = contacts.filter(c => c.email).length;
  const phoneCount = contacts.filter(c => c.phone).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text mb-1">Contacts</h1>
          <p className="text-text-muted">
            {contacts.length} contacts • {emailCount} with emails • {phoneCount} with phones
            {selectedContacts.size > 0 && ` • ${selectedContacts.size} selected`}
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

      {/* Action Buttons */}
      {selectedContacts.size > 0 && (
        <div className="mb-4 p-4 bg-surface border border-border rounded-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text mr-2">
              {selectedContacts.size} selected:
            </span>
            <button
              onClick={handleBulkSalesforceUpload}
              disabled={actionLoading !== null}
              className="flex items-center gap-2 px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'salesforce' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Upload to Salesforce
            </button>
            <button
              onClick={handleBulkLinkedInRequest}
              disabled={actionLoading !== null}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'linkedin' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              LinkedIn Request
            </button>
            <button
              onClick={handleBulkSendEmail}
              disabled={actionLoading !== null}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'email' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send Email
            </button>
            <button
              onClick={handleBulkCollectPhone}
              disabled={actionLoading !== null}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'phone' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Phone className="w-4 h-4" />
              )}
              Collect Phone Data
            </button>
            <button
              onClick={() => setShowCampaignModal(true)}
              disabled={actionLoading !== null}
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Target className="w-4 h-4" />
              Enroll in Campaign
            </button>
          </div>
        </div>
      )}

      {/* Campaign Enrollment Modal */}
      {showCampaignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCampaignModal(false)}>
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-text mb-4">Enroll in Email Campaign</h3>
            <p className="text-sm text-text-muted mb-4">
              Select a campaign to enroll {selectedContacts.size} contact{selectedContacts.size > 1 ? 's' : ''} in:
            </p>
            
            {campaigns.length === 0 ? (
              <div className="text-center py-8 text-text-muted">
                <Mail className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>No campaigns available</p>
                <p className="text-sm">Create a campaign in the Email tab first</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {campaigns.map((campaign: EmailCampaign) => (
                  <button
                    key={campaign.id}
                    onClick={() => enrollMutation.mutate({ campaignId: campaign.id, contactIds: Array.from(selectedContacts) })}
                    disabled={enrollMutation.isPending}
                    className="w-full text-left px-4 py-3 bg-bg hover:bg-surface-hover rounded-lg transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-text">{campaign.name}</p>
                        <p className="text-xs text-text-dim">
                          {campaign.num_emails} emails • {campaign.days_between_emails} days apart
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                        campaign.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                        campaign.status === 'paused' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {campaign.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowCampaignModal(false)}
                className="px-4 py-2 text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Controls */}
      <div className="flex items-center gap-4 mb-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(input) => {
              if (input) input.indeterminate = someSelected && !allSelected;
            }}
            onChange={handleSelectAll}
            className="w-4 h-4 rounded border-text bg-transparent text-accent focus:ring-accent"
          />
          <span className="text-sm font-medium text-text">Select All</span>
        </label>

        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            type="text"
            placeholder="Search all fields..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
        </div>

        {/* Vertical Filter */}
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-text-dim" />
          <select
            value={filters.vertical}
            onChange={(e) => handleFilterChange('vertical', e.target.value)}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text focus:outline-none focus:border-accent cursor-pointer"
          >
            <option value="">All Verticals</option>
            {uniqueVerticals.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        {/* Campaign Filter */}
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-text-dim" />
          <select
            value={filters.campaign}
            onChange={(e) => handleFilterChange('campaign', e.target.value)}
            className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text focus:outline-none focus:border-accent cursor-pointer"
          >
            <option value="">All Campaigns</option>
            {campaigns.map((c: EmailCampaign) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter Header Row - Only shown once */}
      <div className="bg-surface border border-border rounded-lg mb-6 overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr>
              <th className="w-12 px-4 py-3"></th>
              <th className="px-4 py-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Name</span>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters.name}
                    onChange={(e) => handleFilterChange('name', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                  />
                </div>
              </th>
              <th className="px-4 py-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Title</span>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters.title}
                    onChange={(e) => handleFilterChange('title', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                  />
                </div>
              </th>
              <th className="px-4 py-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Email</span>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters.email}
                    onChange={(e) => handleFilterChange('email', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                  />
                </div>
              </th>
              <th className="px-4 py-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Phone</span>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters.phone}
                    onChange={(e) => handleFilterChange('phone', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                  />
                </div>
              </th>
              <th className="px-4 py-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">LinkedIn</span>
                  <input
                    type="text"
                    placeholder="Filter..."
                    value={filters.linkedin}
                    onChange={(e) => handleFilterChange('linkedin', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                  />
                </div>
              </th>
              <th className="px-4 py-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Salesforce</span>
                  <select
                    value={filters.salesforce}
                    onChange={(e) => handleFilterChange('salesforce', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text focus:outline-none focus:border-accent"
                  >
                    <option value="">All</option>
                    <option value="pending">Pending</option>
                    <option value="uploaded">Uploaded</option>
                    <option value="completed">Completed</option>
                    <option value="denied">Denied</option>
                  </select>
                </div>
              </th>
            </tr>
          </thead>
        </table>
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
          {Object.entries(groupedContacts).map(([company, companyContacts]) => {
            const allCompanySelected = companyContacts.every(c => selectedContacts.has(c.id));
            const someCompanySelected = companyContacts.some(c => selectedContacts.has(c.id));
            
            return (
              <div key={company} className="bg-surface border border-border rounded-xl overflow-hidden">
                {/* Company Header */}
                <div className="px-5 py-3 bg-surface-hover/50 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allCompanySelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someCompanySelected && !allCompanySelected;
                        }}
                        onChange={() => handleSelectCompany(companyContacts)}
                        className="w-4 h-4 rounded border-text bg-transparent text-accent focus:ring-accent"
                      />
                      <Building2 className="w-4 h-4 text-text-dim" />
                      <h3 className="font-medium text-text">{company}</h3>
                    </label>
                  </div>
                  <span className="text-xs text-text-muted">{companyContacts.length} contacts</span>
                </div>
                
                {/* Contacts Table */}
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="border-b border-border-subtle">
                      <th className="w-12 px-4 py-2"></th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-dim uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-dim uppercase tracking-wider">Title</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-dim uppercase tracking-wider">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-dim uppercase tracking-wider">Phone</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-dim uppercase tracking-wider">LinkedIn</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-text-dim uppercase tracking-wider">Salesforce</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {companyContacts.map((contact) => {
                      const isExpanded = expandedContacts.has(contact.id);
                      return (
                        <>
                          <tr 
                            key={contact.id} 
                            className="hover:bg-surface-hover/30 transition-colors cursor-pointer"
                            onClick={(e) => {
                              // Don't expand if clicking checkbox
                              if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
                                return;
                              }
                              handleToggleExpand(contact.id);
                            }}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={selectedContacts.has(contact.id)}
                                  onChange={() => handleSelectContact(contact.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 rounded border-text bg-transparent text-accent focus:ring-accent"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleExpand(contact.id);
                                  }}
                                  className="p-0.5 hover:bg-surface-hover rounded transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-text-dim" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-text-dim" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-text truncate" title={contact.name}>{contact.name}</p>
                            </td>
                            <td className="px-4 py-3 text-sm text-text-muted">
                              <span className="truncate block" title={contact.title || '—'}>{contact.title || '—'}</span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="min-w-0">
                                <EmailBadge email={contact.email} pattern={contact.email_pattern} />
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="min-w-0">
                                <PhoneBadge phone={contact.phone} source={contact.phone_source} confidence={contact.phone_confidence} />
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="min-w-0">
                                {contact.linkedin_url ? (
                                  contact.linkedin_url.includes('/in/') ? (
                                    <a
                                      href={contact.linkedin_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1.5 text-accent hover:text-accent-hover text-sm transition-colors truncate"
                                      title={contact.linkedin_url}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                                      <span className="truncate">{contact.linkedin_url.split('/in/')[1]?.split('/')[0] || 'Profile'}</span>
                                    </a>
                                  ) : (
                                    <span className="text-text-dim text-sm">Sales Nav only</span>
                                  )
                                ) : (
                                  <span className="text-text-dim text-sm">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <SalesforceStatusBadge status={contact.salesforce_status} uploadedAt={contact.salesforce_uploaded_at} />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${contact.id}-expanded`} className="bg-surface-hover/20">
                              <td colSpan={7} className="px-4 py-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  {/* Basic Information */}
                                  <div className="space-y-3">
                                    <h4 className="font-semibold text-text mb-2 flex items-center gap-2">
                                      <Users className="w-4 h-4" />
                                      Basic Information
                                    </h4>
                                    <div className="space-y-2">
                                      <div>
                                        <span className="text-text-dim">Company:</span>
                                        <span className="ml-2 text-text">{contact.company_name}</span>
                                      </div>
                                      {contact.domain && (
                                        <div>
                                          <span className="text-text-dim">Domain:</span>
                                          <span className="ml-2 text-text flex items-center gap-1">
                                            <Globe className="w-3.5 h-3.5" />
                                            {contact.domain}
                                          </span>
                                        </div>
                                      )}
                                      {contact.scraped_at && (
                                        <div>
                                          <span className="text-text-dim">Scraped:</span>
                                          <span className="ml-2 text-text flex items-center gap-1">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {new Date(contact.scraped_at).toLocaleString()}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Email Information */}
                                  <div className="space-y-3">
                                    <h4 className="font-semibold text-text mb-2 flex items-center gap-2">
                                      <Mail className="w-4 h-4" />
                                      Email Details
                                    </h4>
                                    <div className="space-y-2">
                                      {contact.email ? (
                                        <>
                                          <div>
                                            <span className="text-text-dim">Email:</span>
                                            <span className="ml-2 text-text font-mono">{contact.email}</span>
                                          </div>
                                          {contact.email_pattern && (
                                            <div>
                                              <span className="text-text-dim">Pattern:</span>
                                              <span className="ml-2 text-text font-mono bg-surface px-2 py-0.5 rounded">
                                                {contact.email_pattern}
                                              </span>
                                            </div>
                                          )}
                                          {contact.email_confidence !== null && (
                                            <div>
                                              <span className="text-text-dim">Confidence:</span>
                                              <span className="ml-2 text-text">{contact.email_confidence}%</span>
                                            </div>
                                          )}
                                          <div>
                                            <span className="text-text-dim">Verified:</span>
                                            <span className={`ml-2 ${contact.email_verified ? 'text-success' : 'text-text-dim'}`}>
                                              {contact.email_verified ? 'Yes' : 'No'}
                                            </span>
                                          </div>
                                        </>
                                      ) : (
                                        <span className="text-text-dim">No email found</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Phone Information */}
                                  <div className="space-y-3">
                                    <h4 className="font-semibold text-text mb-2 flex items-center gap-2">
                                      <Phone className="w-4 h-4" />
                                      Phone Details
                                    </h4>
                                    <div className="space-y-2">
                                      {contact.phone ? (
                                        <>
                                          <div>
                                            <span className="text-text-dim">Phone:</span>
                                            <span className="ml-2 text-text font-mono">{contact.phone}</span>
                                          </div>
                                          {contact.phone_source && (
                                            <div>
                                              <span className="text-text-dim">Source:</span>
                                              <span className="ml-2 text-text">{contact.phone_source}</span>
                                            </div>
                                          )}
                                          {contact.phone_confidence !== null && (
                                            <div>
                                              <span className="text-text-dim">Confidence:</span>
                                              <span className="ml-2 text-text">{contact.phone_confidence}%</span>
                                            </div>
                                          )}
                                          {contact.phone_links && contact.phone_links.length > 0 && (
                                            <div className="mt-2">
                                              <span className="text-text-dim text-xs block mb-1">PhoneInfoga Links:</span>
                                              <div className="space-y-1">
                                                {contact.phone_links.map((url, idx) => (
                                                  <a
                                                    key={idx}
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block text-xs text-accent hover:text-accent-hover underline break-all"
                                                  >
                                                    {url}
                                                  </a>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <span className="text-text-dim">No phone found</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* LinkedIn & Salesforce */}
                                  <div className="space-y-3">
                                    <h4 className="font-semibold text-text mb-2 flex items-center gap-2">
                                      <ExternalLink className="w-4 h-4" />
                                      Integration Status
                                    </h4>
                                    <div className="space-y-2">
                                      {contact.linkedin_url ? (
                                        <div>
                                          <span className="text-text-dim">LinkedIn:</span>
                                          <div className="mt-1">
                                            <a
                                              href={contact.linkedin_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-accent hover:text-accent-hover underline break-all"
                                            >
                                              {contact.linkedin_url}
                                            </a>
                                          </div>
                                          {contact.linkedin_url.includes('/in/') && (
                                            <div className="mt-1 text-xs text-text-dim">
                                              Profile: {contact.linkedin_url.split('/in/')[1]?.split('/')[0] || 'N/A'}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <div>
                                          <span className="text-text-dim">LinkedIn:</span>
                                          <span className="ml-2 text-text-dim">No LinkedIn URL</span>
                                        </div>
                                      )}
                                      <div>
                                        <span className="text-text-dim">Salesforce:</span>
                                        <span className="ml-2">
                                          <SalesforceStatusBadge status={contact.salesforce_status} uploadedAt={contact.salesforce_uploaded_at} />
                                        </span>
                                      </div>
                                      {contact.salesforce_uploaded_at && (
                                        <div>
                                          <span className="text-text-dim">Uploaded:</span>
                                          <span className="ml-2 text-text">
                                            {new Date(contact.salesforce_uploaded_at).toLocaleString()}
                                          </span>
                                        </div>
                                      )}
                                      {contact.salesforce_upload_batch && (
                                        <div>
                                          <span className="text-text-dim">Batch ID:</span>
                                          <span className="ml-2 text-text font-mono text-xs">
                                            {contact.salesforce_upload_batch}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
