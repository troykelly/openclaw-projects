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
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

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
  const url = `/dev-sessions${qs ? `?${qs}` : ''}`;

  const queryKey = useNamespaceQueryKey(devSessionKeys.list(filters));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<DevSessionsResponse>(url, { signal }),
  });
}

/**
 * Fetch a single dev session by ID.
 */
export function useDevSession(id: string) {
  const queryKey = useNamespaceQueryKey(devSessionKeys.detail(id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<DevSession>(`/dev-sessions/${id}`, { signal }),
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
      apiClient.post<DevSession>('/dev-sessions', body),
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
      apiClient.patch<DevSession>(`/dev-sessions/${id}`, body),
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
      apiClient.post<DevSession>(`/dev-sessions/${id}/complete`, {
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
    mutationFn: (id: string) => apiClient.delete(`/dev-sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devSessionKeys.all });
    },
  });
}
