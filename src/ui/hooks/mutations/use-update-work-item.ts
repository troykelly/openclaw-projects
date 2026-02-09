/**
 * TanStack Query mutation hook for updating work items.
 *
 * Supports optimistic updates for status and title changes to provide
 * instant UI feedback while the server request is in flight.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { UpdateWorkItemBody, WorkItemDetail } from '@/ui/lib/api-types.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';

/** Variables required by the update mutation. */
export interface UpdateWorkItemVariables {
  /** The work item ID to update. */
  id: string;
  /** Partial update body. */
  body: UpdateWorkItemBody;
}

/**
 * Update an existing work item via PUT.
 *
 * Optimistic updates are applied to the detail cache for `status` and `title`
 * changes. On error, the cache is rolled back to the previous value.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useUpdateWorkItem();
 * mutate({ id: 'abc', body: { status: 'in_progress' } });
 * ```
 */
export function useUpdateWorkItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: UpdateWorkItemVariables) => apiClient.put<WorkItemDetail>(`/api/work-items/${id}`, body),

    onMutate: async ({ id, body }) => {
      // Cancel in-flight queries for this work item
      await queryClient.cancelQueries({ queryKey: workItemKeys.detail(id) });

      // Snapshot the previous value
      const previousDetail = queryClient.getQueryData<WorkItemDetail>(workItemKeys.detail(id));

      // Optimistically update the detail cache
      if (previousDetail) {
        const optimisticData: WorkItemDetail = {
          ...previousDetail,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        };
        queryClient.setQueryData(workItemKeys.detail(id), optimisticData);
      }

      return { previousDetail };
    },

    onError: (_error, { id }, context) => {
      // Roll back on error
      if (context?.previousDetail) {
        queryClient.setQueryData(workItemKeys.detail(id), context.previousDetail);
      }
    },

    onSettled: (_data, _error, { id }) => {
      // Always refetch to ensure server state is accurate
      queryClient.invalidateQueries({ queryKey: workItemKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: workItemKeys.lists() });
      queryClient.invalidateQueries({ queryKey: workItemKeys.tree() });
    },
  });
}
