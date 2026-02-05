/**
 * TanStack Query hooks for notebooks data fetching.
 *
 * Provides cached, deduplicated queries for notebooks and their tree structure.
 * Queries are configured with appropriate staleTime to reduce unnecessary
 * refetching while keeping data reasonably fresh.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

/** Default stale time for notebook queries (5 minutes) */
const NOTEBOOK_STALE_TIME = 5 * 60 * 1000;

/** Stale time for notebook lists (1 minute - changes infrequently) */
const NOTEBOOK_LIST_STALE_TIME = 60 * 1000;

/** Stale time for notebook tree (1 minute - tree structure changes infrequently) */
const NOTEBOOK_TREE_STALE_TIME = 60 * 1000;

/** Stale time for notebook shares (1 minute) */
const NOTEBOOK_SHARES_STALE_TIME = 60 * 1000;
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
 * @param options - Optional query options (e.g., enabled, staleTime)
 * @returns TanStack Query result with `NotebooksResponse`
 */
export function useNotebooks(
  params?: ListNotebooksParams,
  options?: { enabled?: boolean; staleTime?: number }
) {
  const queryString = buildNotebooksQueryString(params);

  return useQuery({
    queryKey: notebookKeys.list(params),
    queryFn: ({ signal }) =>
      apiClient.get<NotebooksResponse>(`/api/notebooks${queryString}`, {
        signal,
      }),
    enabled: options?.enabled,
    staleTime: options?.staleTime ?? NOTEBOOK_LIST_STALE_TIME,
  });
}

/**
 * Fetch a single notebook by ID.
 *
 * @param id - Notebook UUID
 * @param options - Optional includes (notes, children) and staleTime
 * @returns TanStack Query result with `Notebook`
 */
export function useNotebook(
  id: string,
  options?: {
    includeNotes?: boolean;
    includeChildren?: boolean;
    staleTime?: number;
  }
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
    staleTime: options?.staleTime ?? NOTEBOOK_STALE_TIME,
  });
}

/**
 * Fetch notebooks as a tree structure.
 *
 * @param includeNoteCounts - Whether to include note counts
 * @param options - Optional query options
 * @returns TanStack Query result with array of `NotebookTreeNode`
 */
export function useNotebooksTree(
  includeNoteCounts = false,
  options?: { staleTime?: number }
) {
  const queryString = includeNoteCounts ? '?includeNoteCounts=true' : '';

  return useQuery({
    queryKey: notebookKeys.tree(),
    queryFn: ({ signal }) =>
      apiClient.get<NotebookTreeNode[]>(`/api/notebooks/tree${queryString}`, {
        signal,
      }),
    staleTime: options?.staleTime ?? NOTEBOOK_TREE_STALE_TIME,
  });
}

/**
 * Fetch shares for a notebook.
 *
 * @param id - Notebook UUID
 * @param options - Optional query options
 * @returns TanStack Query result with shares
 */
export function useNotebookShares(
  id: string,
  options?: { staleTime?: number }
) {
  return useQuery({
    queryKey: notebookKeys.shares(id),
    queryFn: ({ signal }) =>
      apiClient.get<{ notebookId: string; shares: unknown[] }>(
        `/api/notebooks/${encodeURIComponent(id)}/shares`,
        { signal }
      ),
    enabled: !!id,
    staleTime: options?.staleTime ?? NOTEBOOK_SHARES_STALE_TIME,
  });
}

/**
 * Fetch notebooks shared with the current user.
 *
 * @param options - Optional query options
 * @returns TanStack Query result with `SharedWithMeResponse`
 */
export function useNotebooksSharedWithMe(options?: { staleTime?: number }) {
  return useQuery({
    queryKey: notebookKeys.sharedWithMe(),
    queryFn: ({ signal }) =>
      apiClient.get<SharedWithMeResponse>('/api/notebooks/shared-with-me', {
        signal,
      }),
    staleTime: options?.staleTime ?? NOTEBOOK_SHARES_STALE_TIME,
  });
}
