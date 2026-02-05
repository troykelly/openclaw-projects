/**
 * TanStack Query mutation hooks for notebooks.
 *
 * Provides mutations for creating, updating, archiving, and deleting notebooks.
 * Includes cache invalidation and optimistic updates for better UX.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  Notebook,
  NotebooksResponse,
  CreateNotebookBody,
  UpdateNotebookBody,
  MoveNotesBody,
  MoveNotesResponse,
} from '@/ui/lib/api-types.ts';
import { noteKeys } from '@/ui/hooks/queries/use-notes.ts';
import { notebookKeys } from '@/ui/hooks/queries/use-notebooks.ts';

/** Variables for useUpdateNotebook mutation. */
export interface UpdateNotebookVariables {
  /** The notebook ID to update. */
  id: string;
  /** Partial update body. */
  body: UpdateNotebookBody;
}

/** Context returned from onMutate for rollback. */
interface UpdateNotebookContext {
  previousNotebook: Notebook | undefined;
}

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
 * Supports optimistic updates for name, description, icon, and color changes
 * to provide instant UI feedback while the server request is in flight.
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
    mutationFn: ({ id, body }: UpdateNotebookVariables) =>
      apiClient.put<Notebook>(
        `/api/notebooks/${encodeURIComponent(id)}`,
        body
      ),

    onMutate: async ({ id, body }): Promise<UpdateNotebookContext> => {
      // Cancel in-flight queries for this notebook
      await queryClient.cancelQueries({ queryKey: notebookKeys.detail(id) });

      // Snapshot the previous value
      const previousNotebook = queryClient.getQueryData<Notebook>(
        notebookKeys.detail(id)
      );

      // Optimistically update the detail cache
      if (previousNotebook) {
        const optimisticNotebook: Notebook = {
          ...previousNotebook,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.icon !== undefined ? { icon: body.icon } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          updatedAt: new Date().toISOString(),
        };
        queryClient.setQueryData(notebookKeys.detail(id), optimisticNotebook);
      }

      return { previousNotebook };
    },

    onError: (_error, { id }, context) => {
      // Roll back on error
      if (context?.previousNotebook) {
        queryClient.setQueryData(
          notebookKeys.detail(id),
          context.previousNotebook
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      // Always refetch to ensure server state is accurate
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
    },
  });
}

/** Context returned from onMutate for archive rollback. */
interface ArchiveNotebookContext {
  previousNotebook: Notebook | undefined;
}

/**
 * Archive a notebook.
 *
 * Supports optimistic updates to immediately show the notebook as archived.
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
      apiClient.post<Notebook>(
        `/api/notebooks/${encodeURIComponent(id)}/archive`,
        {}
      ),

    onMutate: async (id): Promise<ArchiveNotebookContext> => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: notebookKeys.detail(id) });

      // Snapshot the previous value
      const previousNotebook = queryClient.getQueryData<Notebook>(
        notebookKeys.detail(id)
      );

      // Optimistically mark as archived
      if (previousNotebook) {
        queryClient.setQueryData(notebookKeys.detail(id), {
          ...previousNotebook,
          isArchived: true,
          updatedAt: new Date().toISOString(),
        });
      }

      return { previousNotebook };
    },

    onError: (_error, id, context) => {
      // Roll back on error
      if (context?.previousNotebook) {
        queryClient.setQueryData(
          notebookKeys.detail(id),
          context.previousNotebook
        );
      }
    },

    onSettled: (_data, _error, id) => {
      // Always refetch to ensure server state is accurate
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
    },
  });
}

/**
 * Unarchive a notebook.
 *
 * Supports optimistic updates to immediately show the notebook as unarchived.
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
      apiClient.post<Notebook>(
        `/api/notebooks/${encodeURIComponent(id)}/unarchive`,
        {}
      ),

    onMutate: async (id): Promise<ArchiveNotebookContext> => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: notebookKeys.detail(id) });

      // Snapshot the previous value
      const previousNotebook = queryClient.getQueryData<Notebook>(
        notebookKeys.detail(id)
      );

      // Optimistically mark as unarchived
      if (previousNotebook) {
        queryClient.setQueryData(notebookKeys.detail(id), {
          ...previousNotebook,
          isArchived: false,
          updatedAt: new Date().toISOString(),
        });
      }

      return { previousNotebook };
    },

    onError: (_error, id, context) => {
      // Roll back on error
      if (context?.previousNotebook) {
        queryClient.setQueryData(
          notebookKeys.detail(id),
          context.previousNotebook
        );
      }
    },

    onSettled: (_data, _error, id) => {
      // Always refetch to ensure server state is accurate
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
    },
  });
}

/** Variables for useDeleteNotebook mutation. */
export interface DeleteNotebookVariables {
  /** The notebook ID to delete. */
  id: string;
  /** Whether to delete notes in the notebook. Defaults to false (moves notes to inbox). */
  deleteNotes?: boolean;
}

/** Context returned from onMutate for delete rollback. */
interface DeleteNotebookContext {
  previousNotebook: Notebook | undefined;
  previousLists: Map<string, NotebooksResponse>;
}

/**
 * Delete a notebook.
 *
 * Supports optimistic updates to immediately remove the notebook from lists.
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
    mutationFn: ({ id, deleteNotes = false }: DeleteNotebookVariables) =>
      apiClient.delete(
        `/api/notebooks/${encodeURIComponent(id)}${deleteNotes ? '?deleteNotes=true' : ''}`
      ),

    onMutate: async ({ id }): Promise<DeleteNotebookContext> => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: notebookKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: notebookKeys.lists() });

      // Snapshot the previous values
      const previousNotebook = queryClient.getQueryData<Notebook>(
        notebookKeys.detail(id)
      );
      const previousLists = new Map<string, NotebooksResponse>();

      // Get all notebook list queries and snapshot them
      const listQueries = queryClient.getQueriesData<NotebooksResponse>({
        queryKey: notebookKeys.lists(),
      });
      for (const [key, data] of listQueries) {
        if (data) {
          previousLists.set(JSON.stringify(key), data);
        }
      }

      // Optimistically mark notebook as deleted
      if (previousNotebook) {
        queryClient.setQueryData(notebookKeys.detail(id), {
          ...previousNotebook,
          deletedAt: new Date().toISOString(),
        });
      }

      // Optimistically remove from all list caches
      for (const [key, data] of listQueries) {
        if (data?.notebooks) {
          queryClient.setQueryData(key, {
            ...data,
            notebooks: data.notebooks.filter((nb) => nb.id !== id),
            total: Math.max(0, data.total - 1),
          });
        }
      }

      return { previousNotebook, previousLists };
    },

    onError: (_error, { id }, context) => {
      // Roll back on error
      if (context?.previousNotebook) {
        queryClient.setQueryData(
          notebookKeys.detail(id),
          context.previousNotebook
        );
      }
      if (context?.previousLists) {
        for (const [keyStr, data] of context.previousLists) {
          queryClient.setQueryData(JSON.parse(keyStr), data);
        }
      }
    },

    onSettled: (_data, _error, { id }) => {
      // Always refetch to ensure server state is accurate
      queryClient.invalidateQueries({ queryKey: notebookKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: notebookKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notebookKeys.tree() });
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
