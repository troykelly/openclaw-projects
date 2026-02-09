/**
 * TanStack Query mutation hook for deleting work items.
 *
 * Soft-deletes a work item and invalidates related queries.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';

/** Variables for the delete mutation. */
export interface DeleteWorkItemVariables {
  id: string;
}

/**
 * Delete a work item by ID.
 *
 * The API performs a soft-delete (moves to trash). On success, all work item
 * queries are invalidated.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useDeleteWorkItem();
 * mutate({ id: 'abc-123' });
 * ```
 */
export function useDeleteWorkItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: DeleteWorkItemVariables) => apiClient.delete(`/api/work-items/${id}`),

    onSuccess: () => {
      // Invalidate all work item queries so lists/trees reflect the deletion
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
}
