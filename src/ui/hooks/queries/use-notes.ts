/**
 * TanStack Query hooks for notes data fetching.
 *
 * Provides cached, deduplicated queries for notes, versions, and shares.
 * Includes staleTime configuration to reduce unnecessary refetching.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  NotesResponse,
  Note,
  ListNotesParams,
  NoteVersionsResponse,
  NoteVersion,
  CompareVersionsResponse,
  NoteSharesResponse,
  SharedWithMeResponse,
} from '@/ui/lib/api-types.ts';

/**
 * Stale time constants for notes queries.
 * These values balance freshness with network efficiency.
 */
export const NOTE_STALE_TIMES = {
  /** List queries - refreshed more frequently (10 seconds). */
  list: 10 * 1000,
  /** Detail queries - moderate freshness (30 seconds). */
  detail: 30 * 1000,
  /** Version history - rarely changes after creation (5 minutes). */
  versions: 5 * 60 * 1000,
  /** Individual version - immutable, long cache (10 minutes). */
  version: 10 * 60 * 1000,
  /** Version comparison - computed from immutable data (10 minutes). */
  versionCompare: 10 * 60 * 1000,
  /** Shares - moderate freshness (30 seconds). */
  shares: 30 * 1000,
  /** Shared with me - moderate freshness (30 seconds). */
  sharedWithMe: 30 * 1000,
} as const;

/** Query key factory for notes. */
export const noteKeys = {
  all: ['notes'] as const,
  lists: () => [...noteKeys.all, 'list'] as const,
  list: (params?: ListNotesParams) => [...noteKeys.lists(), params] as const,
  details: () => [...noteKeys.all, 'detail'] as const,
  detail: (id: string) => [...noteKeys.details(), id] as const,
  versions: (id: string) => [...noteKeys.all, 'versions', id] as const,
  version: (id: string, versionNumber: number) =>
    [...noteKeys.versions(id), versionNumber] as const,
  versionCompare: (id: string, from: number, to: number) =>
    [...noteKeys.versions(id), 'compare', from, to] as const,
  shares: (id: string) => [...noteKeys.all, 'shares', id] as const,
  sharedWithMe: () => [...noteKeys.all, 'shared-with-me'] as const,
};

/**
 * Build query string from ListNotesParams.
 */
function buildNotesQueryString(params?: ListNotesParams): string {
  if (!params) return '';

  const searchParams = new URLSearchParams();

  if (params.notebookId) {
    searchParams.set('notebookId', params.notebookId);
  }
  if (params.tags && params.tags.length > 0) {
    params.tags.forEach((tag) => searchParams.append('tags', tag));
  }
  if (params.visibility) {
    searchParams.set('visibility', params.visibility);
  }
  if (params.search) {
    searchParams.set('search', params.search);
  }
  if (params.isPinned !== undefined) {
    searchParams.set('isPinned', String(params.isPinned));
  }
  if (params.includeDeleted) {
    searchParams.set('includeDeleted', 'true');
  }
  if (params.limit !== undefined) {
    searchParams.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set('offset', String(params.offset));
  }
  if (params.sortBy) {
    searchParams.set('sortBy', params.sortBy);
  }
  if (params.sortOrder) {
    searchParams.set('sortOrder', params.sortOrder);
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Fetch list of notes with optional filters.
 *
 * @param params - Optional filter/pagination params
 * @returns TanStack Query result with `NotesResponse`
 */
export function useNotes(params?: ListNotesParams) {
  const queryString = buildNotesQueryString(params);

  return useQuery({
    queryKey: noteKeys.list(params),
    queryFn: ({ signal }) =>
      apiClient.get<NotesResponse>(`/api/notes${queryString}`, { signal }),
    staleTime: NOTE_STALE_TIMES.list,
  });
}

/**
 * Fetch a single note by ID.
 *
 * @param id - Note UUID
 * @returns TanStack Query result with `Note`
 */
export function useNote(id: string) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: ({ signal }) =>
      apiClient.get<Note>(`/api/notes/${encodeURIComponent(id)}`, { signal }),
    enabled: !!id,
    staleTime: NOTE_STALE_TIMES.detail,
  });
}

/**
 * Fetch version history for a note.
 *
 * @param id - Note UUID
 * @param options - Optional pagination
 * @returns TanStack Query result with `NoteVersionsResponse`
 */
export function useNoteVersions(
  id: string,
  options?: { limit?: number; offset?: number }
) {
  const searchParams = new URLSearchParams();
  if (options?.limit !== undefined) {
    searchParams.set('limit', String(options.limit));
  }
  if (options?.offset !== undefined) {
    searchParams.set('offset', String(options.offset));
  }
  const queryString = searchParams.toString();

  return useQuery({
    queryKey: noteKeys.versions(id),
    queryFn: ({ signal }) =>
      apiClient.get<NoteVersionsResponse>(
        `/api/notes/${encodeURIComponent(id)}/versions${queryString ? `?${queryString}` : ''}`,
        { signal }
      ),
    enabled: !!id,
    staleTime: NOTE_STALE_TIMES.versions,
  });
}

/**
 * Fetch a specific version of a note.
 *
 * @param id - Note UUID
 * @param versionNumber - Version number to fetch
 * @returns TanStack Query result with `NoteVersion`
 */
export function useNoteVersion(id: string, versionNumber: number) {
  return useQuery({
    queryKey: noteKeys.version(id, versionNumber),
    queryFn: ({ signal }) =>
      apiClient.get<NoteVersion>(
        `/api/notes/${encodeURIComponent(id)}/versions/${versionNumber}`,
        { signal }
      ),
    enabled: !!id && versionNumber > 0,
    staleTime: NOTE_STALE_TIMES.version,
  });
}

/**
 * Compare two versions of a note.
 *
 * @param id - Note UUID
 * @param from - From version number
 * @param to - To version number
 * @returns TanStack Query result with `CompareVersionsResponse`
 */
export function useNoteVersionCompare(id: string, from: number, to: number) {
  return useQuery({
    queryKey: noteKeys.versionCompare(id, from, to),
    queryFn: ({ signal }) =>
      apiClient.get<CompareVersionsResponse>(
        `/api/notes/${encodeURIComponent(id)}/versions/compare?from=${from}&to=${to}`,
        { signal }
      ),
    enabled: !!id && from > 0 && to > 0 && from !== to,
    staleTime: NOTE_STALE_TIMES.versionCompare,
  });
}

/**
 * Fetch shares for a note.
 *
 * @param id - Note UUID
 * @returns TanStack Query result with `NoteSharesResponse`
 */
export function useNoteShares(id: string) {
  return useQuery({
    queryKey: noteKeys.shares(id),
    queryFn: ({ signal }) =>
      apiClient.get<NoteSharesResponse>(
        `/api/notes/${encodeURIComponent(id)}/shares`,
        { signal }
      ),
    enabled: !!id,
    staleTime: NOTE_STALE_TIMES.shares,
  });
}

/**
 * Fetch notes shared with the current user.
 *
 * @returns TanStack Query result with `SharedWithMeResponse`
 */
export function useNotesSharedWithMe() {
  return useQuery({
    queryKey: noteKeys.sharedWithMe(),
    queryFn: ({ signal }) =>
      apiClient.get<SharedWithMeResponse>('/api/notes/shared-with-me', {
        signal,
      }),
    staleTime: NOTE_STALE_TIMES.sharedWithMe,
  });
}
