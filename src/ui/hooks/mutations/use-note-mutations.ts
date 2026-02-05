/**
 * TanStack Query mutation hooks for notes.
 *
 * Provides mutations for creating, updating, deleting, and restoring notes.
 * Includes optimized cache invalidation for related queries.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  Note,
  CreateNoteBody,
  UpdateNoteBody,
  RestoreVersionResponse,
} from '@/ui/lib/api-types.ts';
import { noteKeys } from '@/ui/hooks/queries/use-notes.ts';
import { notebookKeys } from '@/ui/hooks/queries/use-notebooks.ts';

/**
 * Create a new note.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useCreateNote();
 * mutate({ title: 'New note', content: '# Hello' });
 * ```
 */
export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateNoteBody) =>
      apiClient.post<Note>('/api/notes', body),

    onSuccess: (note) => {
      // Invalidate notes list queries
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });

      // If note has a notebook, invalidate tree (for note counts)
      if (note.notebookId) {
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },
  });
}

/**
 * Update an existing note.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useUpdateNote();
 * mutate({ id: 'note-123', body: { title: 'Updated title' } });
 * ```
 */
export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNoteBody }) =>
      apiClient.put<Note>(`/api/notes/${encodeURIComponent(id)}`, body),

    onSuccess: (note, { id }) => {
      // Invalidate the specific note detail
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });

      // Invalidate notes list queries (title/content may affect sorting/filtering)
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });

      // Only invalidate versions if content changed
      // (we can't know this for certain, so always invalidate to be safe)
      queryClient.invalidateQueries({ queryKey: noteKeys.versions(id) });

      // If notebook assignment changed, tree needs update for note counts
      if (note.notebookId) {
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },
  });
}

/**
 * Soft delete a note.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useDeleteNote();
 * mutate('note-123');
 * ```
 */
export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/api/notes/${encodeURIComponent(id)}`),

    onSuccess: (_, id) => {
      // Invalidate the specific note detail
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });

      // Invalidate notes list queries
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });

      // Invalidate notebook tree (for note counts) - lists don't need update
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
    },
  });
}

/**
 * Restore a soft-deleted note.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useRestoreNote();
 * mutate('note-123');
 * ```
 */
export function useRestoreNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Note>(
        `/api/notes/${encodeURIComponent(id)}/restore`,
        {}
      ),

    onSuccess: (note, id) => {
      // Invalidate the specific note detail
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });

      // Invalidate notes list queries
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });

      // If note has a notebook, invalidate tree for note counts
      if (note.notebookId) {
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },
  });
}

/**
 * Restore a note to a previous version.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useRestoreNoteVersion();
 * mutate({ id: 'note-123', versionNumber: 5 });
 * ```
 */
export function useRestoreNoteVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, versionNumber }: { id: string; versionNumber: number }) =>
      apiClient.post<RestoreVersionResponse>(
        `/api/notes/${encodeURIComponent(id)}/versions/${versionNumber}/restore`,
        {}
      ),

    onSuccess: (_, { id }) => {
      // Invalidate note detail and versions
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.versions(id) });

      // Invalidate notes list queries (content/title may have changed)
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },
  });
}
