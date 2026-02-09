/**
 * TanStack Query hooks for work item data fetching.
 *
 * Provides cached, deduplicated queries for work item lists, details, and trees.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { WorkItemsResponse, WorkItemDetail, WorkItemTreeResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for work items. */
export const workItemKeys = {
  all: ['work-items'] as const,
  lists: () => [...workItemKeys.all, 'list'] as const,
  list: (filters?: Record<string, string>) => [...workItemKeys.lists(), filters] as const,
  details: () => [...workItemKeys.all, 'detail'] as const,
  detail: (id: string) => [...workItemKeys.details(), id] as const,
  tree: () => [...workItemKeys.all, 'tree'] as const,
};

/**
 * Fetch the flat list of work items.
 *
 * @param filters - Optional query string params (e.g. `{ kind: 'project' }`)
 * @returns TanStack Query result with `WorkItemsResponse`
 */
export function useWorkItems(filters?: Record<string, string>) {
  const queryString = filters ? '?' + new URLSearchParams(filters).toString() : '';

  return useQuery({
    queryKey: workItemKeys.list(filters),
    queryFn: ({ signal }) => apiClient.get<WorkItemsResponse>(`/api/work-items${queryString}`, { signal }),
  });
}

/**
 * Fetch a single work item by ID.
 *
 * @param id - Work item UUID
 * @returns TanStack Query result with `WorkItemDetail`
 */
export function useWorkItem(id: string) {
  return useQuery({
    queryKey: workItemKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<WorkItemDetail>(`/api/work-items/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Fetch the hierarchical work item tree.
 *
 * @returns TanStack Query result with `WorkItemTreeResponse`
 */
export function useWorkItemTree() {
  return useQuery({
    queryKey: workItemKeys.tree(),
    queryFn: ({ signal }) => apiClient.get<WorkItemTreeResponse>('/api/work-items/tree', { signal }),
  });
}
