import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Company } from '../api';

export function useCompanies() {
  const queryClient = useQueryClient();

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
    },
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
    resetCompanies,
    importCompanies,
  };
}
