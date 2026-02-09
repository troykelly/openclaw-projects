/**
 * TanStack Query hook for project-level work items.
 *
 * Projects are work items with `kind = 'project'`. This hook provides a
 * convenience wrapper over the generic work items query.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { WorkItemsResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for projects. */
export const projectKeys = {
  all: ['projects'] as const,
  list: () => [...projectKeys.all, 'list'] as const,
};

/**
 * Fetch work items filtered to kind=project.
 *
 * @returns TanStack Query result with `WorkItemsResponse`
 */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: ({ signal }) => apiClient.get<WorkItemsResponse>('/api/work-items?kind=project', { signal }),
  });
}
