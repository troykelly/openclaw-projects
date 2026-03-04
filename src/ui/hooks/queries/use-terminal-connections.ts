/**
 * TanStack Query hooks for terminal connections (Epic #1667, #1692).
 *
 * Provides queries and mutations for connection CRUD, testing, and SSH config import.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalConnection, TerminalConnectionsResponse, TerminalKnownHostsResponse, SshConfigImportResponse } from '@/ui/lib/api-types.ts';

/** Response from POST /terminal/connections/:id/test */
export interface TestConnectionResponse {
  success: boolean;
  message: string;
  latency_ms: number;
  host_key_fingerprint: string;
  /** Structured error code for programmatic detection (e.g. 'HOST_KEY_VERIFICATION_FAILED'). */
  error_code?: string;
}

/** Query key factory for terminal connections. */
export const terminalConnectionKeys = {
  all: ['terminal-connections'] as const,
  lists: () => [...terminalConnectionKeys.all, 'list'] as const,
  list: (search?: string) => [...terminalConnectionKeys.lists(), search] as const,
  detail: (id: string) => [...terminalConnectionKeys.all, 'detail', id] as const,
};

/** Query key factory for terminal known hosts. */
export const terminalKnownHostKeys = {
  all: ['terminal-known-hosts'] as const,
  list: (connectionId?: string) => [...terminalKnownHostKeys.all, 'list', connectionId] as const,
};

/** Fetch terminal connections list. */
export function useTerminalConnections(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';

  return useQuery({
    queryKey: terminalConnectionKeys.list(search),
    queryFn: ({ signal }) => apiClient.get<TerminalConnectionsResponse>(`/terminal/connections${qs}`, { signal }),
  });
}

/** Fetch a single terminal connection by ID. */
export function useTerminalConnection(id: string) {
  return useQuery({
    queryKey: terminalConnectionKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<TerminalConnection>(`/terminal/connections/${id}`, { signal }),
    enabled: !!id,
  });
}

/** Create a terminal connection. */
export function useCreateTerminalConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<TerminalConnection>) =>
      apiClient.post<TerminalConnection>('/terminal/connections', data),
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
      apiClient.patch<TerminalConnection>(`/terminal/connections/${id}`, data),
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
    mutationFn: (id: string) => apiClient.delete(`/terminal/connections/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalConnectionKeys.all });
    },
  });
}

/** Test a terminal connection. */
export function useTestTerminalConnection() {
  return useMutation({
    mutationFn: ({ id, trustHostKey, expectedFingerprint }: { id: string; trustHostKey?: boolean; expectedFingerprint?: string }) =>
      apiClient.post<TestConnectionResponse>(`/terminal/connections/${id}/test`, {
        trust_host_key: trustHostKey ?? false,
        ...(expectedFingerprint ? { expected_fingerprint: expectedFingerprint } : {}),
      }),
  });
}

/** Import SSH config. */
export function useImportSshConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: string) =>
      apiClient.post<SshConfigImportResponse>('/terminal/connections/import-ssh-config', { config_text: config }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalConnectionKeys.all });
    },
  });
}

/** Fetch known hosts for a connection. */
export function useTerminalKnownHosts(connectionId?: string) {
  const qs = connectionId ? `?connection_id=${encodeURIComponent(connectionId)}` : '';

  return useQuery({
    queryKey: terminalKnownHostKeys.list(connectionId),
    queryFn: ({ signal }) => apiClient.get<TerminalKnownHostsResponse>(`/terminal/known-hosts${qs}`, { signal }),
    enabled: !!connectionId,
  });
}

/** Delete a known host entry. */
export function useDeleteTerminalKnownHost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/terminal/known-hosts/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalKnownHostKeys.all });
    },
  });
}
