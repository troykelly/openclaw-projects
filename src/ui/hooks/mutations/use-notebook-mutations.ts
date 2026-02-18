/**
 * TanStack Query mutation hooks for notebooks.
 *
 * Provides mutations for creating, updating, archiving, and deleting notebooks.
 * All mutations automatically invalidate relevant cached queries on success.
 * Mutations include optimistic updates for better UX and proper error handling.
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
 *
 * @example Optimistic updates
 * ```ts
 * const { mutate } = useUpdateNotebook();
 *
 * // Update is applied immediately to the UI, then synced with server
 * mutate({ id: 'notebook-123', body: { name: 'New Name' } });
 * // If server rejects, UI automatically rolls back
 * ```
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ApiRequestError } from '@/ui/lib/api-client.ts';
import type {
  Notebook,
  NotebooksResponse,
  NotebookTreeNode,
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
  notebook_id: string;
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
export function useCreateNotebook(): UseMutationResult<Notebook, ApiRequestError, CreateNotebookBody> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateNotebookBody) => apiClient.post<Notebook>('/api/notebooks', body),

    onSuccess: () => {
      // Invalidate all notebook queries (tree includes lists and details)
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
    },

    onError: (error) => {
      console.error('[useCreateNotebook] Failed to create notebook:', error.message);
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
 *   { id: notebook_id, body: { icon: '📚', color: '#3B82F6' } },
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
/**
 * Helper to recursively update a notebook in the tree structure.
 */
function updateNotebookInTree(nodes: NotebookTreeNode[], id: string, updates: Partial<NotebookTreeNode>): NotebookTreeNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, ...updates };
    }
    if (node.children.length > 0) {
      return {
        ...node,
        children: updateNotebookInTree(node.children, id, updates),
      };
    }
    return node;
  });
}

export function useUpdateNotebook(): UseMutationResult<Notebook, ApiRequestError, UpdateNotebookVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: UpdateNotebookVariables) => apiClient.put<Notebook>(`/api/notebooks/${encodeURIComponent(id)}`, body),

    onMutate: async ({ id, body }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: notebookKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: notebookKeys.lists() });
      await queryClient.cancelQueries({ queryKey: notebookKeys.tree() });

      // Snapshot previous values for rollback
      const previousNotebook = queryClient.getQueryData<Notebook>(notebookKeys.detail(id));
      const previousLists = queryClient.getQueriesData<NotebooksResponse>({
        queryKey: notebookKeys.lists(),
      });
      const previousTree = queryClient.getQueryData<NotebookTreeNode[]>(notebookKeys.tree());

      // Optimistically update the notebook detail
      if (previousNotebook) {
        queryClient.setQueryData<Notebook>(notebookKeys.detail(id), {
          ...previousNotebook,
          ...body,
          updated_at: new Date().toISOString(),
        });
      }

      // Optimistically update in list queries
      previousLists.forEach(([queryKey, data]) => {
        if (data) {
          queryClient.setQueryData<NotebooksResponse>(queryKey, {
            ...data,
            notebooks: data.notebooks.map((nb) => (nb.id === id ? { ...nb, ...body, updated_at: new Date().toISOString() } : nb)),
          });
        }
      });

      // Optimistically update in tree
      if (previousTree) {
        const treeUpdates: Partial<NotebookTreeNode> = {};
        if (body.name !== undefined) treeUpdates.name = body.name;
        if (body.icon !== undefined) treeUpdates.icon = body.icon;
        if (body.color !== undefined) treeUpdates.color = body.color;

        if (Object.keys(treeUpdates).length > 0) {
          queryClient.setQueryData<NotebookTreeNode[]>(notebookKeys.tree(), updateNotebookInTree(previousTree, id, treeUpdates));
        }
      }

      return { previousNotebook, previousLists, previousTree };
    },

    onError: (error, { id }, context) => {
      // Roll back on error
      if (context?.previousNotebook) {
        queryClient.setQueryData(notebookKeys.detail(id), context.previousNotebook);
      }
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousTree) {
        queryClient.setQueryData(notebookKeys.tree(), context.previousTree);
      }
      console.error('[useUpdateNotebook] Failed to update notebook:', error.message);
    },

    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
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
 *     mutate(notebook_id, {
 *       onSuccess: () => toast.success('Notebook archived'),
 *     });
 *   }
 * };
 * ```
 */
export function useArchiveNotebook(): UseMutationResult<Notebook, ApiRequestError, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.post<Notebook>(`/api/notebooks/${encodeURIComponent(id)}/archive`, {}),

    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: notebookKeys.all });

      // Snapshot previous values
      const previousNotebook = queryClient.getQueryData<Notebook>(notebookKeys.detail(id));
      const previousLists = queryClient.getQueriesData<NotebooksResponse>({
        queryKey: notebookKeys.lists(),
      });
      const previousTree = queryClient.getQueryData<NotebookTreeNode[]>(notebookKeys.tree());

      // Optimistically update the notebook to archived state
      if (previousNotebook) {
        queryClient.setQueryData<Notebook>(notebookKeys.detail(id), {
          ...previousNotebook,
          is_archived: true,
          updated_at: new Date().toISOString(),
        });
      }

      // Optimistically remove from non-archived list queries
      previousLists.forEach(([queryKey, data]) => {
        if (data) {
          queryClient.setQueryData<NotebooksResponse>(queryKey, {
            ...data,
            notebooks: data.notebooks.filter((nb) => nb.id !== id),
            total: data.total - 1,
          });
        }
      });

      return { previousNotebook, previousLists, previousTree };
    },

    onError: (error, id, context) => {
      // Roll back on error
      if (context?.previousNotebook) {
        queryClient.setQueryData(notebookKeys.detail(id), context.previousNotebook);
      }
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousTree) {
        queryClient.setQueryData(notebookKeys.tree(), context.previousTree);
      }
      console.error('[useArchiveNotebook] Failed to archive notebook:', error.message);
    },

    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
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
export function useUnarchiveNotebook(): UseMutationResult<Notebook, ApiRequestError, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.post<Notebook>(`/api/notebooks/${encodeURIComponent(id)}/unarchive`, {}),

    onSuccess: () => {
      // Invalidate all notebook queries
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
    },

    onError: (error) => {
      console.error('[useUnarchiveNotebook] Failed to unarchive notebook:', error.message);
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
 *     mutate({ id: notebook_id, deleteNotes }, {
 *       onSuccess: () => navigate('/notebooks'),
 *       onError: (error) => toast.error(error.message),
 *     });
 *   }
 * };
 * ```
 */
/**
 * Helper to recursively remove a notebook from the tree structure.
 */
function removeNotebookFromTree(nodes: NotebookTreeNode[], id: string): NotebookTreeNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({
      ...node,
      children: removeNotebookFromTree(node.children, id),
    }));
}

export function useDeleteNotebook(): UseMutationResult<void, ApiRequestError, DeleteNotebookVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, deleteNotes = false }: DeleteNotebookVariables) =>
      apiClient.delete(`/api/notebooks/${encodeURIComponent(id)}${deleteNotes ? '?delete_notes=true' : ''}`),

    onMutate: async ({ id }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: notebookKeys.all });
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() });

      // Snapshot previous values
      const previousNotebook = queryClient.getQueryData<Notebook>(notebookKeys.detail(id));
      const previousLists = queryClient.getQueriesData<NotebooksResponse>({
        queryKey: notebookKeys.lists(),
      });
      const previousTree = queryClient.getQueryData<NotebookTreeNode[]>(notebookKeys.tree());

      // Optimistically remove from list queries
      previousLists.forEach(([queryKey, data]) => {
        if (data) {
          queryClient.setQueryData<NotebooksResponse>(queryKey, {
            ...data,
            notebooks: data.notebooks.filter((nb) => nb.id !== id),
            total: data.total - 1,
          });
        }
      });

      // Optimistically remove from tree
      if (previousTree) {
        queryClient.setQueryData<NotebookTreeNode[]>(notebookKeys.tree(), removeNotebookFromTree(previousTree, id));
      }

      return { previousNotebook, previousLists, previousTree };
    },

    onError: (error, { id }, context) => {
      // Roll back on error
      if (context?.previousNotebook) {
        queryClient.setQueryData(notebookKeys.detail(id), context.previousNotebook);
      }
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousTree) {
        queryClient.setQueryData(notebookKeys.tree(), context.previousTree);
      }
      console.error('[useDeleteNotebook] Failed to delete notebook:', error.message);
    },

    onSettled: () => {
      // Always refetch to ensure consistency
      // Use prefix invalidation to catch all notebook and note queries
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
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
 *   - `mutate({ notebook_id, body })` - Trigger the mutation
 *   - `mutateAsync({ notebook_id, body })` - Trigger and return a Promise
 *   - `data` - {@link MoveNotesResponse} on success
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Moving notes
 * ```ts
 * const { mutate } = useMoveNotesToNotebook();
 *
 * mutate({
 *   notebook_id: 'target-notebook-123',
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
 *     notebook_id: targetNotebookId,
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
 *     notebook_id: targetNotebookId,
 *     body: { noteIds, action: 'move' },
 *   });
 * };
 * ```
 */
export function useMoveNotesToNotebook(): UseMutationResult<MoveNotesResponse, ApiRequestError, MoveNotesVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ notebook_id, body }: MoveNotesVariables) => apiClient.post<MoveNotesResponse>(`/api/notebooks/${encodeURIComponent(notebook_id)}/notes`, body),

    onSuccess: () => {
      // Invalidate all notebook and note queries using prefix invalidation
      queryClient.invalidateQueries({ queryKey: notebookKeys.all });
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },

    onError: (error) => {
      console.error('[useMoveNotesToNotebook] Failed to move notes:', error.message);
    },
  });
}
