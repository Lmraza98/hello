import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useDashboard() {
  const queryClient = useQueryClient();

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

  // Email stats
  const emailStats = useQuery({
    queryKey: ['email-stats'],
    queryFn: async () => {
      if (typeof (api as any).getEmailStats === 'function') {
        return (api as any).getEmailStats();
      }
      return null;
    },
    refetchInterval: 10000,
    retry: false,
  });

  // Today's contacts
  const todaysContacts = useQuery({
    queryKey: ['contacts', 'today'],
    queryFn: () => api.getContacts({ today_only: true }),
    refetchInterval: 3000,
  });

  const clearTodaysContacts = async () => {
    await api.clearContacts(true);
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  return {
    // Query data
    stats: stats.data,
    statsLoading: stats.isLoading,
    statsError: stats.isError,
    pipelineStatus: pipelineStatus.data,
    emailStats: emailStats.data,
    todaysContacts: todaysContacts.data || [],

    // Actions
    clearTodaysContacts,
  };
}
