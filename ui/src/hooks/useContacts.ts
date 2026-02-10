import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Contact } from '../api';
import { useNotificationContext } from '../contexts/NotificationContext';

export function useContacts() {
  const queryClient = useQueryClient();
  const { addNotification, updateNotification } = useNotificationContext();

  // Queries
  const contacts = useQuery({
    queryKey: ['contacts'],
    queryFn: () => api.getContacts()
  });

  const campaigns = useQuery({
    queryKey: ['emailCampaigns'],
    queryFn: () => api.getEmailCampaigns()
  });

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.getCompanies()
  });

  const getCampaignContacts = (campaignId: string) => useQuery({
    queryKey: ['campaignContacts', campaignId],
    queryFn: () => api.getCampaignContacts(Number(campaignId)),
    enabled: !!campaignId,
  });

  // Mutations
  const addContact = useMutation({
    mutationFn: (contact: Partial<Contact>) => api.addContact(contact),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      addNotification({ type: 'success', title: 'Contact added' });
    },
    onError: (err: Error) => addNotification({ type: 'error', title: 'Failed to add contact', message: err.message }),
  });

  const bulkAction = useMutation({
    mutationFn: async ({ action, contactIds, campaignId, notificationId }: { action: string; contactIds: number[]; campaignId?: number; notificationId?: string }) => {
      const res = await fetch(`/api/contacts/bulk-actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: contactIds, campaign_id: campaignId }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Action failed: ${res.status} - ${errorText}`);
      }
      return { ...await res.json(), notificationId };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      const actionNames: Record<string, string> = {
        'salesforce-upload': 'Salesforce Upload',
        'linkedin-request': 'LinkedIn Request',
        'send-email': 'Send Email',
        'collect-phone': 'Phone Data Collection',
      };
      const actionName = actionNames[variables.action] || variables.action;
      const msg = data.message || `Processed ${data.processed || data.sent || 0} of ${data.total || variables.contactIds.length} contacts`;
      if (data.notificationId) {
        updateNotification(data.notificationId, { type: 'success', title: `${actionName} completed`, message: msg });
      } else {
        addNotification({ type: 'success', title: `${actionName} completed`, message: msg });
      }
    },
    onError: (error: Error, variables) => {
      const actionNames: Record<string, string> = {
        'salesforce-upload': 'Salesforce Upload',
        'linkedin-request': 'LinkedIn Request',
        'send-email': 'Send Email',
        'collect-phone': 'Phone Data Collection',
      };
      const actionName = actionNames[variables.action] || variables.action;
      if (variables.notificationId) {
        updateNotification(variables.notificationId, { type: 'error', title: `${actionName} failed`, message: error.message });
      } else {
        addNotification({ type: 'error', title: `${actionName} failed`, message: error.message });
      }
    },
  });

  const enrollInCampaign = useMutation({
    mutationFn: async ({ campaignId, contactIds }: { campaignId: number; contactIds: number[] }) =>
      api.enrollInCampaign(campaignId, contactIds),
    onSuccess: (data) => {
      addNotification({
        type: 'success',
        title: 'Contacts enrolled',
        message: `${data.enrolled} contacts enrolled${data.skipped > 0 ? ` (${data.skipped} already enrolled)` : ''}`
      });
    },
    onError: (error: Error) => addNotification({ type: 'error', title: 'Enrollment failed', message: error.message }),
  });

  const deleteContact = useMutation({
    mutationFn: (id: number) => api.deleteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      addNotification({ type: 'success', title: 'Contact deleted' });
    },
    onError: (err: Error) => addNotification({ type: 'error', title: 'Failed to delete contact', message: err.message }),
  });

  const bulkDeleteContacts = useMutation({
    mutationFn: (contactIds: number[]) => api.bulkDeleteContacts(contactIds),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      addNotification({
        type: 'success',
        title: 'Contacts deleted',
        message: data.message || `Deleted ${data.deleted} contact(s)`
      });
    },
    onError: (err: Error) => addNotification({ type: 'error', title: 'Failed to delete contacts', message: err.message }),
  });

  return {
    // Query data
    contacts: contacts.data || [],
    contactsLoading: contacts.isLoading,
    campaigns: campaigns.data || [],
    companies: companies.data || [],
    getCampaignContacts,

    // Mutations
    addContact,
    deleteContact,
    bulkDeleteContacts,
    bulkAction,
    enrollInCampaign,
  };
}
