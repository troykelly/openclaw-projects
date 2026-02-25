/**
 * TanStack Query hooks for terminal connections (Epic #1667, #1692).
 *
 * Provides queries and mutations for connection CRUD, testing, and SSH config import.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalConnection, TerminalConnectionsResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for terminal connections. */
export const terminalConnectionKeys = {
  all: ['terminal-connections'] as const,
  lists: () => [...terminalConnectionKeys.all, 'list'] as const,
  list: (search?: string) => [...terminalConnectionKeys.lists(), search] as const,
  detail: (id: string) => [...terminalConnectionKeys.all, 'detail', id] as const,
};

/** Fetch terminal connections list. */
export function useTerminalConnections(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';

  return useQuery({
    queryKey: terminalConnectionKeys.list(search),
    queryFn: ({ signal }) => apiClient.get<TerminalConnectionsResponse>(`/api/terminal/connections${qs}`, { signal }),
  });
}

/** Fetch a single terminal connection by ID. */
export function useTerminalConnection(id: string) {
  return useQuery({
    queryKey: terminalConnectionKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<TerminalConnection>(`/api/terminal/connections/${id}`, { signal }),
    enabled: !!id,
  });
}

/** Create a terminal connection. */
export function useCreateTerminalConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<TerminalConnection>) =>
      apiClient.post<TerminalConnection>('/api/terminal/connections', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalConnectionKeys.all });
    },
  });
}

/** Update a terminal connection. */
export function useUpdateTerminalConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<TerminalConnection>) =>
      apiClient.patch<TerminalConnection>(`/api/terminal/connections/${id}`, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: terminalConnectionKeys.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: terminalConnectionKeys.lists() });
    },
  });
}

/** Delete (soft) a terminal connection. */
export function useDeleteTerminalConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/terminal/connections/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalConnectionKeys.all });
    },
  });
}

/** Test a terminal connection. */
export function useTestTerminalConnection() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ success: boolean; message: string }>(`/api/terminal/connections/${id}/test`, {}),
  });
}

/** Import SSH config. */
export function useImportSshConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: string) =>
      apiClient.post<{ connections: TerminalConnection[] }>('/api/terminal/connections/import-ssh-config', { config }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalConnectionKeys.all });
    },
  });
}
