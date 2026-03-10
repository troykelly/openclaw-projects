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
import {
  memoryListResponseSchema,
  memorySearchResponseSchema,
  memorySimilarResponseSchema,
  workItemMemoriesResponseSchema,
} from '@/ui/lib/api-schemas.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';
import type {
  ContactMemoriesResponse,
  Memory,
  MemoryAttachmentsResponse,
  MemoryLinkedContactsResponse,
  MemoryListResponse,
  MemorySearchResponse,
  ProjectMemoriesResponse,
  RelatedMemoriesResponse,
  SimilarMemoriesResponse,
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
  const queryKey = useNamespaceQueryKey(memoryKeys.forWorkItem(work_item_id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<WorkItemMemoriesResponse>(`/work-items/${work_item_id}/memories`, { signal, schema: workItemMemoriesResponseSchema }),
    enabled: !!work_item_id,
  });
}

/**
 * Fetch the global memory list.
 *
 * @returns TanStack Query result with `MemoryListResponse`
 */
export function useMemories() {
  const queryKey = useNamespaceQueryKey(memoryKeys.list());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<MemoryListResponse>('/memory', { signal, schema: memoryListResponseSchema }),
  });
}

/**
 * Fetch a single memory by ID.
 *
 * @param id - The memory UUID
 * @returns TanStack Query result with `Memory`
 */
export function useMemoryDetail(id: string) {
  const queryKey = useNamespaceQueryKey(memoryKeys.detail(id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<Memory>(`/memories/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Fetch memories scoped to a specific project.
 *
 * @param project_id - The project UUID
 * @returns TanStack Query result with `ProjectMemoriesResponse`
 */
export function useProjectMemories(project_id: string) {
  const queryKey = useNamespaceQueryKey(memoryKeys.forProject(project_id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<ProjectMemoriesResponse>(`/projects/${project_id}/memories`, { signal }),
    enabled: !!project_id,
  });
}

/**
 * Fetch memories linked to a specific contact (Issue #1723).
 *
 * @param contact_id - The contact UUID
 * @returns TanStack Query result with `ContactMemoriesResponse`
 */
export function useContactMemories(contact_id: string) {
  const queryKey = useNamespaceQueryKey(memoryKeys.forContact(contact_id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<ContactMemoriesResponse>(`/contacts/${contact_id}/memories`, { signal }),
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
  const queryKey = useNamespaceQueryKey(memoryKeys.attachments(memory_id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<MemoryAttachmentsResponse>(`/memories/${memory_id}/attachments`, { signal }),
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
  const queryKey = useNamespaceQueryKey(memoryKeys.contacts(memory_id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<MemoryLinkedContactsResponse>(`/memories/${memory_id}/contacts`, { signal }),
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
  const queryKey = useNamespaceQueryKey(memoryKeys.related(memory_id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<RelatedMemoriesResponse>(`/memories/${memory_id}/related`, { signal }),
    enabled: !!memory_id,
  });
}

/**
 * Find similar memories using vector similarity (Issue #1724).
 *
 * @param memory_id - The memory UUID
 * @returns TanStack Query result with `SimilarMemoriesResponse`
 */
export function useSimilarMemories(memory_id: string) {
  const queryKey = useNamespaceQueryKey(memoryKeys.similar(memory_id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SimilarMemoriesResponse>(`/memories/${memory_id}/similar`, { signal, schema: memorySimilarResponseSchema }),
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
  const queryKey = useNamespaceQueryKey(memoryKeys.search(query, params));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<MemorySearchResponse>(`/memories/search?${searchParams.toString()}`, { signal, schema: memorySearchResponseSchema }),
    enabled: query.length >= 2,
  });
}
