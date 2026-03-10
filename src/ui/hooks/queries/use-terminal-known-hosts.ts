/**
 * TanStack Query hooks for terminal known hosts (Epic #1667, #1696).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalKnownHost, TerminalKnownHostsResponse } from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

export const terminalKnownHostKeys = {
  all: ['terminal-known-hosts'] as const,
  lists: () => [...terminalKnownHostKeys.all, 'list'] as const,
  list: () => [...terminalKnownHostKeys.lists()] as const,
};

export function useTerminalKnownHosts() {
  const queryKey = useNamespaceQueryKey(terminalKnownHostKeys.list());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<TerminalKnownHostsResponse>('/terminal/known-hosts', { signal }),
  });
}

export function useApproveTerminalKnownHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { session_id: string; host: string; port: number; key_type: string; fingerprint: string; public_key: string }) =>
      apiClient.post<TerminalKnownHost>('/terminal/known-hosts/approve', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalKnownHostKeys.all }); },
  });
}

export function useDeleteTerminalKnownHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/terminal/known-hosts/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalKnownHostKeys.all }); },
  });
}

/** Reject a pending host key verification. */
export function useRejectTerminalKnownHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { session_id: string }) =>
      apiClient.post<{ rejected: boolean; session_id: string }>('/terminal/known-hosts/reject', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalKnownHostKeys.all }); },
  });
}
