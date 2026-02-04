/**
 * TanStack Query hook for the backlog/kanban board data.
 *
 * Fetches backlog items from GET /api/backlog with optional filters.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { BacklogResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for backlog. */
export const backlogKeys = {
  all: ['backlog'] as const,
  list: (filters?: { priority?: string[]; kind?: string[] }) =>
    [...backlogKeys.all, 'list', filters] as const,
};

/**
 * Fetch backlog items with optional priority and kind filters.
 *
 * @param filters - Optional priority and kind filter arrays
 * @returns TanStack Query result with `BacklogResponse`
 */
export function useBacklog(filters?: { priority?: string[]; kind?: string[] }) {
  const params = new URLSearchParams();
  filters?.priority?.forEach((p) => params.append('priority', p));
  filters?.kind?.forEach((k) => params.append('kind', k));
  const queryString = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: backlogKeys.list(filters),
    queryFn: ({ signal }) =>
      apiClient.get<BacklogResponse>(`/api/backlog${queryString}`, { signal }),
  });
}
