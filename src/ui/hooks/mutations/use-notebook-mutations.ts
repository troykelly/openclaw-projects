/**
 * TanStack Query mutation hooks for notebooks.
 *
 * Provides mutations for creating, updating, archiving, and deleting notebooks.
 * Includes cache invalidation for related queries.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  Notebook,
  CreateNotebookBody,
  UpdateNotebookBody,
  MoveNotesBody,
  MoveNotesResponse,
} from '@/ui/lib/api-types.ts';
import { noteKeys } from '@/ui/hooks/queries/use-notes.ts';
import { notebookKeys } from '@/ui/hooks/queries/use-notebooks.ts';

/**
 * Create a new notebook.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useCreateNotebook();
 * mutate({ name: 'My Notebook', icon: '📓' });
 * ```
 */
export function useCreateNotebook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateNotebookBody) =>
      apiClient.post<Notebook>('/api/notebooks', body),

    onSuccess: (notebook) => {
      // Invalidate notebooks list queries
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });

      // Invalidate tree
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });

      // If has parent, invalidate parent notebook
      if (notebook.parentNotebookId) {
        queryClient.invalidateQueries({
          queryKey: notebookKeys.detail(notebook.parentNotebookId),
        });
      }
    },
  });
}

/**
 * Update an existing notebook.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useUpdateNotebook();
 * mutate({ id: 'notebook-123', body: { name: 'New Name' } });
 * ```
 */
export function useUpdateNotebook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNotebookBody }) =>
      apiClient.put<Notebook>(`/api/notebooks/${id}`, body),

    onSuccess: (_, { id }) => {
      // Invalidate the specific notebook detail
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });

      // Invalidate notebooks list queries
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });

      // Invalidate tree
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
    },
  });
}

/**
 * Archive a notebook.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useArchiveNotebook();
 * mutate('notebook-123');
 * ```
 */
export function useArchiveNotebook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Notebook>(`/api/notebooks/${id}/archive`, {}),

    onSuccess: (_, id) => {
      // Invalidate the specific notebook detail
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });

      // Invalidate notebooks list queries
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });

      // Invalidate tree
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
    },
  });
}

/**
 * Unarchive a notebook.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useUnarchiveNotebook();
 * mutate('notebook-123');
 * ```
 */
export function useUnarchiveNotebook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Notebook>(`/api/notebooks/${id}/unarchive`, {}),

    onSuccess: (_, id) => {
      // Invalidate the specific notebook detail
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });

      // Invalidate notebooks list queries
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });

      // Invalidate tree
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
    },
  });
}

/**
 * Delete a notebook.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useDeleteNotebook();
 * mutate({ id: 'notebook-123', deleteNotes: false });
 * ```
 */
export function useDeleteNotebook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, deleteNotes = false }: { id: string; deleteNotes?: boolean }) =>
      apiClient.delete(`/api/notebooks/${id}${deleteNotes ? '?deleteNotes=true' : ''}`),

    onSuccess: (_, { id }) => {
      // Invalidate the specific notebook detail
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });

      // Invalidate notebooks list queries
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });

      // Invalidate tree
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });

      // Also invalidate notes since they may have been moved or deleted
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },
  });
}

/**
 * Move or copy notes to a notebook.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useMoveNotesToNotebook();
 * mutate({ notebookId: 'notebook-123', body: { noteIds: ['note-1', 'note-2'], action: 'move' } });
 * ```
 */
export function useMoveNotesToNotebook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ notebookId, body }: { notebookId: string; body: MoveNotesBody }) =>
      apiClient.post<MoveNotesResponse>(`/api/notebooks/${notebookId}/notes`, body),

    onSuccess: (_, { notebookId }) => {
      // Invalidate the target notebook
      queryClient.invalidateQueries({
        queryKey: notebookKeys.detail(notebookId),
      });

      // Invalidate all notebooks (source notebook may have changed)
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });

      // Invalidate notes since they've been moved/copied
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },
  });
}
