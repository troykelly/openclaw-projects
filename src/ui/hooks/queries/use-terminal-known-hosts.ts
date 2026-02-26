/**
 * TanStack Query hooks for terminal known hosts (Epic #1667, #1696).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalKnownHost, TerminalKnownHostsResponse } from '@/ui/lib/api-types.ts';

export const terminalKnownHostKeys = {
  all: ['terminal-known-hosts'] as const,
  lists: () => [...terminalKnownHostKeys.all, 'list'] as const,
  list: () => [...terminalKnownHostKeys.lists()] as const,
};

export function useTerminalKnownHosts() {
  return useQuery({
    queryKey: terminalKnownHostKeys.list(),
    queryFn: ({ signal }) => apiClient.get<TerminalKnownHostsResponse>('/api/terminal/known-hosts', { signal }),
  });
}

export function useApproveTerminalKnownHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { host: string; port: number; key_type: string; public_key: string }) =>
      apiClient.post<TerminalKnownHost>('/api/terminal/known-hosts/approve', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalKnownHostKeys.all }); },
  });
}

export function useDeleteTerminalKnownHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/terminal/known-hosts/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalKnownHostKeys.all }); },
  });
}

/** Reject a pending host key verification. */
export function useRejectTerminalKnownHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { session_id: string }) =>
      apiClient.post<{ rejected: boolean; session_id: string }>('/api/terminal/known-hosts/reject', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalKnownHostKeys.all }); },
  });
}
