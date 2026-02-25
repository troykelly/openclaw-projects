/**
 * TanStack Query hooks for memories.
 *
 * Provides queries for work-item-scoped memories, project-scoped memories,
 * global memory lists, semantic search, and memory detail.
 * Project scope added in Issue #1273.
 * Semantic search added in Issue #1716.
 * Detail, contacts, related, attachments added in Issues #1723-#1732.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  Memory,
  MemoryAttachmentsResponse,
  MemoryLinkedContactsResponse,
  MemoryListResponse,
  MemorySearchResponse,
  RelatedMemoriesResponse,
  WorkItemMemoriesResponse,
} from '@/ui/lib/api-types.ts';

/** Query key factory for memories. */
export const memoryKeys = {
  all: ['memories'] as const,
  lists: () => [...memoryKeys.all, 'list'] as const,
  list: () => [...memoryKeys.lists()] as const,
  detail: (id: string) => [...memoryKeys.all, 'detail', id] as const,
  forWorkItem: (work_item_id: string) => [...memoryKeys.all, 'work-item', work_item_id] as const,
  forProject: (project_id: string) => [...memoryKeys.all, 'project', project_id] as const,
  forContact: (contact_id: string) => [...memoryKeys.all, 'contact', contact_id] as const,
  attachments: (memory_id: string) => [...memoryKeys.all, memory_id, 'attachments'] as const,
  contacts: (memory_id: string) => [...memoryKeys.all, memory_id, 'contacts'] as const,
  related: (memory_id: string) => [...memoryKeys.all, memory_id, 'related'] as const,
  similar: (memory_id: string) => [...memoryKeys.all, memory_id, 'similar'] as const,
  search: (query: string, params?: Record<string, string>) => [...memoryKeys.all, 'search', query, params] as const,
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
 * Fetch a single memory by ID.
 *
 * @param id - The memory UUID
 * @returns TanStack Query result with `Memory`
 */
export function useMemoryDetail(id: string) {
  return useQuery({
    queryKey: memoryKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<Memory>(`/api/memories/${id}`, { signal }),
    enabled: !!id,
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
 * Fetch memories linked to a specific contact (Issue #1723).
 *
 * @param contact_id - The contact UUID
 * @returns TanStack Query result with `MemoryListResponse`
 */
export function useContactMemories(contact_id: string) {
  return useQuery({
    queryKey: memoryKeys.forContact(contact_id),
    queryFn: ({ signal }) => apiClient.get<MemoryListResponse>(`/api/contacts/${contact_id}/memories`, { signal }),
    enabled: !!contact_id,
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

/**
 * Fetch linked contacts for a specific memory (Issue #1723).
 *
 * @param memory_id - The memory UUID
 * @returns TanStack Query result with `MemoryLinkedContactsResponse`
 */
export function useMemoryContacts(memory_id: string) {
  return useQuery({
    queryKey: memoryKeys.contacts(memory_id),
    queryFn: ({ signal }) => apiClient.get<MemoryLinkedContactsResponse>(`/api/memories/${memory_id}/contacts`, { signal }),
    enabled: !!memory_id,
  });
}

/**
 * Fetch related memories (Issue #1724).
 *
 * @param memory_id - The memory UUID
 * @returns TanStack Query result with `RelatedMemoriesResponse`
 */
export function useRelatedMemories(memory_id: string) {
  return useQuery({
    queryKey: memoryKeys.related(memory_id),
    queryFn: ({ signal }) => apiClient.get<RelatedMemoriesResponse>(`/api/memories/${memory_id}/related`, { signal }),
    enabled: !!memory_id,
  });
}

/**
 * Find similar memories using vector similarity (Issue #1724).
 *
 * @param memory_id - The memory UUID
 * @returns TanStack Query result with `MemorySearchResponse`
 */
export function useSimilarMemories(memory_id: string) {
  return useQuery({
    queryKey: memoryKeys.similar(memory_id),
    queryFn: ({ signal }) => apiClient.get<MemorySearchResponse>(`/api/memories/${memory_id}/similar`, { signal }),
    enabled: !!memory_id,
  });
}

/**
 * Semantic search for memories (Issue #1716).
 *
 * @param query - Search query text
 * @param params - Additional filter params (memory_type, tags, since, before, period)
 * @returns TanStack Query result with `MemorySearchResponse`
 */
export function useMemorySearch(query: string, params?: Record<string, string>) {
  const searchParams = new URLSearchParams({ q: query, ...params });
  return useQuery({
    queryKey: memoryKeys.search(query, params),
    queryFn: ({ signal }) => apiClient.get<MemorySearchResponse>(`/api/memories/search?${searchParams.toString()}`, { signal }),
    enabled: query.length >= 2,
  });
}
