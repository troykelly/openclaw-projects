/**
 * TanStack Query hooks for notebooks data fetching.
 *
 * Provides cached, deduplicated queries for notebooks and their tree structure.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  NotebooksResponse,
  Notebook,
  ListNotebooksParams,
  NotebookTreeNode,
  SharedWithMeResponse,
} from '@/ui/lib/api-types.ts';

/** Query key factory for notebooks. */
export const notebookKeys = {
  all: ['notebooks'] as const,
  lists: () => [...notebookKeys.all, 'list'] as const,
  list: (params?: ListNotebooksParams) => [...notebookKeys.lists(), params] as const,
  details: () => [...notebookKeys.all, 'detail'] as const,
  detail: (id: string) => [...notebookKeys.details(), id] as const,
  tree: () => [...notebookKeys.all, 'tree'] as const,
  shares: (id: string) => [...notebookKeys.all, 'shares', id] as const,
  sharedWithMe: () => [...notebookKeys.all, 'shared-with-me'] as const,
};

/**
 * Build query string from ListNotebooksParams.
 */
function buildNotebooksQueryString(params?: ListNotebooksParams): string {
  if (!params) return '';

  const searchParams = new URLSearchParams();

  if (params.parentId !== undefined) {
    searchParams.set('parentId', params.parentId ?? 'null');
  }
  if (params.includeArchived) {
    searchParams.set('includeArchived', 'true');
  }
  if (params.includeNoteCounts !== undefined) {
    searchParams.set('includeNoteCounts', String(params.includeNoteCounts));
  }
  if (params.includeChildCounts !== undefined) {
    searchParams.set('includeChildCounts', String(params.includeChildCounts));
  }
  if (params.limit !== undefined) {
    searchParams.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set('offset', String(params.offset));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Fetch list of notebooks with optional filters.
 *
 * @param params - Optional filter/pagination params
 * @returns TanStack Query result with `NotebooksResponse`
 */
export function useNotebooks(params?: ListNotebooksParams) {
  const queryString = buildNotebooksQueryString(params);

  return useQuery({
    queryKey: notebookKeys.list(params),
    queryFn: ({ signal }) =>
      apiClient.get<NotebooksResponse>(`/api/notebooks${queryString}`, { signal }),
  });
}

/**
 * Fetch a single notebook by ID.
 *
 * @param id - Notebook UUID
 * @param options - Optional includes (notes, children)
 * @returns TanStack Query result with `Notebook`
 */
export function useNotebook(
  id: string,
  options?: { includeNotes?: boolean; includeChildren?: boolean }
) {
  const searchParams = new URLSearchParams();
  if (options?.includeNotes) {
    searchParams.set('includeNotes', 'true');
  }
  if (options?.includeChildren) {
    searchParams.set('includeChildren', 'true');
  }
  const queryString = searchParams.toString();

  return useQuery({
    queryKey: notebookKeys.detail(id),
    queryFn: ({ signal }) =>
      apiClient.get<Notebook>(
        `/api/notebooks/${encodeURIComponent(id)}${queryString ? `?${queryString}` : ''}`,
        { signal }
      ),
    enabled: !!id,
  });
}

/**
 * Fetch notebooks as a tree structure.
 *
 * @param includeNoteCounts - Whether to include note counts
 * @returns TanStack Query result with array of `NotebookTreeNode`
 */
export function useNotebooksTree(includeNoteCounts = false) {
  const queryString = includeNoteCounts ? '?includeNoteCounts=true' : '';

  return useQuery({
    queryKey: notebookKeys.tree(),
    queryFn: ({ signal }) =>
      apiClient.get<NotebookTreeNode[]>(`/api/notebooks/tree${queryString}`, {
        signal,
      }),
  });
}

/**
 * Fetch shares for a notebook.
 *
 * @param id - Notebook UUID
 * @returns TanStack Query result with shares
 */
export function useNotebookShares(id: string) {
  return useQuery({
    queryKey: notebookKeys.shares(id),
    queryFn: ({ signal }) =>
      apiClient.get<{ notebookId: string; shares: unknown[] }>(
        `/api/notebooks/${encodeURIComponent(id)}/shares`,
        { signal }
      ),
    enabled: !!id,
  });
}

/**
 * Fetch notebooks shared with the current user.
 *
 * @returns TanStack Query result with `SharedWithMeResponse`
 */
export function useNotebooksSharedWithMe() {
  return useQuery({
    queryKey: notebookKeys.sharedWithMe(),
    queryFn: ({ signal }) =>
      apiClient.get<SharedWithMeResponse>('/api/notebooks/shared-with-me', {
        signal,
      }),
  });
}
