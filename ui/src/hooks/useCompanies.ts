import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Company } from '../api';
import { useNotificationContext } from '../contexts/NotificationContext';

export function useCompanies() {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();

  // Queries
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.getCompanies(),
  });

  // Mutations
  const addCompany = useMutation({
    mutationFn: (company: Partial<Company>) => api.addCompany(company),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const deleteCompany = useMutation({
    mutationFn: (id: number) => api.deleteCompany(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      addNotification({ type: 'success', title: 'Company deleted' });
    },
    onError: (err: Error) => addNotification({ type: 'error', title: 'Failed to delete company', message: err.message }),
  });

  const bulkDeleteCompanies = useMutation({
    mutationFn: (companyIds: number[]) => api.bulkDeleteCompanies(companyIds),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      addNotification({
        type: 'success',
        title: 'Companies deleted',
        message: data.message || `Deleted ${data.deleted} compan${data.deleted === 1 ? 'y' : 'ies'}`
      });
    },
    onError: (err: Error) => addNotification({ type: 'error', title: 'Failed to delete companies', message: err.message }),
  });

  const resetCompanies = useMutation({
    mutationFn: () => api.resetCompanies(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  });

  const importCompanies = async (file: File) => {
    const result = await api.importCompanies(file);
    queryClient.invalidateQueries({ queryKey: ['companies'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    return result;
  };

  return {
    // Query data
    companies: companies.data || [],
    companiesLoading: companies.isLoading,

    // Mutations
    addCompany,
    deleteCompany,
    bulkDeleteCompanies,
    resetCompanies,
    importCompanies,
  };
}
