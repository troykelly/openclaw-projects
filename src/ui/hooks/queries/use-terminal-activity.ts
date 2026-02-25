/**
 * TanStack Query hooks for terminal activity/audit log (Epic #1667, #1696).
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalActivityResponse } from '@/ui/lib/api-types.ts';

export const terminalActivityKeys = {
  all: ['terminal-activity'] as const,
  lists: () => [...terminalActivityKeys.all, 'list'] as const,
  list: (filters?: Record<string, string>) => [...terminalActivityKeys.lists(), filters] as const,
};

export function useTerminalActivity(filters?: { session_id?: string; connection_id?: string; action?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.session_id) params.set('session_id', filters.session_id);
  if (filters?.connection_id) params.set('connection_id', filters.connection_id);
  if (filters?.action) params.set('action', filters.action);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: terminalActivityKeys.list(filters as Record<string, string>),
    queryFn: ({ signal }) => apiClient.get<TerminalActivityResponse>(`/api/terminal/activity${qs ? `?${qs}` : ''}`, { signal }),
  });
}
