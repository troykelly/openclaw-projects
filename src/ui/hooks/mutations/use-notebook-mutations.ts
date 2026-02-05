/**
 * TanStack Query mutation hooks for notebooks.
 *
 * Provides mutations for creating, updating, archiving, and deleting notebooks.
 * All mutations automatically invalidate relevant cached queries on success.
 *
 * @module use-notebook-mutations
 *
 * @example Error handling
 * ```ts
 * import { ApiRequestError } from '@/ui/lib/api-client';
 *
 * const { mutate, error } = useCreateNotebook();
 *
 * mutate(
 *   { name: 'My Notebook' },
 *   {
 *     onError: (error) => {
 *       if (error instanceof ApiRequestError) {
 *         console.error(`API error ${error.status}: ${error.message}`);
 *       }
 *     },
 *   }
 * );
 * ```
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ApiRequestError } from '@/ui/lib/api-client.ts';
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
 * Variables for the updateNotebook mutation.
 */
export interface UpdateNotebookVariables {
  /** The notebook ID to update. */
  id: string;
  /** The fields to update. */
  body: UpdateNotebookBody;
}

/**
 * Variables for the deleteNotebook mutation.
 */
export interface DeleteNotebookVariables {
  /** The notebook ID to delete. */
  id: string;
  /** If true, also delete all notes in the notebook. Defaults to false. */
  deleteNotes?: boolean;
}

/**
 * Variables for the moveNotesToNotebook mutation.
 */
export interface MoveNotesVariables {
  /** The target notebook ID to move/copy notes to. */
  notebookId: string;
  /** The note IDs and action (move or copy). */
  body: MoveNotesBody;
}

/**
 * Create a new notebook.
 *
 * On success, invalidates:
 * - All notebook list queries
 * - Notebook tree queries
 * - Parent notebook detail (if creating a nested notebook)
 *
 * @returns TanStack mutation result with:
 *   - `mutate(body)` - Trigger the mutation
 *   - `mutateAsync(body)` - Trigger and return a Promise
 *   - `data` - The created {@link Notebook} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *   - `isSuccess` / `isError` - Result states
 *
 * @example Basic usage
 * ```ts
 * const { mutate, isPending } = useCreateNotebook();
 *
 * mutate({ name: 'My Notebook', icon: '📓' });
 * ```
 *
 * @example Creating a nested notebook
 * ```ts
 * const { mutate } = useCreateNotebook();
 *
 * mutate(
 *   { name: 'Sub-notebook', parentNotebookId: 'parent-123' },
 *   {
 *     onSuccess: (notebook) => {
 *       navigate(`/notebooks/${notebook.id}`);
 *     },
 *   }
 * );
 * ```
 *
 * @example Async/await
 * ```ts
 * const { mutateAsync } = useCreateNotebook();
 *
 * try {
 *   const notebook = await mutateAsync({ name: 'New Notebook' });
 *   console.log('Created:', notebook.id);
 * } catch (error) {
 *   // Handle ApiRequestError
 * }
 * ```
 */
export function useCreateNotebook(): UseMutationResult<
  Notebook,
  ApiRequestError,
  CreateNotebookBody
> {
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
 * On success, invalidates:
 * - The specific notebook detail query
 * - All notebook list queries
 * - Notebook tree queries
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ id, body })` - Trigger the mutation
 *   - `mutateAsync({ id, body })` - Trigger and return a Promise
 *   - `data` - The updated {@link Notebook} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useUpdateNotebook();
 *
 * mutate({ id: 'notebook-123', body: { name: 'New Name' } });
 * ```
 *
 * @example Updating icon and color
 * ```ts
 * const { mutate, isPending } = useUpdateNotebook();
 *
 * mutate(
 *   { id: notebookId, body: { icon: '📚', color: '#3B82F6' } },
 *   {
 *     onSuccess: () => toast.success('Notebook updated'),
 *     onError: (error) => toast.error(error.message),
 *   }
 * );
 * ```
 *
 * @example Moving to a different parent
 * ```ts
 * mutate({ id: 'notebook-123', body: { parentNotebookId: 'new-parent-456' } });
 * ```
 */
export function useUpdateNotebook(): UseMutationResult<
  Notebook,
  ApiRequestError,
  UpdateNotebookVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: UpdateNotebookVariables) =>
      apiClient.put<Notebook>(`/api/notebooks/${encodeURIComponent(id)}`, body),

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
 * Archived notebooks are hidden from the default view but can be restored.
 * Use {@link useUnarchiveNotebook} to restore an archived notebook.
 *
 * On success, invalidates:
 * - The specific notebook detail query
 * - All notebook list queries
 * - Notebook tree queries
 *
 * @returns TanStack mutation result with:
 *   - `mutate(id)` - Trigger the mutation with notebook ID
 *   - `mutateAsync(id)` - Trigger and return a Promise
 *   - `data` - The archived {@link Notebook} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useArchiveNotebook();
 *
 * mutate('notebook-123');
 * ```
 *
 * @example With confirmation
 * ```ts
 * const { mutate, isPending } = useArchiveNotebook();
 *
 * const handleArchive = () => {
 *   if (confirm('Archive this notebook?')) {
 *     mutate(notebookId, {
 *       onSuccess: () => toast.success('Notebook archived'),
 *     });
 *   }
 * };
 * ```
 */
export function useArchiveNotebook(): UseMutationResult<
  Notebook,
  ApiRequestError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Notebook>(
        `/api/notebooks/${encodeURIComponent(id)}/archive`,
        {}
      ),

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
 * Restores a notebook that was previously archived with {@link useArchiveNotebook}.
 *
 * On success, invalidates:
 * - The specific notebook detail query
 * - All notebook list queries
 * - Notebook tree queries
 *
 * @returns TanStack mutation result with:
 *   - `mutate(id)` - Trigger the mutation with notebook ID
 *   - `mutateAsync(id)` - Trigger and return a Promise
 *   - `data` - The restored {@link Notebook} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useUnarchiveNotebook();
 *
 * mutate('notebook-123');
 * ```
 *
 * @example In an archived notebooks view
 * ```ts
 * const { mutate, isPending } = useUnarchiveNotebook();
 *
 * <button
 *   disabled={isPending}
 *   onClick={() => mutate(notebook.id, {
 *     onSuccess: () => toast.success('Notebook restored'),
 *   })}
 * >
 *   Restore
 * </button>
 * ```
 */
export function useUnarchiveNotebook(): UseMutationResult<
  Notebook,
  ApiRequestError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Notebook>(
        `/api/notebooks/${encodeURIComponent(id)}/unarchive`,
        {}
      ),

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
 * Permanently deletes a notebook. If `deleteNotes` is true, also deletes
 * all notes in the notebook. Otherwise, notes are moved to "No Notebook".
 *
 * On success, invalidates:
 * - The specific notebook detail query
 * - All notebook list queries
 * - Notebook tree queries
 * - All note list queries (notes may have been moved or deleted)
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ id, deleteNotes? })` - Trigger the mutation
 *   - `mutateAsync({ id, deleteNotes? })` - Trigger and return a Promise
 *   - `data` - `void` on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic usage (notes moved to "No Notebook")
 * ```ts
 * const { mutate } = useDeleteNotebook();
 *
 * mutate({ id: 'notebook-123' });
 * ```
 *
 * @example Delete notebook and all its notes
 * ```ts
 * const { mutate } = useDeleteNotebook();
 *
 * mutate({ id: 'notebook-123', deleteNotes: true });
 * ```
 *
 * @example With confirmation dialog
 * ```ts
 * const { mutate, isPending } = useDeleteNotebook();
 *
 * const handleDelete = (deleteNotes: boolean) => {
 *   const message = deleteNotes
 *     ? 'Delete this notebook AND all its notes?'
 *     : 'Delete this notebook? Notes will be moved to "No Notebook".';
 *
 *   if (confirm(message)) {
 *     mutate({ id: notebookId, deleteNotes }, {
 *       onSuccess: () => navigate('/notebooks'),
 *       onError: (error) => toast.error(error.message),
 *     });
 *   }
 * };
 * ```
 */
export function useDeleteNotebook(): UseMutationResult<
  void,
  ApiRequestError,
  DeleteNotebookVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, deleteNotes = false }: DeleteNotebookVariables) =>
      apiClient.delete(
        `/api/notebooks/${encodeURIComponent(id)}${deleteNotes ? '?deleteNotes=true' : ''}`
      ),

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
 * Bulk operation to move or copy multiple notes to a target notebook.
 *
 * On success, invalidates:
 * - The target notebook detail query
 * - All notebook list queries (source notebooks may have changed)
 * - Notebook tree queries
 * - All note list queries
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ notebookId, body })` - Trigger the mutation
 *   - `mutateAsync({ notebookId, body })` - Trigger and return a Promise
 *   - `data` - {@link MoveNotesResponse} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Moving notes
 * ```ts
 * const { mutate } = useMoveNotesToNotebook();
 *
 * mutate({
 *   notebookId: 'target-notebook-123',
 *   body: {
 *     noteIds: ['note-1', 'note-2', 'note-3'],
 *     action: 'move',
 *   },
 * });
 * ```
 *
 * @example Copying notes
 * ```ts
 * const { mutate, isPending } = useMoveNotesToNotebook();
 *
 * mutate(
 *   {
 *     notebookId: targetNotebookId,
 *     body: { noteIds: selectedNoteIds, action: 'copy' },
 *   },
 *   {
 *     onSuccess: (response) => {
 *       toast.success(`${response.movedCount} notes copied`);
 *     },
 *     onError: (error) => toast.error(error.message),
 *   }
 * );
 * ```
 *
 * @example In a drag-and-drop handler
 * ```ts
 * const { mutate } = useMoveNotesToNotebook();
 *
 * const handleDrop = (noteIds: string[], targetNotebookId: string) => {
 *   mutate({
 *     notebookId: targetNotebookId,
 *     body: { noteIds, action: 'move' },
 *   });
 * };
 * ```
 */
export function useMoveNotesToNotebook(): UseMutationResult<
  MoveNotesResponse,
  ApiRequestError,
  MoveNotesVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ notebookId, body }: MoveNotesVariables) =>
      apiClient.post<MoveNotesResponse>(
        `/api/notebooks/${encodeURIComponent(notebookId)}/notes`,
        body
      ),

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
