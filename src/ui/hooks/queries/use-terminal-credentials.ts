/**
 * TanStack Query hooks for terminal credentials (Epic #1667, #1693).
 *
 * Provides queries and mutations for credential CRUD and key generation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  TerminalCredential,
  TerminalCredentialsResponse,
  TerminalKeyPairResponse,
} from '@/ui/lib/api-types.ts';

/** Query key factory for terminal credentials. */
export const terminalCredentialKeys = {
  all: ['terminal-credentials'] as const,
  lists: () => [...terminalCredentialKeys.all, 'list'] as const,
  list: () => [...terminalCredentialKeys.lists()] as const,
  detail: (id: string) => [...terminalCredentialKeys.all, 'detail', id] as const,
};

/** Fetch terminal credentials list. */
export function useTerminalCredentials() {
  return useQuery({
    queryKey: terminalCredentialKeys.list(),
    queryFn: ({ signal }) => apiClient.get<TerminalCredentialsResponse>('/api/terminal/credentials', { signal }),
  });
}

/** Fetch a single terminal credential by ID. */
export function useTerminalCredential(id: string) {
  return useQuery({
    queryKey: terminalCredentialKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<TerminalCredential>(`/api/terminal/credentials/${id}`, { signal }),
    enabled: !!id,
  });
}

/** Create a terminal credential. */
export function useCreateTerminalCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; kind: string; value?: string; command?: string; command_timeout_s?: number; cache_ttl_s?: number }) =>
      apiClient.post<TerminalCredential>('/api/terminal/credentials', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalCredentialKeys.all });
    },
  });
}

/** Update a terminal credential. */
export function useUpdateTerminalCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; command?: string; command_timeout_s?: number; cache_ttl_s?: number }) =>
      apiClient.patch<TerminalCredential>(`/api/terminal/credentials/${id}`, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: terminalCredentialKeys.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: terminalCredentialKeys.lists() });
    },
  });
}

/** Delete a terminal credential. */
export function useDeleteTerminalCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/terminal/credentials/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalCredentialKeys.all });
    },
  });
}

/** Generate a new SSH key pair. */
export function useGenerateTerminalKeyPair() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; key_type?: string }) =>
      apiClient.post<TerminalKeyPairResponse>('/api/terminal/credentials/generate', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalCredentialKeys.all });
    },
  });
}
