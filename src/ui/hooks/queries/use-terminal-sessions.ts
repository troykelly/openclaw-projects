/**
 * TanStack Query hooks for terminal sessions (Epic #1667, #1691).
 *
 * Provides queries and mutations for session CRUD, resize, and annotation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  TerminalSession,
  TerminalSessionsResponse,
  TerminalEntriesResponse,
  TerminalDashboardStats,
} from '@/ui/lib/api-types.ts';

/** Query key factory for terminal sessions. */
export const terminalSessionKeys = {
  all: ['terminal-sessions'] as const,
  lists: () => [...terminalSessionKeys.all, 'list'] as const,
  list: (filters?: Record<string, string>) => [...terminalSessionKeys.lists(), filters] as const,
  detail: (id: string) => [...terminalSessionKeys.all, 'detail', id] as const,
  entries: (id: string, params?: Record<string, string>) => [...terminalSessionKeys.all, 'entries', id, params] as const,
  stats: () => [...terminalSessionKeys.all, 'stats'] as const,
};

/** Fetch terminal sessions list. */
export function useTerminalSessions(filters?: { status?: string; connection_id?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connection_id) params.set('connection_id', filters.connection_id);
  const qs = params.toString();

  return useQuery({
    queryKey: terminalSessionKeys.list(filters as Record<string, string>),
    queryFn: ({ signal }) => apiClient.get<TerminalSessionsResponse>(`/api/terminal/sessions${qs ? `?${qs}` : ''}`, { signal }),
  });
}

/** Fetch a single terminal session by ID. */
export function useTerminalSession(id: string) {
  return useQuery({
    queryKey: terminalSessionKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<TerminalSession>(`/api/terminal/sessions/${id}`, { signal }),
    enabled: !!id,
  });
}

/** Fetch session entries (history). */
export function useTerminalEntries(sessionId: string, params?: { limit?: number; offset?: number; kind?: string }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.kind) qs.set('kind', params.kind);
  const qsStr = qs.toString();

  return useQuery({
    queryKey: terminalSessionKeys.entries(sessionId, params as Record<string, string>),
    queryFn: ({ signal }) =>
      apiClient.get<TerminalEntriesResponse>(`/api/terminal/sessions/${sessionId}/entries${qsStr ? `?${qsStr}` : ''}`, { signal }),
    enabled: !!sessionId,
  });
}

/** Fetch terminal dashboard stats. */
export function useTerminalStats() {
  return useQuery({
    queryKey: terminalSessionKeys.stats(),
    queryFn: ({ signal }) => apiClient.get<TerminalDashboardStats>('/api/terminal/stats', { signal }),
  });
}

/** Create a terminal session. */
export function useCreateTerminalSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { connection_id: string; tags?: string[]; notes?: string }) =>
      apiClient.post<TerminalSession>('/api/terminal/sessions', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalSessionKeys.all });
    },
  });
}

/** Terminate a terminal session. */
export function useTerminateTerminalSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/terminal/sessions/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalSessionKeys.all });
    },
  });
}

/** Update session notes/tags. */
export function useUpdateTerminalSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; tags?: string[]; notes?: string }) =>
      apiClient.patch<TerminalSession>(`/api/terminal/sessions/${id}`, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: terminalSessionKeys.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: terminalSessionKeys.lists() });
    },
  });
}

/** Add annotation to a session. */
export function useAnnotateTerminalSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, content }: { sessionId: string; content: string }) =>
      apiClient.post(`/api/terminal/sessions/${sessionId}/annotate`, { content }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: terminalSessionKeys.entries(variables.sessionId) });
    },
  });
}
