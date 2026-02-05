/**
 * TanStack Query mutation hooks for notes.
 *
 * Provides mutations for creating, updating, deleting, and restoring notes.
 * Includes cache invalidation and optimistic updates for better UX.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  Note,
  NotesResponse,
  CreateNoteBody,
  UpdateNoteBody,
  RestoreVersionResponse,
} from '@/ui/lib/api-types.ts';
import { noteKeys } from '@/ui/hooks/queries/use-notes.ts';
import { notebookKeys } from '@/ui/hooks/queries/use-notebooks.ts';

/** Variables for useUpdateNote mutation. */
export interface UpdateNoteVariables {
  /** The note ID to update. */
  id: string;
  /** Partial update body. */
  body: UpdateNoteBody;
}

/** Context returned from onMutate for rollback. */
interface UpdateNoteContext {
  previousNote: Note | undefined;
}

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

      // If note has a notebook, invalidate notebook queries too
      if (note.notebookId) {
        queryClient.invalidateQueries({
          queryKey: notebookKeys.detail(note.notebookId),
        });
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },
  });
}

/**
 * Update an existing note.
 *
 * Supports optimistic updates for title, content, tags, and isPinned changes
 * to provide instant UI feedback while the server request is in flight.
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
    mutationFn: ({ id, body }: UpdateNoteVariables) =>
      apiClient.put<Note>(`/api/notes/${encodeURIComponent(id)}`, body),

    onMutate: async ({ id, body }): Promise<UpdateNoteContext> => {
      // Cancel in-flight queries for this note
      await queryClient.cancelQueries({ queryKey: noteKeys.detail(id) });

      // Snapshot the previous value
      const previousNote = queryClient.getQueryData<Note>(noteKeys.detail(id));

      // Optimistically update the detail cache
      if (previousNote) {
        const optimisticNote: Note = {
          ...previousNote,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          ...(body.isPinned !== undefined ? { isPinned: body.isPinned } : {}),
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
          ...(body.summary !== undefined ? { summary: body.summary } : {}),
          updatedAt: new Date().toISOString(),
        };
        queryClient.setQueryData(noteKeys.detail(id), optimisticNote);
      }

      return { previousNote };
    },

    onError: (_error, { id }, context) => {
      // Roll back on error
      if (context?.previousNote) {
        queryClient.setQueryData(noteKeys.detail(id), context.previousNote);
      }
    },

    onSettled: (note, _error, { id }) => {
      // Always refetch to ensure server state is accurate
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: noteKeys.versions(id) });

      // If note has a notebook, invalidate notebook queries
      if (note?.notebookId) {
        queryClient.invalidateQueries({
          queryKey: notebookKeys.detail(note.notebookId),
        });
        queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      }
    },
  });
}

/** Context returned from onMutate for delete rollback. */
interface DeleteNoteContext {
  previousNote: Note | undefined;
  previousLists: Map<string, NotesResponse>;
}

/**
 * Soft delete a note.
 *
 * Supports optimistic updates to immediately remove the note from lists
 * and mark it as deleted in the detail view.
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

    onMutate: async (id): Promise<DeleteNoteContext> => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: noteKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() });

      // Snapshot the previous values
      const previousNote = queryClient.getQueryData<Note>(noteKeys.detail(id));
      const previousLists = new Map<string, NotesResponse>();

      // Get all note list queries and snapshot them
      const listQueries = queryClient.getQueriesData<NotesResponse>({
        queryKey: noteKeys.lists(),
      });
      for (const [key, data] of listQueries) {
        if (data) {
          previousLists.set(JSON.stringify(key), data);
        }
      }

      // Optimistically mark note as deleted in detail cache
      if (previousNote) {
        queryClient.setQueryData(noteKeys.detail(id), {
          ...previousNote,
          deletedAt: new Date().toISOString(),
        });
      }

      // Optimistically remove from all list caches
      for (const [key, data] of listQueries) {
        if (data?.notes) {
          queryClient.setQueryData(key, {
            ...data,
            notes: data.notes.filter((note) => note.id !== id),
            total: Math.max(0, data.total - 1),
          });
        }
      }

      return { previousNote, previousLists };
    },

    onError: (_error, id, context) => {
      // Roll back on error
      if (context?.previousNote) {
        queryClient.setQueryData(noteKeys.detail(id), context.previousNote);
      }
      if (context?.previousLists) {
        for (const [keyStr, data] of context.previousLists) {
          queryClient.setQueryData(JSON.parse(keyStr), data);
        }
      }
    },

    onSettled: (_, _error, id) => {
      // Always refetch to ensure server state is accurate
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });
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
      apiClient.post<Note>(`/api/notes/${encodeURIComponent(id)}/restore`, {}),

    onSuccess: (note, id) => {
      // Invalidate the specific note detail
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(id) });

      // Invalidate notes list queries
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });

      // If note has a notebook, invalidate notebook queries
      if (note.notebookId) {
        queryClient.invalidateQueries({
          queryKey: notebookKeys.detail(note.notebookId),
        });
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

      // Invalidate notes list queries
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },
  });
}
