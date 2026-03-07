import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import { api, type Contact } from '../../api';
import { emailApi } from '../../api/emailApi';
import type { CampaignContact, EmailCampaign } from '../../types/email';
import { useNotificationContext } from '../../contexts/NotificationContext';

type CampaignDetailsPanelProps = {
  campaign: EmailCampaign;
  onClose: () => void;
  onEditTemplates: (campaign: EmailCampaign) => void;
};

function formatNextSend(value?: string | null) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
}

export function CampaignDetailsPanel({ campaign, onClose, onEditTemplates }: CampaignDetailsPanelProps) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();
  const [contactSearch, setContactSearch] = useState('');

  const enrolledQuery = useQuery({
    queryKey: ['campaignContacts', campaign.id],
    queryFn: () => emailApi.getCampaignContacts(campaign.id),
  });
  const allContactsQuery = useQuery({
    queryKey: ['contacts', 'campaign-panel'],
    queryFn: () => api.getContacts(),
  });

  const enrolledContacts = useMemo(() => enrolledQuery.data ?? [], [enrolledQuery.data]);
  const enrolledIds = useMemo(() => new Set(enrolledContacts.map((item) => item.contact_id)), [enrolledContacts]);

  const availableContacts = useMemo(() => {
    const all = (allContactsQuery.data ?? []) as Contact[];
    const q = contactSearch.trim().toLowerCase();
    return all
      .filter((item) => !enrolledIds.has(item.id))
      .filter((item) => Boolean((item.email || '').trim()))
      .filter((item) => {
        if (!q) return true;
        const haystack = [item.name, item.email || '', item.company_name || '', item.title || ''].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 120);
  }, [allContactsQuery.data, contactSearch, enrolledIds]);

  const filteredEnrolledContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return enrolledContacts;
    return enrolledContacts.filter((item) => {
      const haystack = [item.contact_name, item.email || '', item.company_name || '', item.title || ''].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [contactSearch, enrolledContacts]);

  const enrollMutation = useMutation({
    mutationFn: (contactId: number) => emailApi.enrollContacts(campaign.id, [contactId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaignContacts', campaign.id] });
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      queryClient.invalidateQueries({ queryKey: ['emailStats'] });
      addNotification({ type: 'success', title: 'Contact added to campaign' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Could not add contact', message: err.message });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (campaignContactId: number) => emailApi.removeCampaignContact(campaign.id, campaignContactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaignContacts', campaign.id] });
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      queryClient.invalidateQueries({ queryKey: ['emailStats'] });
      addNotification({ type: 'success', title: 'Contact removed from campaign' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Could not remove contact', message: err.message });
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{campaign.name}</h3>
            <p className="truncate text-xs text-text-muted">{campaign.description || 'Campaign details'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close campaign details"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted capitalize">
            {campaign.status || 'draft'}
          </span>
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted">
            {campaign.num_emails} steps
          </span>
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => onEditTemplates(campaign)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Edit templates
          </button>
        </div>
      </div>

      <div className="min-h-0 flex flex-1 flex-col overflow-hidden px-4 py-3 text-xs">
        <section className="shrink-0 space-y-1 rounded-md border border-border bg-bg p-2">
          <dl className="divide-y divide-border">
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[92px] shrink-0 text-text-muted">Status</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text capitalize">{campaign.status || 'draft'}</dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[92px] shrink-0 text-text-muted">Sequence</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text">{campaign.num_emails} emails</dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[92px] shrink-0 text-text-muted">Cadence</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text">{campaign.days_between_emails} days</dd>
            </div>
            <div className="flex h-9 items-center justify-between gap-2">
              <dt className="w-[92px] shrink-0 text-text-muted">Enrolled</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-text tabular-nums">{enrolledContacts.length}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-4 flex min-h-0 flex-1 flex-col space-y-2 overflow-hidden">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Contacts</h4>
          <input
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            placeholder="Search contacts by name, email, company"
            className="h-8 w-full rounded-md border border-border bg-bg px-2.5 text-xs text-text"
          />

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            <div className="rounded-md border border-border bg-bg">
              <div className="shrink-0 bg-surface px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Enrolled
              </div>
              <div>
                {enrolledQuery.isLoading ? (
                  <p className="px-2.5 py-2 text-[11px] text-text-muted">Loading enrolled contacts...</p>
                ) : filteredEnrolledContacts.length === 0 ? (
                  <p className="px-2.5 py-2 text-[11px] text-text-muted">No enrolled contacts.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {filteredEnrolledContacts.map((item: CampaignContact) => (
                      <li key={item.id} className="px-2.5 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-medium text-text">{item.contact_name}</p>
                            <p className="truncate text-[10px] text-text-muted">{item.email || '-'}</p>
                            <p className="truncate text-[10px] text-text-muted">
                              Step {item.current_step || 0} - Next {formatNextSend(item.next_email_at)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeMutation.mutate(item.id)}
                            disabled={removeMutation.isPending}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            title="Remove contact"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-md border border-border bg-bg">
              <div className="bg-surface px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Available to add
              </div>
              <div>
                {allContactsQuery.isLoading ? (
                  <p className="px-2.5 py-2 text-[11px] text-text-muted">Loading contacts...</p>
                ) : availableContacts.length === 0 ? (
                  <p className="px-2.5 py-2 text-[11px] text-text-muted">No contacts available.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {availableContacts.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-text">{item.name}</p>
                          <p className="truncate text-[10px] text-text-muted">{item.email || '-'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => enrollMutation.mutate(item.id)}
                          disabled={enrollMutation.isPending}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover disabled:opacity-50"
                          title="Add contact"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
