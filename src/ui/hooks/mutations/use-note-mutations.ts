/**
 * TanStack Query mutation hooks for notes.
 *
 * Provides mutations for creating, updating, deleting, and restoring notes.
 * All mutations automatically invalidate relevant cached queries on success.
 * Mutations include optimistic updates for better UX and proper error handling.
 *
 * @module use-note-mutations
 *
 * @example Error handling
 * ```ts
 * import { ApiRequestError } from '@/ui/lib/api-client';
 *
 * const { mutate, error } = useCreateNote();
 *
 * mutate(
 *   { title: 'New note' },
 *   {
 *     onError: (error) => {
 *       if (error instanceof ApiRequestError) {
 *         console.error(`API error ${error.status}: ${error.message}`);
 *       }
 *     },
 *   }
 * );
 * ```
 *
 * @example Optimistic updates
 * ```ts
 * const { mutate } = useUpdateNote();
 *
 * // Update is applied immediately to the UI, then synced with server
 * mutate({ id: 'note-123', body: { title: 'New Title' } });
 * // If server rejects, UI automatically rolls back
 * ```
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ApiRequestError } from '@/ui/lib/api-client.ts';
import type {
  Note,
  NotesResponse,
  CreateNoteBody,
  UpdateNoteBody,
  RestoreVersionResponse,
} from '@/ui/lib/api-types.ts';
import { noteKeys } from '@/ui/hooks/queries/use-notes.ts';
import { notebookKeys } from '@/ui/hooks/queries/use-notebooks.ts';

/**
 * Variables for the updateNote mutation.
 */
export interface UpdateNoteVariables {
  /** The note ID to update. */
  id: string;
  /** The fields to update. */
  body: UpdateNoteBody;
}

/**
 * Variables for the restoreNoteVersion mutation.
 */
export interface RestoreNoteVersionVariables {
  /** The note ID to restore. */
  id: string;
  /** The version number to restore to. */
  versionNumber: number;
}

/**
 * Create a new note.
 *
 * On success, invalidates:
 * - All note list queries
 * - Notebook detail and tree queries (if note is in a notebook)
 *
 * @returns TanStack mutation result with:
 *   - `mutate(body)` - Trigger the mutation
 *   - `mutateAsync(body)` - Trigger and return a Promise
 *   - `data` - The created {@link Note} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *   - `isSuccess` / `isError` - Result states
 *
 * @example Basic usage
 * ```ts
 * const { mutate, isPending } = useCreateNote();
 *
 * mutate({ title: 'My Note', content: '# Hello World' });
 * ```
 *
 * @example With callbacks
 * ```ts
 * const { mutate } = useCreateNote();
 *
 * mutate(
 *   { title: 'My Note', notebookId: 'notebook-123' },
 *   {
 *     onSuccess: (note) => {
 *       navigate(`/notes/${note.id}`);
 *     },
 *     onError: (error) => {
 *       toast.error(error.message);
 *     },
 *   }
 * );
 * ```
 *
 * @example Async/await
 * ```ts
 * const { mutateAsync } = useCreateNote();
 *
 * try {
 *   const note = await mutateAsync({ title: 'My Note' });
 *   console.log('Created:', note.id);
 * } catch (error) {
 *   // Handle ApiRequestError
 * }
 * ```
 */
export function useCreateNote(): UseMutationResult<
  Note,
  ApiRequestError,
  CreateNoteBody
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateNoteBody) =>
      apiClient.post<Note>('/api/notes', body),

    onSuccess: (note) => {
      // Invalidate notes list queries
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });

      // If note has a notebook, invalidate notebook tree (includes detail)
      if (note.notebookId) {
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },

    onError: (error) => {
      // Log error for debugging - consumers can add their own onError handlers
      console.error('[useCreateNote] Failed to create note:', error.message);
    },
  });
}

/**
 * Update an existing note.
 *
 * On success, invalidates:
 * - The specific note detail query
 * - All note list queries
 * - Note versions queries
 * - Notebook detail and tree queries (if note is in a notebook)
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ id, body })` - Trigger the mutation
 *   - `mutateAsync({ id, body })` - Trigger and return a Promise
 *   - `data` - The updated {@link Note} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useUpdateNote();
 *
 * mutate({ id: 'note-123', body: { title: 'Updated Title' } });
 * ```
 *
 * @example Updating content
 * ```ts
 * const { mutate, isPending } = useUpdateNote();
 *
 * mutate(
 *   { id: noteId, body: { content: newMarkdown } },
 *   {
 *     onSuccess: () => toast.success('Saved'),
 *     onError: (error) => toast.error(`Save failed: ${error.message}`),
 *   }
 * );
 * ```
 *
 * @example Moving to a notebook
 * ```ts
 * mutate({ id: 'note-123', body: { notebookId: 'notebook-456' } });
 * ```
 */
export function useUpdateNote(): UseMutationResult<
  Note,
  ApiRequestError,
  UpdateNoteVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: UpdateNoteVariables) =>
      apiClient.put<Note>(`/api/notes/${encodeURIComponent(id)}`, body),

    onMutate: async ({ id, body }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: noteKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() });

      // Snapshot previous values for rollback
      const previousNote = queryClient.getQueryData<Note>(noteKeys.detail(id));
      const previousLists = queryClient.getQueriesData<NotesResponse>({
        queryKey: noteKeys.lists(),
      });

      // Optimistically update the note detail
      if (previousNote) {
        queryClient.setQueryData<Note>(noteKeys.detail(id), {
          ...previousNote,
          ...body,
          updatedAt: new Date().toISOString(),
        });
      }

      // Optimistically update the note in all list queries
      previousLists.forEach(([queryKey, data]) => {
        if (data) {
          queryClient.setQueryData<NotesResponse>(queryKey, {
            ...data,
            notes: data.notes.map((note) =>
              note.id === id
                ? { ...note, ...body, updatedAt: new Date().toISOString() }
                : note
            ),
          });
        }
      });

      return { previousNote, previousLists };
    },

    onError: (error, { id }, context) => {
      // Roll back on error
      if (context?.previousNote) {
        queryClient.setQueryData(noteKeys.detail(id), context.previousNote);
      }
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error('[useUpdateNote] Failed to update note:', error.message);
    },

    onSettled: (note, _error, { id }) => {
      // Always refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: noteKeys.versions(id) });

      // If note has a notebook, invalidate notebook tree
      if (note?.notebookId) {
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },
  });
}

/**
 * Soft delete a note.
 *
 * Notes are soft-deleted (marked as deleted but not removed from the database).
 * Use {@link useRestoreNote} to restore a deleted note.
 *
 * On success, invalidates:
 * - The specific note detail query
 * - All note list queries
 * - Notebook tree and list queries (for note counts)
 *
 * @returns TanStack mutation result with:
 *   - `mutate(id)` - Trigger the mutation with note ID
 *   - `mutateAsync(id)` - Trigger and return a Promise
 *   - `data` - `void` on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useDeleteNote();
 *
 * mutate('note-123');
 * ```
 *
 * @example With confirmation
 * ```ts
 * const { mutate, isPending } = useDeleteNote();
 *
 * const handleDelete = () => {
 *   if (confirm('Delete this note?')) {
 *     mutate(noteId, {
 *       onSuccess: () => navigate('/notes'),
 *       onError: (error) => toast.error(error.message),
 *     });
 *   }
 * };
 * ```
 */
export function useDeleteNote(): UseMutationResult<
  void,
  ApiRequestError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/api/notes/${encodeURIComponent(id)}`),

    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: noteKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() });

      // Snapshot previous values for rollback
      const previousNote = queryClient.getQueryData<Note>(noteKeys.detail(id));
      const previousLists = queryClient.getQueriesData<NotesResponse>({
        queryKey: noteKeys.lists(),
      });

      // Optimistically remove from lists (soft delete - mark as deleted)
      previousLists.forEach(([queryKey, data]) => {
        if (data) {
          queryClient.setQueryData<NotesResponse>(queryKey, {
            ...data,
            notes: data.notes.filter((note) => note.id !== id),
            total: data.total - 1,
          });
        }
      });

      return { previousNote, previousLists };
    },

    onError: (error, id, context) => {
      // Roll back on error
      if (context?.previousNote) {
        queryClient.setQueryData(noteKeys.detail(id), context.previousNote);
      }
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error('[useDeleteNote] Failed to delete note:', error.message);
    },

    onSettled: (_, _error, id) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
      // Invalidate all notebook queries (tree includes lists)
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
    },
  });
}

/**
 * Restore a soft-deleted note.
 *
 * Restores a note that was previously deleted with {@link useDeleteNote}.
 *
 * On success, invalidates:
 * - The specific note detail query
 * - All note list queries
 * - Notebook detail and tree queries (if note is in a notebook)
 *
 * @returns TanStack mutation result with:
 *   - `mutate(id)` - Trigger the mutation with note ID
 *   - `mutateAsync(id)` - Trigger and return a Promise
 *   - `data` - The restored {@link Note} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useRestoreNote();
 *
 * mutate('note-123');
 * ```
 *
 * @example In a trash view
 * ```ts
 * const { mutate, isPending } = useRestoreNote();
 *
 * <button
 *   disabled={isPending}
 *   onClick={() => mutate(note.id, {
 *     onSuccess: () => toast.success('Note restored'),
 *   })}
 * >
 *   Restore
 * </button>
 * ```
 */
export function useRestoreNote(): UseMutationResult<
  Note,
  ApiRequestError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Note>(`/api/notes/${encodeURIComponent(id)}/restore`, {}),

    onSuccess: (note, id) => {
      // Invalidate the specific note detail
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });

      // Invalidate notes list queries
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });

      // If note has a notebook, invalidate notebook tree (includes detail)
      if (note.notebookId) {
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },

    onError: (error) => {
      console.error('[useRestoreNote] Failed to restore note:', error.message);
    },
  });
}

/**
 * Restore a note to a previous version.
 *
 * Reverts the note content to a specific version from its version history.
 * This creates a new version with the restored content.
 *
 * On success, invalidates:
 * - The specific note detail query
 * - Note versions queries
 * - All note list queries
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ id, versionNumber })` - Trigger the mutation
 *   - `mutateAsync({ id, versionNumber })` - Trigger and return a Promise
 *   - `data` - {@link RestoreVersionResponse} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useRestoreNoteVersion();
 *
 * mutate({ id: 'note-123', versionNumber: 5 });
 * ```
 *
 * @example In a version history view
 * ```ts
 * const { mutate, isPending } = useRestoreNoteVersion();
 *
 * const handleRestore = (version: NoteVersion) => {
 *   if (confirm(`Restore to version ${version.versionNumber}?`)) {
 *     mutate(
 *       { id: noteId, versionNumber: version.versionNumber },
 *       {
 *         onSuccess: () => toast.success('Version restored'),
 *         onError: (error) => toast.error(error.message),
 *       }
 *     );
 *   }
 * };
 * ```
 */
export function useRestoreNoteVersion(): UseMutationResult<
  RestoreVersionResponse,
  ApiRequestError,
  RestoreNoteVersionVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, versionNumber }: RestoreNoteVersionVariables) =>
      apiClient.post<RestoreVersionResponse>(
        `/api/notes/${encodeURIComponent(id)}/versions/${versionNumber}/restore`,
        {}
      ),

    onSuccess: (_, { id }) => {
      // Invalidate note detail, versions, and lists
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.versions(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },

    onError: (error) => {
      console.error(
        '[useRestoreNoteVersion] Failed to restore version:',
        error.message
      );
    },
  });
}
