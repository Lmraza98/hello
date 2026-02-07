import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emailApi } from '../api/emailApi';
import { useNotificationContext } from '../contexts/NotificationContext';
import type { EmailCampaign, EmailTemplate, EmailConfig } from '../types/email';

export function useEmailCampaigns() {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();

  // Queries
  const campaigns = useQuery({
    queryKey: ['emailCampaigns'],
    queryFn: () => emailApi.getCampaigns()
  });

  const sentEmails = useQuery({
    queryKey: ['sentEmails'],
    queryFn: () => emailApi.getSentEmails(undefined, 100)
  });

  const stats = useQuery({
    queryKey: ['emailStats'],
    queryFn: () => emailApi.getStats()
  });

  const queue = useQuery({
    queryKey: ['emailQueue'],
    queryFn: () => emailApi.getQueue()
  });

  const reviewQueue = useQuery({
    queryKey: ['reviewQueue'],
    queryFn: () => emailApi.getReviewQueue(),
    refetchInterval: 30000
  });

  const scheduled = useQuery({
    queryKey: ['scheduledEmails'],
    queryFn: () => emailApi.getScheduled()
  });

  const emailConfig = useQuery({
    queryKey: ['emailConfig'],
    queryFn: () => emailApi.getConfig()
  });

  // Mutations
  const createCampaign = useMutation({
    mutationFn: (data: Partial<EmailCampaign>) => emailApi.createCampaign(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'success', title: 'Campaign created', message: 'Now add your email templates' });
    }
  });

  const updateCampaign = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<EmailCampaign> }) => emailApi.updateCampaign(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
    }
  });

  const deleteCampaign = useMutation({
    mutationFn: (id: number) => emailApi.deleteCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'success', title: 'Campaign deleted' });
    }
  });

  const activateCampaign = useMutation({
    mutationFn: (id: number) => emailApi.activateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'success', title: 'Campaign activated', message: 'Emails will start sending' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Activation failed', message: err.message });
    }
  });

  const pauseCampaign = useMutation({
    mutationFn: (id: number) => emailApi.pauseCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'info', title: 'Campaign paused' });
    }
  });

  const saveTemplates = useMutation({
    mutationFn: async ({ campaignId, templates }: { campaignId: number; templates: Array<{ step_number: number; subject_template: string; body_template: string }> }) => {
      await emailApi.saveTemplates(campaignId, templates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      addNotification({ type: 'success', title: 'Templates saved' });
    }
  });

  const sendEmails = useMutation({
    mutationFn: async (campaignId?: number) => {
      return emailApi.sendEmails(campaignId);
    },
    onSuccess: (data) => {
      if (data.success) {
        addNotification({ type: 'success', title: 'Email sender launched', message: data.message });
      } else {
        addNotification({ type: 'error', title: 'Failed to start', message: data.error });
      }
    }
  });

  const approveEmail = useMutation({
    mutationFn: async ({ emailId, subject, body }: { emailId: number; subject?: string; body?: string }) => {
      return emailApi.approveEmail(emailId, subject, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewQueue'] });
      queryClient.invalidateQueries({ queryKey: ['scheduledEmails'] });
      addNotification({ type: 'success', title: 'Email approved' });
    }
  });

  const rejectEmail = useMutation({
    mutationFn: (emailId: number) => emailApi.rejectEmail(emailId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewQueue'] });
      addNotification({ type: 'info', title: 'Email rejected' });
    }
  });

  const approveAll = useMutation({
    mutationFn: (emailIds: number[]) => emailApi.approveAll(emailIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewQueue'] });
      queryClient.invalidateQueries({ queryKey: ['scheduledEmails'] });
      addNotification({ type: 'success', title: 'All emails approved' });
    }
  });

  const prepareBatch = useMutation({
    mutationFn: () => emailApi.prepareBatch(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reviewQueue'] });
      if (data.success) {
        addNotification({ type: 'success', title: 'Batch prepared', message: data.message });
      } else {
        addNotification({ type: 'error', title: 'Batch failed', message: data.error || data.message });
      }
    }
  });

  const updateConfig = useMutation({
    mutationFn: (data: Partial<EmailConfig>) => emailApi.updateConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailConfig'] });
      addNotification({ type: 'success', title: 'Settings saved' });
    }
  });

  const uploadToSalesforce = useMutation({
    mutationFn: async (campaignId: number) => {
      return emailApi.uploadToSalesforce(campaignId);
    },
    onSuccess: (data) => {
      if (data.success) {
        addNotification({ 
          type: 'success', 
          title: 'Salesforce upload started', 
          message: data.message || `Exported ${data.exported} contacts.`
        });
      } else {
        addNotification({ type: 'error', title: 'Upload failed', message: data.error });
      }
    },
    onError: () => {
      addNotification({ type: 'error', title: 'Upload failed', message: 'An unexpected error occurred' });
    }
  });

  return {
    // Query data
    campaigns: campaigns.data || [],
    campaignsLoading: campaigns.isLoading,
    sentEmails: sentEmails.data || [],
    sentLoading: sentEmails.isLoading,
    stats: stats.data,
    queue: queue.data || [],
    reviewQueue: reviewQueue.data || [],
    scheduled: scheduled.data || [],
    emailConfig: emailConfig.data,
    
    // Mutations
    createCampaign,
    updateCampaign,
    deleteCampaign,
    activateCampaign,
    pauseCampaign,
    saveTemplates,
    sendEmails,
    approveEmail,
    rejectEmail,
    approveAll,
    prepareBatch,
    updateConfig,
    uploadToSalesforce
  };
}
