/**
 * TanStack Query hooks for terminal enrollment tokens (Epic #1667, #1696).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalEnrollmentToken, TerminalEnrollmentTokensResponse } from '@/ui/lib/api-types.ts';

export const terminalEnrollmentKeys = {
  all: ['terminal-enrollment'] as const,
  lists: () => [...terminalEnrollmentKeys.all, 'list'] as const,
  list: () => [...terminalEnrollmentKeys.lists()] as const,
};

export function useTerminalEnrollmentTokens() {
  return useQuery({
    queryKey: terminalEnrollmentKeys.list(),
    queryFn: ({ signal }) => apiClient.get<TerminalEnrollmentTokensResponse>('/api/terminal/enrollment-tokens', { signal }),
  });
}

export function useCreateTerminalEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { label: string; max_uses?: number; expires_at?: string; allowed_tags?: string[] }) =>
      apiClient.post<TerminalEnrollmentToken>('/api/terminal/enrollment-tokens', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalEnrollmentKeys.all }); },
  });
}

export function useDeleteTerminalEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/terminal/enrollment-tokens/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalEnrollmentKeys.all }); },
  });
}
