import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotificationContext } from '../contexts/NotificationContext';
import {
  Mail,
  Plus,
  Play,
  Pause,
  Trash2,
  Edit3,
  Users,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronDown,
  Eye,
  FileText,
  Loader2,
  BarChart3,
  Calendar,
  ArrowRight,
  Upload
} from 'lucide-react';

type EmailCampaign = {
  id: number;
  name: string;
  description: string | null;
  num_emails: number;
  days_between_emails: number;
  status: string;
  created_at: string;
  templates?: EmailTemplate[];
  stats?: CampaignStats;
};

type EmailTemplate = {
  id: number;
  campaign_id: number;
  step_number: number;
  subject_template: string;
  body_template: string;
};

type CampaignStats = {
  total_contacts: number;
  active: number;
  completed: number;
  total_sent: number;
  failed: number;
};

type CampaignContact = {
  id: number;
  contact_id: number;
  contact_name: string;
  email: string;
  title: string;
  company_name: string;
  current_step: number;
  status: string;
  next_email_at: string | null;
};

type SentEmail = {
  id: number;
  campaign_id: number;
  campaign_name: string;
  contact_id: number;
  contact_name: string;
  company_name: string;
  step_number: number;
  subject: string;
  body: string;
  sent_at: string;
  status: string;
  error_message: string | null;
};

type GlobalStats = {
  total_campaigns: number;
  active_campaigns: number;
  total_contacts_enrolled: number;
  total_sent: number;
  sent_today: number;
};

const API_BASE = '/api/emails';

// API functions with error handling
const emailApi = {
  getCampaigns: async (status?: string): Promise<EmailCampaign[]> => {
    try {
      const url = status ? `${API_BASE}/campaigns?status=${status}` : `${API_BASE}/campaigns`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  getCampaign: async (id: number): Promise<EmailCampaign | null> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${id}`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },
  
  createCampaign: async (data: Partial<EmailCampaign>): Promise<EmailCampaign> => {
    const res = await fetch(`${API_BASE}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to create campaign');
    return res.json();
  },
  
  updateCampaign: async (id: number, data: Partial<EmailCampaign>): Promise<EmailCampaign> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update campaign');
    return res.json();
  },
  
  deleteCampaign: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete campaign');
  },
  
  activateCampaign: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}/activate`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Failed to activate campaign');
    }
  },
  
  pauseCampaign: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${id}/pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to pause campaign');
  },
  
  getTemplates: async (campaignId: number): Promise<EmailTemplate[]> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/templates`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  saveTemplates: async (campaignId: number, templates: Partial<EmailTemplate>[]): Promise<void> => {
    const res = await fetch(`${API_BASE}/campaigns/${campaignId}/templates/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templates)
    });
    if (!res.ok) throw new Error('Failed to save templates');
  },
  
  getCampaignContacts: async (campaignId: number): Promise<CampaignContact[]> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/contacts`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  enrollContacts: async (campaignId: number, contactIds: number[]): Promise<{ enrolled: number; skipped: number }> => {
    const res = await fetch(`${API_BASE}/campaigns/${campaignId}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: contactIds })
    });
    if (!res.ok) throw new Error('Failed to enroll contacts');
    return res.json();
  },
  
  sendEmails: async (campaignId?: number, limit?: number, reviewMode: boolean = true): Promise<{ success: boolean; message?: string; error?: string; ready_count?: number }> => {
    try {
      const res = await fetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, limit, review_mode: reviewMode })
      });
      return res.json();
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  
  getSentEmails: async (campaignId?: number, limit?: number): Promise<SentEmail[]> => {
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set('campaign_id', String(campaignId));
      if (limit) params.set('limit', String(limit));
      const res = await fetch(`${API_BASE}/sent?${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  getStats: async (): Promise<GlobalStats> => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (!res.ok) return { total_campaigns: 0, active_campaigns: 0, total_contacts_enrolled: 0, total_sent: 0, sent_today: 0 };
      return res.json();
    } catch {
      return { total_campaigns: 0, active_campaigns: 0, total_contacts_enrolled: 0, total_sent: 0, sent_today: 0 };
    }
  },
  
  getQueue: async (campaignId?: number): Promise<CampaignContact[]> => {
    try {
      const params = campaignId ? `?campaign_id=${campaignId}` : '';
      const res = await fetch(`${API_BASE}/queue${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },
  
  uploadToSalesforce: async (campaignId: number): Promise<{ success: boolean; message?: string; error?: string; exported?: number }> => {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/salesforce-upload`, {
        method: 'POST'
      });
      return res.json();
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
};

// Campaign Card Component
function CampaignCard({ 
  campaign, 
  onEdit, 
  onDelete, 
  onActivate, 
  onPause,
  onViewContacts,
  onSendEmails,
  onUploadToSalesforce,
  isUploading
}: { 
  campaign: EmailCampaign;
  onEdit: () => void;
  onDelete: () => void;
  onActivate: () => void;
  onPause: () => void;
  onViewContacts: () => void;
  onSendEmails: () => void;
  onUploadToSalesforce: () => void;
  isUploading?: boolean;
}) {
  const stats = campaign.stats;
  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/20 text-gray-400',
    active: 'bg-emerald-500/20 text-emerald-400',
    paused: 'bg-amber-500/20 text-amber-400',
    completed: 'bg-blue-500/20 text-blue-400'
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-text">{campaign.name}</h3>
            <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${statusColors[campaign.status] || statusColors.draft}`}>
              {campaign.status}
            </span>
          </div>
          {campaign.description && (
            <p className="text-sm text-text-muted">{campaign.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {campaign.status === 'active' ? (
            <button onClick={onPause} className="p-2 hover:bg-surface-hover rounded-lg transition-colors" title="Pause">
              <Pause className="w-4 h-4 text-amber-400" />
            </button>
          ) : (
            <button onClick={onActivate} className="p-2 hover:bg-surface-hover rounded-lg transition-colors" title="Activate">
              <Play className="w-4 h-4 text-emerald-400" />
            </button>
          )}
          <button onClick={onEdit} className="p-2 hover:bg-surface-hover rounded-lg transition-colors" title="Edit">
            <Edit3 className="w-4 h-4 text-text-dim" />
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-surface-hover rounded-lg transition-colors" title="Delete">
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-text">{campaign.num_emails}</div>
          <div className="text-xs text-text-dim">Emails</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-text">{campaign.days_between_emails}</div>
          <div className="text-xs text-text-dim">Days Apart</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-accent">{stats?.total_contacts || 0}</div>
          <div className="text-xs text-text-dim">Contacts</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-400">{stats?.total_sent || 0}</div>
          <div className="text-xs text-text-dim">Sent</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onViewContacts}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-hover rounded-lg text-sm font-medium text-text hover:bg-border transition-colors"
        >
          <Users className="w-4 h-4" />
          View Contacts
        </button>
        <button
          onClick={onSendEmails}
          disabled={campaign.status !== 'active'}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          Send Emails
        </button>
      </div>
      <button
        onClick={onUploadToSalesforce}
        disabled={isUploading}
        className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isUploading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
        Upload to Salesforce
      </button>
    </div>
  );
}

// Create/Edit Campaign Modal
function CampaignModal({
  campaign,
  onClose,
  onSave
}: {
  campaign?: EmailCampaign;
  onClose: () => void;
  onSave: (data: Partial<EmailCampaign>) => void;
}) {
  const [name, setName] = useState(campaign?.name || '');
  const [description, setDescription] = useState(campaign?.description || '');
  const [numEmails, setNumEmails] = useState(campaign?.num_emails || 3);
  const [daysBetween, setDaysBetween] = useState(campaign?.days_between_emails || 3);
  const [templates, setTemplates] = useState<Array<{ subject: string; body: string }>>([]);
  const [activeStep, setActiveStep] = useState(1);

  // Initialize templates
  useState(() => {
    if (campaign?.templates) {
      setTemplates(campaign.templates.map(t => ({ subject: t.subject_template, body: t.body_template })));
    } else {
      setTemplates(Array(numEmails).fill({ subject: '', body: '' }));
    }
  });

  const updateNumEmails = (n: number) => {
    setNumEmails(n);
    setTemplates(prev => {
      const newTemplates = [...prev];
      while (newTemplates.length < n) {
        newTemplates.push({ subject: '', body: '' });
      }
      return newTemplates.slice(0, n);
    });
    if (activeStep > n) setActiveStep(n);
  };

  const handleSave = () => {
    onSave({
      name,
      description,
      num_emails: numEmails,
      days_between_emails: daysBetween,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">
            {campaign ? 'Edit Campaign' : 'Create Campaign'}
          </h2>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text mb-2">Campaign Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Q1 Outreach"
                className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-2">Description (optional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of this campaign..."
                rows={2}
                className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent resize-none"
              />
            </div>
          </div>

          {/* Campaign Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text mb-2">Number of Emails</label>
              <select
                value={numEmails}
                onChange={e => updateNumEmails(Number(e.target.value))}
                className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
              >
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <option key={n} value={n}>{n} email{n > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-2">Days Between Emails</label>
              <select
                value={daysBetween}
                onChange={e => setDaysBetween(Number(e.target.value))}
                className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-accent"
              >
                {[1, 2, 3, 4, 5, 7, 10, 14].map(n => (
                  <option key={n} value={n}>{n} day{n > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Email Timeline Visual */}
          <div className="bg-bg/50 rounded-xl p-4">
            <label className="block text-sm font-medium text-text mb-3">Email Sequence</label>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {Array.from({ length: numEmails }).map((_, i) => (
                <div key={i} className="flex items-center">
                  <div className={`flex flex-col items-center px-4 py-2 rounded-lg min-w-[80px] ${
                    activeStep === i + 1 ? 'bg-accent/20 border border-accent' : 'bg-surface'
                  }`}>
                    <Mail className={`w-5 h-5 mb-1 ${activeStep === i + 1 ? 'text-accent' : 'text-text-dim'}`} />
                    <span className={`text-xs font-medium ${activeStep === i + 1 ? 'text-accent' : 'text-text'}`}>
                      Email {i + 1}
                    </span>
                    <span className="text-xs text-text-dim">
                      {i === 0 ? 'Day 0' : `Day ${i * daysBetween}`}
                    </span>
                  </div>
                  {i < numEmails - 1 && (
                    <ArrowRight className="w-4 h-4 text-text-dim mx-1 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-muted hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name}
            className="px-6 py-2 bg-accent text-white rounded-lg font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {campaign ? 'Save Changes' : 'Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Template Editor Modal
function TemplateEditorModal({
  campaign,
  onClose,
  onSave
}: {
  campaign: EmailCampaign;
  onClose: () => void;
  onSave: (templates: Array<{ step_number: number; subject_template: string; body_template: string }>) => void;
}) {
  const [activeStep, setActiveStep] = useState(1);
  const [templates, setTemplates] = useState<Array<{ subject: string; body: string }>>(() => {
    const t: Array<{ subject: string; body: string }> = [];
    for (let i = 0; i < campaign.num_emails; i++) {
      const existing = campaign.templates?.find(tmpl => tmpl.step_number === i + 1);
      t.push({
        subject: existing?.subject_template || `Follow up - {company}`,
        body: existing?.body_template || `Hi {name},\n\nJust following up on my previous email.\n\n{personalization}\n\nBest regards`
      });
    }
    return t;
  });

  const handleSave = () => {
    const formatted = templates.map((t, i) => ({
      step_number: i + 1,
      subject_template: t.subject,
      body_template: t.body
    }));
    onSave(formatted);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">
            Email Templates - {campaign.name}
          </h2>
          <div className="flex items-center gap-2">
            {Array.from({ length: campaign.num_emails }).map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i + 1)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeStep === i + 1
                    ? 'bg-accent text-white'
                    : 'bg-surface-hover text-text-muted hover:text-text'
                }`}
              >
                Email {i + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-bg/50 rounded-lg p-3 text-sm text-text-muted">
            <strong className="text-text">Variables:</strong> Use <code className="bg-surface px-1.5 py-0.5 rounded">{'{name}'}</code>,{' '}
            <code className="bg-surface px-1.5 py-0.5 rounded">{'{company}'}</code>,{' '}
            <code className="bg-surface px-1.5 py-0.5 rounded">{'{title}'}</code>,{' '}
            <code className="bg-surface px-1.5 py-0.5 rounded">{'{personalization}'}</code> in your templates.
            GPT-4o will personalize each email.
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-2">Subject Line</label>
            <input
              type="text"
              value={templates[activeStep - 1]?.subject || ''}
              onChange={e => {
                const newTemplates = [...templates];
                newTemplates[activeStep - 1] = { ...newTemplates[activeStep - 1], subject: e.target.value };
                setTemplates(newTemplates);
              }}
              placeholder="e.g., Quick question for {company}"
              className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-2">Email Body</label>
            <textarea
              value={templates[activeStep - 1]?.body || ''}
              onChange={e => {
                const newTemplates = [...templates];
                newTemplates[activeStep - 1] = { ...newTemplates[activeStep - 1], body: e.target.value };
                setTemplates(newTemplates);
              }}
              placeholder="Write your email template..."
              rows={12}
              className="w-full px-4 py-3 bg-bg border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-accent resize-none font-mono text-sm"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-accent text-white rounded-lg font-medium hover:bg-accent-hover transition-colors"
          >
            Save Templates
          </button>
        </div>
      </div>
    </div>
  );
}

// Sent Emails List
function SentEmailsList({ emails }: { emails: SentEmail[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (emails.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Mail className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No emails sent yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map(email => (
        <div key={email.id} className="bg-surface border border-border rounded-lg overflow-hidden">
          <div
            className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-surface-hover transition-colors"
            onClick={() => setExpanded(expanded === email.id ? null : email.id)}
          >
            <div className="flex items-center gap-4 flex-1 min-w-0">
              {email.status === 'sent' ? (
                <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text truncate">{email.contact_name}</span>
                  <span className="text-text-dim">•</span>
                  <span className="text-text-muted text-sm truncate">{email.company_name}</span>
                </div>
                <div className="text-sm text-text-dim truncate">
                  <span className="bg-surface-hover px-1.5 py-0.5 rounded text-xs mr-2">Email {email.step_number}</span>
                  {email.subject}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <span className="text-xs text-text-dim">
                {new Date(email.sent_at).toLocaleString()}
              </span>
              {expanded === email.id ? (
                <ChevronDown className="w-4 h-4 text-text-dim" />
              ) : (
                <ChevronRight className="w-4 h-4 text-text-dim" />
              )}
            </div>
          </div>
          
          {expanded === email.id && (
            <div className="px-4 py-4 border-t border-border bg-bg/30">
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Subject</span>
                  <p className="text-text mt-1">{email.subject}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Body</span>
                  <pre className="text-text mt-1 whitespace-pre-wrap font-sans text-sm bg-surface p-3 rounded-lg">
                    {email.body}
                  </pre>
                </div>
                {email.error_message && (
                  <div>
                    <span className="text-xs font-medium text-red-400 uppercase tracking-wider">Error</span>
                    <p className="text-red-400 text-sm mt-1">{email.error_message}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Main Email Page
export default function Email() {
  const [view, setView] = useState<'campaigns' | 'history' | 'queue'>('campaigns');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaign | null>(null);
  const [editingTemplates, setEditingTemplates] = useState<EmailCampaign | null>(null);
  const [sendingCampaignId, setSendingCampaignId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();

  // Queries
  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ['emailCampaigns'],
    queryFn: () => emailApi.getCampaigns()
  });

  const { data: sentEmails = [], isLoading: sentLoading } = useQuery({
    queryKey: ['sentEmails'],
    queryFn: () => emailApi.getSentEmails(undefined, 100)
  });

  const { data: stats } = useQuery({
    queryKey: ['emailStats'],
    queryFn: () => emailApi.getStats()
  });

  const { data: queue = [] } = useQuery({
    queryKey: ['emailQueue'],
    queryFn: () => emailApi.getQueue()
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Partial<EmailCampaign>) => emailApi.createCampaign(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      setShowCreateModal(false);
      addNotification({ type: 'success', title: 'Campaign created', message: 'Now add your email templates' });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<EmailCampaign> }) => emailApi.updateCampaign(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      setEditingCampaign(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => emailApi.deleteCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'success', title: 'Campaign deleted' });
    }
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => emailApi.activateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'success', title: 'Campaign activated', message: 'Emails will start sending' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Activation failed', message: err.message });
    }
  });

  const pauseMutation = useMutation({
    mutationFn: (id: number) => emailApi.pauseCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'info', title: 'Campaign paused' });
    }
  });

  const saveTemplatesMutation = useMutation({
    mutationFn: async ({ campaignId, templates }: { campaignId: number; templates: Array<{ step_number: number; subject_template: string; body_template: string }> }) => {
      await emailApi.saveTemplates(campaignId, templates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      setEditingTemplates(null);
      addNotification({ type: 'success', title: 'Templates saved' });
    }
  });

  const sendMutation = useMutation({
    mutationFn: async (campaignId?: number) => {
      return emailApi.sendEmails(campaignId);
    },
    onSuccess: (data) => {
      setSendingCampaignId(null);
      if (data.success) {
        addNotification({ type: 'success', title: 'Email sender launched', message: data.message });
      } else {
        addNotification({ type: 'error', title: 'Failed to start', message: data.error });
      }
    }
  });

  const [uploadingCampaignId, setUploadingCampaignId] = useState<number | null>(null);
  
  const uploadToSalesforceMutation = useMutation({
    mutationFn: async (campaignId: number) => {
      setUploadingCampaignId(campaignId);
      return emailApi.uploadToSalesforce(campaignId);
    },
    onSuccess: (data) => {
      setUploadingCampaignId(null);
      if (data.success) {
        addNotification({ 
          type: 'success', 
          title: 'Salesforce upload started', 
          message: data.message || `Exported ${data.exported} contacts. Check the Salesforce browser window.`
        });
      } else {
        addNotification({ type: 'error', title: 'Upload failed', message: data.error });
      }
    },
    onError: () => {
      setUploadingCampaignId(null);
      addNotification({ type: 'error', title: 'Upload failed', message: 'An unexpected error occurred' });
    }
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text mb-1">Email Campaigns</h1>
          <p className="text-text-muted">
            {stats?.total_campaigns || 0} campaigns • {stats?.total_sent || 0} emails sent • {stats?.sent_today || 0} today
          </p>
        </div>
        
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="text-2xl font-bold text-text">{stats?.active_campaigns || 0}</div>
              <div className="text-xs text-text-dim">Active Campaigns</div>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-text">{stats?.total_contacts_enrolled || 0}</div>
              <div className="text-xs text-text-dim">Enrolled Contacts</div>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Send className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-text">{stats?.total_sent || 0}</div>
              <div className="text-xs text-text-dim">Total Emails Sent</div>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-text">{queue.length}</div>
              <div className="text-xs text-text-dim">In Queue</div>
            </div>
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-surface border border-border rounded-lg p-1 w-fit">
        {[
          { id: 'campaigns', label: 'Campaigns', icon: Mail },
          { id: 'history', label: 'Sent History', icon: FileText },
          { id: 'queue', label: 'Queue', icon: Clock }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setView(tab.id as typeof view)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                view === tab.id
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text hover:bg-surface-hover'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {view === 'campaigns' && (
        <div>
          {campaignsLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-20">
              <Mail className="w-16 h-16 mx-auto mb-4 text-text-dim opacity-50" />
              <h3 className="text-lg font-medium text-text mb-2">No campaigns yet</h3>
              <p className="text-text-muted mb-4">Create your first email campaign to get started</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Campaign
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {campaigns.map(campaign => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onEdit={() => setEditingTemplates(campaign)}
                  onDelete={() => {
                    if (confirm('Delete this campaign?')) {
                      deleteMutation.mutate(campaign.id);
                    }
                  }}
                  onActivate={() => activateMutation.mutate(campaign.id)}
                  onPause={() => pauseMutation.mutate(campaign.id)}
                  onViewContacts={() => {
                    // Navigate to contacts filtered by campaign
                    addNotification({ type: 'info', title: 'View contacts', message: 'Go to Contacts tab and filter by this campaign' });
                  }}
                  onSendEmails={() => {
                    setSendingCampaignId(campaign.id);
                    sendMutation.mutate(campaign.id);
                  }}
                  onUploadToSalesforce={() => {
                    uploadToSalesforceMutation.mutate(campaign.id);
                  }}
                  isUploading={uploadingCampaignId === campaign.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'history' && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <h3 className="text-lg font-semibold text-text mb-4">Sent Email History</h3>
          {sentLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
            </div>
          ) : (
            <SentEmailsList emails={sentEmails} />
          )}
        </div>
      )}

      {view === 'queue' && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text">Email Queue</h3>
            <button
              onClick={() => sendMutation.mutate(undefined)}
              disabled={queue.length === 0 || sendMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send All ({queue.length})
            </button>
          </div>
          
          {queue.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No emails in queue</p>
              <p className="text-sm">Enroll contacts in an active campaign to populate the queue</p>
            </div>
          ) : (
            <div className="space-y-2">
              {queue.map((contact: CampaignContact) => (
                <div key={contact.id} className="flex items-center justify-between px-4 py-3 bg-bg rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                      <span className="text-sm font-medium text-accent">{contact.current_step + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium text-text">{contact.contact_name}</p>
                      <p className="text-sm text-text-dim">{contact.company_name} • {contact.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-dim">Next email</p>
                    <p className="text-sm text-text">
                      {contact.next_email_at ? new Date(contact.next_email_at).toLocaleDateString() : 'Now'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <CampaignModal
          onClose={() => setShowCreateModal(false)}
          onSave={(data) => createMutation.mutate(data)}
        />
      )}

      {editingCampaign && (
        <CampaignModal
          campaign={editingCampaign}
          onClose={() => setEditingCampaign(null)}
          onSave={(data) => updateMutation.mutate({ id: editingCampaign.id, data })}
        />
      )}

      {editingTemplates && (
        <TemplateEditorModal
          campaign={editingTemplates}
          onClose={() => setEditingTemplates(null)}
          onSave={(templates) => saveTemplatesMutation.mutate({ campaignId: editingTemplates.id, templates })}
        />
      )}
    </div>
  );
}

