import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../api';

export type OutlookAuthFlow = {
  verification_uri: string;
  user_code: string;
  message: string;
} | null;

export function useDashboard() {
  const queryClient = useQueryClient();
  const [outlookAuthFlow, setOutlookAuthFlow] = useState<OutlookAuthFlow>(null);
  const prevAuthenticatedRef = useRef(false);

  // Main stats
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 3000,
  });

  // Pipeline status
  const pipelineStatus = useQuery({
    queryKey: ['pipeline-status'],
    queryFn: api.getPipelineStatus,
    refetchInterval: 1000,
  });

  // Email stats (includes recent_replies and outlook_connected)
  const emailStats = useQuery({
    queryKey: ['email-stats'],
    queryFn: api.getEmailDashboardMetrics,
    refetchInterval: 10000,
    retry: false,
  });

  // Today's contacts
  const todaysContacts = useQuery({
    queryKey: ['contacts', 'today'],
    queryFn: () => api.getContacts({ today_only: true }),
    refetchInterval: 3000,
  });

  // Scheduled emails for dashboard (next few sends)
  const scheduledEmails = useQuery({
    queryKey: ['scheduled-emails-dashboard'],
    queryFn: api.getScheduledEmailsForDashboard,
    refetchInterval: 15000,
    retry: false,
  });

  // Outlook auth status — poll fast (3s) while auth flow is active, slow (30s) otherwise
  const outlookAuth = useQuery({
    queryKey: ['outlook-auth'],
    queryFn: api.getOutlookAuthStatus,
    refetchInterval: outlookAuthFlow ? 3000 : 30000,
    retry: false,
  });

  // When auth transitions from not-authenticated → authenticated, clear the flow
  const isAuthenticated = outlookAuth.data?.authenticated ?? false;
  useEffect(() => {
    if (isAuthenticated && !prevAuthenticatedRef.current && outlookAuthFlow) {
      setOutlookAuthFlow(null);
      queryClient.invalidateQueries({ queryKey: ['email-stats'] });
    }
    prevAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated, outlookAuthFlow, queryClient]);

  const clearTodaysContacts = async () => {
    await api.clearContacts(true);
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  // Start Outlook connection
  const connectOutlook = useMutation({
    mutationFn: () => api.startOutlookAuth(),
    onSuccess: (data) => {
      if (data.success && !data.already_authenticated && data.verification_uri && data.user_code) {
        setOutlookAuthFlow({
          verification_uri: data.verification_uri,
          user_code: data.user_code,
          message: data.message || '',
        });
      } else if (data.already_authenticated) {
        queryClient.invalidateQueries({ queryKey: ['outlook-auth'] });
        queryClient.invalidateQueries({ queryKey: ['email-stats'] });
      }
    },
  });

  // Disconnect Outlook
  const disconnectOutlook = useMutation({
    mutationFn: () => api.outlookLogout(),
    onSuccess: () => {
      setOutlookAuthFlow(null);
      queryClient.invalidateQueries({ queryKey: ['outlook-auth'] });
      queryClient.invalidateQueries({ queryKey: ['email-stats'] });
    },
  });

  // Manual reply poll
  const pollReplies = useMutation({
    mutationFn: () => api.pollOutlookReplies(15),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-stats'] });
    },
  });

  // Mark conversation as handled
  const markHandled = useMutation({
    mutationFn: (replyId: number) => api.markConversationHandled(replyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-stats'] });
    },
  });

  const markConversationHandled = useCallback(
    (replyId: number) => markHandled.mutateAsync(replyId),
    [markHandled]
  );

  return {
    // Query data
    stats: stats.data,
    statsLoading: stats.isLoading,
    statsError: stats.isError,
    pipelineStatus: pipelineStatus.data,
    emailStats: emailStats.data,
    todaysContacts: todaysContacts.data || [],
    scheduledEmails: scheduledEmails.data || [],
    outlookAuth: outlookAuth.data,
    outlookAuthFlow,

    // Actions
    clearTodaysContacts,
    connectOutlook: connectOutlook.mutateAsync,
    connectOutlookLoading: connectOutlook.isPending,
    disconnectOutlook: disconnectOutlook.mutateAsync,
    cancelOutlookAuth: () => setOutlookAuthFlow(null),
    pollReplies: pollReplies.mutateAsync,
    pollRepliesLoading: pollReplies.isPending,
    markConversationHandled,
  };
}
