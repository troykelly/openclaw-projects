/**
 * TanStack Query hooks for notes data fetching.
 *
 * Provides cached, deduplicated queries for notes, versions, and shares.
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
  });
}
