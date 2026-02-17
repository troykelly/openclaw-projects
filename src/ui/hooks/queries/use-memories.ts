/**
 * TanStack Query hooks for memories.
 *
 * Provides queries for work-item-scoped memories, project-scoped memories,
 * and global memory lists.
 * Project scope added in Issue #1273.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { MemoryAttachmentsResponse, MemoryListResponse, WorkItemMemoriesResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for memories. */
export const memoryKeys = {
  all: ['memories'] as const,
  lists: () => [...memoryKeys.all, 'list'] as const,
  list: () => [...memoryKeys.lists()] as const,
  forWorkItem: (work_item_id: string) => [...memoryKeys.all, 'work-item', work_item_id] as const,
  forProject: (project_id: string) => [...memoryKeys.all, 'project', project_id] as const,
  attachments: (memory_id: string) => [...memoryKeys.all, memory_id, 'attachments'] as const,
};

/**
 * Fetch memories attached to a specific work item.
 *
 * @param work_item_id - The work item UUID
 * @returns TanStack Query result with `WorkItemMemoriesResponse`
 */
export function useWorkItemMemories(work_item_id: string) {
  return useQuery({
    queryKey: memoryKeys.forWorkItem(work_item_id),
    queryFn: ({ signal }) => apiClient.get<WorkItemMemoriesResponse>(`/api/work-items/${work_item_id}/memories`, { signal }),
    enabled: !!work_item_id,
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
 * @param project_id - The project UUID
 * @returns TanStack Query result with `MemoryListResponse`
 */
export function useProjectMemories(project_id: string) {
  return useQuery({
    queryKey: memoryKeys.forProject(project_id),
    queryFn: ({ signal }) => apiClient.get<MemoryListResponse>(`/api/projects/${project_id}/memories`, { signal }),
    enabled: !!project_id,
  });
}

/**
 * Fetch file attachments for a specific memory (Issue #1271).
 *
 * @param memory_id - The memory UUID
 * @returns TanStack Query result with `MemoryAttachmentsResponse`
 */
export function useMemoryAttachments(memory_id: string) {
  return useQuery({
    queryKey: memoryKeys.attachments(memory_id),
    queryFn: ({ signal }) => apiClient.get<MemoryAttachmentsResponse>(`/api/memories/${memory_id}/attachments`, { signal }),
    enabled: !!memory_id,
  });
}
