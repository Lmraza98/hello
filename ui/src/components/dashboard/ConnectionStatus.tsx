import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '../../api';

export function ConnectionStatus() {
  const { isError, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 3000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="hidden sm:inline">Connecting...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span className="hidden sm:inline">Offline</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs">
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <span className="hidden sm:inline">Connected</span>
    </div>
  );
}
