/**
 * TanStack Query hooks for dev session tracking (Issue #1285).
 *
 * Provides queries for listing/fetching sessions and mutations for
 * creating, updating, completing, and deleting dev sessions.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  DevSession,
  DevSessionsResponse,
  CreateDevSessionBody,
  UpdateDevSessionBody,
} from '@/ui/lib/api-types.ts';

/** Query key factory for dev sessions. */
export const devSessionKeys = {
  all: ['dev-sessions'] as const,
  list: (filters?: { status?: string; node?: string; project_id?: string }) =>
    [...devSessionKeys.all, 'list', filters] as const,
  detail: (id: string) => [...devSessionKeys.all, 'detail', id] as const,
};

/**
 * Fetch dev sessions with optional filters.
 */
export function useDevSessions(filters?: { status?: string; node?: string; project_id?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.node) params.set('node', filters.node);
  if (filters?.project_id) params.set('project_id', filters.project_id);
  const qs = params.toString();
  const url = `/api/dev-sessions${qs ? `?${qs}` : ''}`;

  return useQuery({
    queryKey: devSessionKeys.list(filters),
    queryFn: ({ signal }) => apiClient.get<DevSessionsResponse>(url, { signal }),
  });
}

/**
 * Fetch a single dev session by ID.
 */
export function useDevSession(id: string) {
  return useQuery({
    queryKey: devSessionKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<DevSession>(`/api/dev-sessions/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Mutation: create a new dev session.
 */
export function useCreateDevSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateDevSessionBody) =>
      apiClient.post<DevSession>('/api/dev-sessions', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devSessionKeys.all });
    },
  });
}

/**
 * Mutation: update a dev session.
 */
export function useUpdateDevSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDevSessionBody }) =>
      apiClient.patch<DevSession>(`/api/dev-sessions/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devSessionKeys.all });
    },
  });
}

/**
 * Mutation: mark a dev session as completed.
 */
export function useCompleteDevSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, completionSummary }: { id: string; completionSummary?: string }) =>
      apiClient.post<DevSession>(`/api/dev-sessions/${id}/complete`, {
        completion_summary: completionSummary,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devSessionKeys.all });
    },
  });
}

/**
 * Mutation: delete a dev session.
 */
export function useDeleteDevSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/dev-sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devSessionKeys.all });
    },
  });
}
