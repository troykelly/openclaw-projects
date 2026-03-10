/**
 * TanStack Query hook for terminal worker health (Issue #1908).
 *
 * Polls the health endpoint to determine whether the terminal worker
 * is available, enabling graceful UI degradation when it is not.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

interface TerminalHealthResponse {
  status: 'ok' | 'unavailable';
}

export function useTerminalHealth() {
  const queryKey = useNamespaceQueryKey(['terminal', 'health']);
  return useQuery({
    queryKey,
    queryFn: () => apiClient.get<TerminalHealthResponse>('/terminal/health'),
    refetchInterval: 30_000,
    retry: false,
  });
}
