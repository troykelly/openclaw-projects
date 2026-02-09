/**
 * TanStack Query hook for dependency graph data.
 *
 * Fetches the dependency graph for a specific work item.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { DependencyGraphResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for dependency graphs. */
export const dependencyGraphKeys = {
  all: ['dependency-graph'] as const,
  item: (id: string) => [...dependencyGraphKeys.all, id] as const,
};

/**
 * Fetch the dependency graph for a work item.
 *
 * @param id - Work item UUID
 * @returns TanStack Query result with `DependencyGraphResponse`
 */
export function useDependencyGraph(id: string) {
  return useQuery({
    queryKey: dependencyGraphKeys.item(id),
    queryFn: ({ signal }) => apiClient.get<DependencyGraphResponse>(`/api/work-items/${id}/dependency-graph`, { signal }),
    enabled: !!id,
  });
}
