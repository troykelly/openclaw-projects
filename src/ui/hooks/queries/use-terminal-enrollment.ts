/**
 * TanStack Query hooks for terminal enrollment tokens (Epic #1667, #1696).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalEnrollmentToken, TerminalEnrollmentTokensResponse } from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

export const terminalEnrollmentKeys = {
  all: ['terminal-enrollment'] as const,
  lists: () => [...terminalEnrollmentKeys.all, 'list'] as const,
  list: () => [...terminalEnrollmentKeys.lists()] as const,
};

export function useTerminalEnrollmentTokens() {
  const queryKey = useNamespaceQueryKey(terminalEnrollmentKeys.list());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<TerminalEnrollmentTokensResponse>('/terminal/enrollment-tokens', { signal }),
  });
}

export function useCreateTerminalEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { label: string; max_uses?: number; expires_at?: string; allowed_tags?: string[] }) =>
      apiClient.post<TerminalEnrollmentToken>('/terminal/enrollment-tokens', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalEnrollmentKeys.all }); },
  });
}

export function useDeleteTerminalEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/terminal/enrollment-tokens/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: terminalEnrollmentKeys.all }); },
  });
}
