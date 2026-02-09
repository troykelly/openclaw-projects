/**
 * TanStack Query hooks for memories.
 *
 * Provides queries for work-item-scoped memories and global memory lists.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { WorkItemMemoriesResponse, MemoryListResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for memories. */
export const memoryKeys = {
  all: ['memories'] as const,
  lists: () => [...memoryKeys.all, 'list'] as const,
  list: () => [...memoryKeys.lists()] as const,
  forWorkItem: (workItemId: string) => [...memoryKeys.all, 'work-item', workItemId] as const,
};

/**
 * Fetch memories attached to a specific work item.
 *
 * @param workItemId - The work item UUID
 * @returns TanStack Query result with `WorkItemMemoriesResponse`
 */
export function useWorkItemMemories(workItemId: string) {
  return useQuery({
    queryKey: memoryKeys.forWorkItem(workItemId),
    queryFn: ({ signal }) => apiClient.get<WorkItemMemoriesResponse>(`/api/work-items/${workItemId}/memories`, { signal }),
    enabled: !!workItemId,
  });
}

/**
 * Fetch the global memory list.
 *
 * @returns TanStack Query result with `MemoryListResponse`
 */
export function useMemories() {
  return useQuery({
    queryKey: memoryKeys.list(),
    queryFn: ({ signal }) => apiClient.get<MemoryListResponse>('/api/memory', { signal }),
  });
}
