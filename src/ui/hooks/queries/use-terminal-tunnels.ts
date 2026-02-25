/**
 * TanStack Query hooks for terminal tunnels (Epic #1667, #1696).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalTunnel, TerminalTunnelsResponse } from '@/ui/lib/api-types.ts';

export const terminalTunnelKeys = {
  all: ['terminal-tunnels'] as const,
  lists: () => [...terminalTunnelKeys.all, 'list'] as const,
  list: () => [...terminalTunnelKeys.lists()] as const,
};

export function useTerminalTunnels() {
  return useQuery({
    queryKey: terminalTunnelKeys.list(),
    queryFn: ({ signal }) => apiClient.get<TerminalTunnelsResponse>('/api/terminal/tunnels', { signal }),
  });
}

export function useCreateTerminalTunnel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { connection_id: string; direction: string; bind_host?: string; bind_port: number; target_host?: string; target_port?: number }) =>
      apiClient.post<TerminalTunnel>('/api/terminal/tunnels', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalTunnelKeys.all }); },
  });
}

export function useDeleteTerminalTunnel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/terminal/tunnels/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalTunnelKeys.all }); },
  });
}
