/**
 * TanStack Query hook for terminal worker health (Issue #1908).
 *
 * Polls the health endpoint to determine whether the terminal worker
 * is available, enabling graceful UI degradation when it is not.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

interface TerminalHealthResponse {
  status: 'ok' | 'unavailable';
}

export function useTerminalHealth() {
  return useQuery({
    queryKey: ['terminal', 'health'],
    queryFn: () => apiClient.get<TerminalHealthResponse>('/api/terminal/health'),
    refetchInterval: 30_000,
    retry: false,
  });
}
