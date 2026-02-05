/**
 * TanStack Query hooks for notes data fetching.
 *
 * Provides cached, deduplicated queries for notes, versions, and shares.
 * Queries are configured with appropriate staleTime to reduce unnecessary
 * refetching while keeping data reasonably fresh.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

/** Default stale time for note queries (5 minutes) */
const NOTE_STALE_TIME = 5 * 60 * 1000;

/** Stale time for note lists (30 seconds - changes more frequently) */
const NOTE_LIST_STALE_TIME = 30 * 1000;

/** Stale time for note versions (5 minutes - rarely changes except on update) */
const NOTE_VERSIONS_STALE_TIME = 5 * 60 * 1000;

/** Stale time for note shares (1 minute) */
const NOTE_SHARES_STALE_TIME = 60 * 1000;
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
 * @param options - Optional query options (e.g., enabled, staleTime)
 * @returns TanStack Query result with `NotesResponse`
 */
export function useNotes(
  params?: ListNotesParams,
  options?: { enabled?: boolean; staleTime?: number }
) {
  const queryString = buildNotesQueryString(params);

  return useQuery({
    queryKey: noteKeys.list(params),
    queryFn: ({ signal }) =>
      apiClient.get<NotesResponse>(`/api/notes${queryString}`, { signal }),
    enabled: options?.enabled,
    staleTime: options?.staleTime ?? NOTE_LIST_STALE_TIME,
  });
}

/**
 * Fetch a single note by ID.
 *
 * @param id - Note UUID
 * @param options - Optional query options (e.g., staleTime)
 * @returns TanStack Query result with `Note`
 */
export function useNote(id: string, options?: { staleTime?: number }) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: ({ signal }) =>
      apiClient.get<Note>(`/api/notes/${encodeURIComponent(id)}`, { signal }),
    enabled: !!id,
    staleTime: options?.staleTime ?? NOTE_STALE_TIME,
  });
}

/**
 * Fetch version history for a note.
 *
 * @param id - Note UUID
 * @param options - Optional pagination and staleTime
 * @returns TanStack Query result with `NoteVersionsResponse`
 */
export function useNoteVersions(
  id: string,
  options?: { limit?: number; offset?: number; staleTime?: number }
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
    staleTime: options?.staleTime ?? NOTE_VERSIONS_STALE_TIME,
  });
}

/**
 * Fetch a specific version of a note.
 *
 * @param id - Note UUID
 * @param versionNumber - Version number to fetch
 * @param options - Optional query options
 * @returns TanStack Query result with `NoteVersion`
 */
export function useNoteVersion(
  id: string,
  versionNumber: number,
  options?: { staleTime?: number }
) {
  return useQuery({
    queryKey: noteKeys.version(id, versionNumber),
    queryFn: ({ signal }) =>
      apiClient.get<NoteVersion>(
        `/api/notes/${encodeURIComponent(id)}/versions/${versionNumber}`,
        { signal }
      ),
    enabled: !!id && versionNumber > 0,
    // Individual versions are immutable, so they can be cached indefinitely
    staleTime: options?.staleTime ?? Infinity,
  });
}

/**
 * Compare two versions of a note.
 *
 * @param id - Note UUID
 * @param from - From version number
 * @param to - To version number
 * @param options - Optional query options
 * @returns TanStack Query result with `CompareVersionsResponse`
 */
export function useNoteVersionCompare(
  id: string,
  from: number,
  to: number,
  options?: { staleTime?: number }
) {
  return useQuery({
    queryKey: noteKeys.versionCompare(id, from, to),
    queryFn: ({ signal }) =>
      apiClient.get<CompareVersionsResponse>(
        `/api/notes/${encodeURIComponent(id)}/versions/compare?from=${from}&to=${to}`,
        { signal }
      ),
    enabled: !!id && from > 0 && to > 0 && from !== to,
    // Version comparisons are deterministic, can be cached indefinitely
    staleTime: options?.staleTime ?? Infinity,
  });
}

/**
 * Fetch shares for a note.
 *
 * @param id - Note UUID
 * @param options - Optional query options
 * @returns TanStack Query result with `NoteSharesResponse`
 */
export function useNoteShares(id: string, options?: { staleTime?: number }) {
  return useQuery({
    queryKey: noteKeys.shares(id),
    queryFn: ({ signal }) =>
      apiClient.get<NoteSharesResponse>(
        `/api/notes/${encodeURIComponent(id)}/shares`,
        { signal }
      ),
    enabled: !!id,
    staleTime: options?.staleTime ?? NOTE_SHARES_STALE_TIME,
  });
}

/**
 * Fetch notes shared with the current user.
 *
 * @param options - Optional query options
 * @returns TanStack Query result with `SharedWithMeResponse`
 */
export function useNotesSharedWithMe(options?: { staleTime?: number }) {
  return useQuery({
    queryKey: noteKeys.sharedWithMe(),
    queryFn: ({ signal }) =>
      apiClient.get<SharedWithMeResponse>('/api/notes/shared-with-me', {
        signal,
      }),
    staleTime: options?.staleTime ?? NOTE_SHARES_STALE_TIME,
  });
}
