/**
 * TanStack Query hooks for Symphony run management.
 *
 * Provides queries for listing/fetching runs and mutations for
 * run actions (cancel, retry).
 *
 * Issue #2209 (Epic #2186)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  SymphonyRunDetail,
  SymphonyRunsResponse,
} from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** Query key factory for symphony runs. */
export const symphonyRunKeys = {
  all: ['symphony-runs'] as const,
  list: (filters?: { status?: string; project_id?: string }) =>
    [...symphonyRunKeys.all, 'list', filters] as const,
  detail: (id: string) => [...symphonyRunKeys.all, 'detail', id] as const,
  events: (id: string) => [...symphonyRunKeys.all, 'events', id] as const,
};

/**
 * Fetch symphony runs with optional filters.
 */
export function useSymphonyRuns(filters?: { status?: string; project_id?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.project_id) params.set('project_id', filters.project_id);
  const qs = params.toString();
  const url = `/symphony/runs${qs ? `?${qs}` : ''}`;

  const queryKey = useNamespaceQueryKey(symphonyRunKeys.list(filters));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SymphonyRunsResponse>(url, { signal }),
  });
}

/**
 * Fetch a single symphony run by ID.
 */
export function useSymphonyRun(id: string) {
  const queryKey = useNamespaceQueryKey(symphonyRunKeys.detail(id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SymphonyRunDetail>(`/symphony/runs/${id}`, { signal }),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

/**
 * Mutation: cancel a run.
 */
export function useCancelSymphonyRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<SymphonyRunDetail>(`/symphony/runs/${id}/cancel`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: symphonyRunKeys.all });
    },
  });
}

/**
 * Mutation: retry a run.
 */
export function useRetrySymphonyRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<SymphonyRunDetail>(`/symphony/runs/${id}/retry`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: symphonyRunKeys.all });
    },
  });
}
