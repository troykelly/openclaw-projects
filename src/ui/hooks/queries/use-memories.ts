/**
 * TanStack Query hooks for memories.
 *
 * Provides queries for work-item-scoped memories, project-scoped memories,
 * and global memory lists.
 * Project scope added in Issue #1273.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { MemoryListResponse, WorkItemMemoriesResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for memories. */
export const memoryKeys = {
  all: ['memories'] as const,
  lists: () => [...memoryKeys.all, 'list'] as const,
  list: () => [...memoryKeys.lists()] as const,
  forWorkItem: (workItemId: string) => [...memoryKeys.all, 'work-item', workItemId] as const,
  forProject: (projectId: string) => [...memoryKeys.all, 'project', projectId] as const,
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

/**
 * Fetch memories scoped to a specific project.
 *
 * @param projectId - The project UUID
 * @returns TanStack Query result with `MemoryListResponse`
 */
export function useProjectMemories(projectId: string) {
  return useQuery({
    queryKey: memoryKeys.forProject(projectId),
    queryFn: ({ signal }) => apiClient.get<MemoryListResponse>(`/api/projects/${projectId}/memories`, { signal }),
    enabled: !!projectId,
  });
}
